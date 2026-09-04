import crypto from "node:crypto";

import type { DemoSession, DownloadDecision, Product, ProductAsset } from "./types";
import { getProductById, getProductBySlug } from "./products";

const localDownloadLifetimeSeconds = 10 * 60;
const localOrigin = "http://lamilialomi.local";
const defaultDownloadSecret = "local-demo-session-secret-change-in-production";

export type PremiumCodeResult =
  | {
      ok: true;
      productId: string;
      premiumCodeId: string;
      normalizedCode: string;
      alreadyUnlocked: boolean;
    }
  | {
      ok: false;
      reason: "missing_code" | "invalid_code" | "inactive_code" | "product_not_found";
    };

export function normalizePremiumCode(code: string | null | undefined) {
  return (code ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[–—]/g, "-")
    .toUpperCase();
}

export function validatePremiumCode(input: {
  productSlug: string;
  code: string | null | undefined;
  session?: Pick<DemoSession, "unlockedProductIds"> | null;
}): PremiumCodeResult {
  const product = getProductBySlug(input.productSlug);
  const normalizedCode = normalizePremiumCode(input.code);

  if (!product) {
    return { ok: false, reason: "product_not_found" };
  }

  if (!normalizedCode) {
    return { ok: false, reason: "missing_code" };
  }

  const matchingCode = product.premiumCodes.find(
    (code) => normalizePremiumCode(code.code) === normalizedCode,
  );

  if (!matchingCode) {
    return { ok: false, reason: "invalid_code" };
  }

  if (!matchingCode.active) {
    return { ok: false, reason: "inactive_code" };
  }

  return {
    ok: true,
    productId: product.id,
    premiumCodeId: matchingCode.id,
    normalizedCode,
    alreadyUnlocked:
      input.session?.unlockedProductIds.includes(product.id) ?? false,
  };
}

export function canDownloadPremiumAsset(input: {
  session?: Pick<DemoSession, "emailVerified" | "unlockedProductIds"> | null;
  asset?: ProductAsset | null;
  product?: Pick<Product, "id" | "status"> | null;
}): DownloadDecision {
  if (!input.session) {
    return { allowed: false, reason: "guest" };
  }

  if (!input.session.emailVerified) {
    return { allowed: false, reason: "unverified" };
  }

  if (
    !input.asset ||
    input.asset.kind !== "premium_download" ||
    input.asset.isPublic ||
    input.asset.isActive === false
  ) {
    return { allowed: false, reason: "wrong_asset" };
  }

  if (!input.session.unlockedProductIds.includes(input.asset.productId)) {
    return { allowed: false, reason: "locked" };
  }

  if (
    !input.product ||
    input.product.id !== input.asset.productId ||
    input.product.status !== "published"
  ) {
    return { allowed: false, reason: "wrong_asset" };
  }

  return { allowed: true, reason: "allowed" };
}

export function createSignedDownloadUrl(input: {
  asset: ProductAsset;
  product: Pick<Product, "id" | "status">;
  session: Pick<DemoSession, "email" | "emailVerified" | "unlockedProductIds">;
  now?: Date;
}) {
  const decision = canDownloadPremiumAsset({
    session: input.session,
    asset: input.asset,
    product: input.product,
  });

  if (!decision.allowed) {
    return { ok: false as const, decision };
  }

  const expiresAt = new Date(
    Math.floor((input.now ?? new Date()).getTime() / 1000 + localDownloadLifetimeSeconds) * 1000,
  );
  const expires = Math.floor(expiresAt.getTime() / 1000);
  const token = signDownloadToken(input.asset.id, input.session.email, expires);
  const target = new URL(
    input.asset.demoDownloadPath ?? `/api/downloads/${input.asset.id}`,
    localOrigin,
  );

  if (target.origin !== localOrigin) {
    throw new Error("Local premium download path must remain internal.");
  }

  target.searchParams.set("expires", String(expires));
  target.searchParams.set("token", token);

  return {
    ok: true as const,
    url: `${target.pathname}${target.search}`,
    expiresAt,
  };
}

export function verifySignedDownloadUrl(input: {
  asset: ProductAsset;
  product: Pick<Product, "id" | "status">;
  session: Pick<DemoSession, "email" | "emailVerified" | "unlockedProductIds">;
  token: string | null | undefined;
  expires: string | null | undefined;
  now?: Date;
}) {
  const decision = canDownloadPremiumAsset({
    session: input.session,
    asset: input.asset,
    product: input.product,
  });

  if (!decision.allowed) {
    return { ok: false as const, decision };
  }

  if (!input.token || !input.expires || !/^\d+$/.test(input.expires)) {
    return {
      ok: false as const,
      decision: { allowed: false as const, reason: "invalid_token" as const },
    };
  }

  const expires = Number(input.expires);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);

  if (!Number.isSafeInteger(expires) || expires <= nowSeconds) {
    return {
      ok: false as const,
      decision: { allowed: false as const, reason: "invalid_token" as const },
    };
  }

  const expected = signDownloadToken(input.asset.id, input.session.email, expires);
  const actualBuffer = Buffer.from(input.token);
  const expectedBuffer = Buffer.from(expected);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return {
      ok: false as const,
      decision: { allowed: false as const, reason: "invalid_token" as const },
    };
  }

  return { ok: true as const, expiresAt: new Date(expires * 1000) };
}

function signDownloadToken(assetId: string, email: string, expires: number) {
  return crypto
    .createHmac("sha256", process.env.DEMO_SESSION_SECRET ?? defaultDownloadSecret)
    .update(`${assetId}:${email}:${expires}`)
    .digest("base64url");
}

export function applyProductUnlock(
  session: Pick<DemoSession, "unlockedProductIds">,
  productId: string,
) {
  const alreadyUnlocked = session.unlockedProductIds.includes(productId);

  return {
    alreadyUnlocked,
    unlockedProductIds: alreadyUnlocked
      ? session.unlockedProductIds
      : Array.from(new Set([...session.unlockedProductIds, productId])),
  };
}

export function getUnlockedProductViews(session: Pick<DemoSession, "unlockedProductIds">) {
  return session.unlockedProductIds
    .map((productId) => getProductById(productId))
    .filter((product): product is NonNullable<typeof product> => Boolean(product));
}
