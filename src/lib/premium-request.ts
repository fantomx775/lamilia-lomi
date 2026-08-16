import "server-only";

import { getBackendMode } from "./config";
import { getContentSnapshot } from "./content-store";
import { getSupabaseAuthContext, getDemoSession, setDemoSession } from "./session.server";
import { getAssetByIdForRequest } from "./products-request";
import type { ProductAsset } from "./types";
import { getProductBySlug } from "./products";
import {
  canDownloadPremiumAsset,
  createSignedDownloadUrl,
  normalizePremiumCode,
} from "./premium-core";

export type PremiumRedemptionResult =
  | {
      ok: true;
      status: "success" | "already_unlocked";
      productId: string;
      premiumCodeId: string;
      normalizedCode: string;
    }
  | {
      ok: false;
      status:
        | "auth_required"
        | "email_unverified"
        | "invalid_code"
        | "inactive_code"
        | "wrong_product"
        | "product_not_found";
    };

export async function redeemPremiumCodeForRequest(input: {
  productSlug: string;
  productId: string;
  code: string | null | undefined;
}): Promise<PremiumRedemptionResult> {
  const normalizedCode = normalizePremiumCode(input.code);

  if (getBackendMode() === "local") {
    const session = await getDemoSession();

    if (!session) {
      return { ok: false, status: "auth_required" };
    }

    if (!session.emailVerified) {
      return { ok: false, status: "email_unverified" };
    }

    const product = getProductBySlug(input.productSlug);

    if (!product || product.id !== input.productId) {
      return { ok: false, status: "product_not_found" };
    }

    const matchingCode = getContentSnapshot()
      .products
      .flatMap((item) => item.premiumCodes)
      .find((item) => normalizePremiumCode(item.code) === normalizedCode);

    if (!normalizedCode || !matchingCode) {
      return { ok: false, status: "invalid_code" };
    }

    if (matchingCode.productId !== product.id) {
      return { ok: false, status: "wrong_product" };
    }

    if (!matchingCode.active) {
      return { ok: false, status: "inactive_code" };
    }

    const alreadyUnlocked = session.unlockedProductIds.includes(product.id);

    if (!alreadyUnlocked) {
      await setDemoSession({
        ...session,
        unlockedProductIds: [...session.unlockedProductIds, product.id],
      });
    }

    return {
      ok: true,
      status: alreadyUnlocked ? "already_unlocked" : "success",
      productId: product.id,
      premiumCodeId: matchingCode.id,
      normalizedCode,
    };
  }

  const { supabase, user } = await getSupabaseAuthContext();

  if (!supabase || !user) {
    return { ok: false, status: "auth_required" };
  }

  const { data, error } = await supabase.rpc("redeem_premium_code", {
    requested_product_id: input.productId,
    requested_code: input.code ?? "",
  });

  if (error) {
    throw new Error(`Supabase premium redemption failed: ${error.message}`);
  }

  return mapPremiumRedemptionResult(data, normalizedCode, input.productId);
}

export async function authorizePremiumDownloadForRequest(assetId: string) {
  if (getBackendMode() === "local") {
    const session = await getDemoSession();
    const asset = await getAssetByIdForRequest(assetId);

    if (!session || !asset) {
      return {
        ok: false as const,
        decision: canDownloadPremiumAsset({ session, asset }),
      };
    }

    return createSignedDownloadUrl({ asset, session });
  }

  const { supabase, user } = await getSupabaseAuthContext();

  if (!supabase || !user) {
    return {
      ok: false as const,
      decision: { allowed: false as const, reason: "guest" as const },
    };
  }

  const { data: assetRow, error: assetError } = await supabase
    .from("product_assets")
    .select("id, product_id, kind, bucket, path, filename, content_type, size_bytes, locale, title, sort_order, is_public")
    .eq("id", assetId)
    .maybeSingle();

  if (assetError) {
    throw new Error(`Supabase premium asset authorization failed: ${assetError.message}`);
  }

  if (!assetRow) {
    return {
      ok: false as const,
      decision: { allowed: false as const, reason: "locked" as const },
    };
  }

  const asset = {
    id: assetRow.id,
    productId: assetRow.product_id,
    kind: assetRow.kind,
    bucket: assetRow.bucket,
    path: assetRow.path,
    filename: assetRow.filename,
    contentType: assetRow.content_type,
    sizeBytes: assetRow.size_bytes ?? undefined,
    locale: assetRow.locale ?? undefined,
    title: assetRow.title ?? undefined,
    sortOrder: assetRow.sort_order,
    isPublic: assetRow.is_public,
  } satisfies ProductAsset;

  if (asset.kind !== "premium_download" || asset.isPublic) {
    return {
      ok: false as const,
      decision: { allowed: false as const, reason: "wrong_asset" as const },
    };
  }

  const { data: signedUrl, error: signedUrlError } = await supabase.storage
    .from(asset.bucket)
    .createSignedUrl(asset.path, 10 * 60);

  if (signedUrlError || !signedUrl?.signedUrl) {
    throw new Error(
      `Supabase premium asset signing failed: ${signedUrlError?.message ?? "missing signed URL"}`,
    );
  }

  const { error: eventError } = await supabase.rpc("record_download_event", {
    requested_asset_id: asset.id,
  });

  if (eventError) {
    throw new Error(`Supabase download event write failed: ${eventError.message}`);
  }

  return {
    ok: true as const,
    url: signedUrl.signedUrl,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  };
}

function mapPremiumRedemptionResult(
  data: unknown,
  normalizedCode: string,
  productId: string,
): PremiumRedemptionResult {
  const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const status = row.status;

  if (status === "success" || status === "already_unlocked") {
    return {
      ok: true,
      status,
      productId: stringValue(row.product_id) || productId,
      premiumCodeId: stringValue(row.premium_code_id),
      normalizedCode,
    };
  }

  if (
    status === "auth_required" ||
    status === "email_unverified" ||
    status === "invalid_code" ||
    status === "inactive_code" ||
    status === "wrong_product" ||
    status === "product_not_found"
  ) {
    return { ok: false, status };
  }

  throw new Error("Supabase premium redemption returned an unknown result.");
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
