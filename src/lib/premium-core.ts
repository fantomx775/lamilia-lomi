import crypto from "node:crypto";

import type { DemoSession, DownloadDecision, ProductAsset } from "./types";
import { getProductById, getProductBySlug } from "./products";

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
}): DownloadDecision {
  if (!input.session) {
    return { allowed: false, reason: "guest" };
  }

  if (!input.session.emailVerified) {
    return { allowed: false, reason: "unverified" };
  }

  if (!input.asset || input.asset.kind !== "premium_download") {
    return { allowed: false, reason: "wrong_asset" };
  }

  if (!input.session.unlockedProductIds.includes(input.asset.productId)) {
    return { allowed: false, reason: "locked" };
  }

  return { allowed: true, reason: "allowed" };
}

export function createSignedDownloadUrl(input: {
  asset: ProductAsset;
  session: Pick<DemoSession, "email" | "emailVerified" | "unlockedProductIds">;
  now?: Date;
}) {
  const decision = canDownloadPremiumAsset({
    session: input.session,
    asset: input.asset,
  });

  if (!decision.allowed) {
    return { ok: false as const, decision };
  }

  const expiresAt = new Date((input.now ?? new Date()).getTime() + 10 * 60 * 1000);
  const token = crypto
    .createHash("sha256")
    .update(`${input.asset.id}:${input.session.email}:${expiresAt.toISOString()}`)
    .digest("hex")
    .slice(0, 24);

  return {
    ok: true as const,
    url: `${input.asset.demoDownloadPath ?? `/api/downloads/${input.asset.id}`}?token=${token}`,
    expiresAt,
  };
}

export function getUnlockedProductViews(session: Pick<DemoSession, "unlockedProductIds">) {
  return session.unlockedProductIds
    .map((productId) => getProductById(productId))
    .filter((product): product is NonNullable<typeof product> => Boolean(product));
}
