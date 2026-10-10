const supportedProviders = new Set([
  "supabase",
  "r2_private",
  "r2_public_pending",
  "r2_public",
  "r2_public_revoking",
]);

export function planProductImageBackfill(row) {
  const product = Array.isArray(row.products) ? row.products[0] : row.products;
  const productStatus = product?.status ?? row.product_status ?? null;
  const base = { productStatus, publicEligible: false };

  if (row.kind !== "cover" && row.kind !== "gallery") {
    return { ...base, disposition: "skip", reason: "unsupported_kind" };
  }
  if (row.bucket !== "public-media") {
    return { ...base, disposition: "skip", reason: "unsupported_bucket" };
  }
  if (!isValidProductImagePath(row)) {
    return { ...base, disposition: "skip", reason: "invalid_product_image_path" };
  }
  if (!supportedProviders.has(row.storage_provider)) {
    return { ...base, disposition: "skip", reason: "unsupported_storage_provider" };
  }
  if (row.storage_provider === "r2_public_revoking") {
    return { ...base, disposition: "skip", reason: "revocation_in_progress" };
  }
  if (row.is_public !== true) {
    return { ...base, disposition: "skip", reason: "legacy_private_visibility_not_supported_by_r2_constraint" };
  }
  if (typeof productStatus !== "string" || !productStatus) {
    return { ...base, disposition: "skip", reason: "missing_product_status" };
  }

  const publicEligible = row.is_active === true && productStatus === "published";
  return {
    ...base,
    disposition: "migrate",
    publicEligible,
    targetProvider: publicEligible ? "r2_public" : "r2_private",
  };
}

export function isValidProductImagePath(row) {
  if (typeof row.product_id !== "string" || typeof row.path !== "string") return false;
  const parts = row.path.split("/");
  return (
    parts.length === 4 &&
    parts[0] === "products" &&
    parts[1] === row.product_id &&
    parts[2] === row.kind &&
    parts.every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}
