import { demoUsers } from "./seed-data";
import type { Product } from "./types";
import { validateProductForPublish as validateProductForPublishFromContent } from "./admin-content";
import { slugify } from "./utils";

export function validateProductForPublish(
  product: Pick<Product, "translations" | "amazonLinks"> &
    Partial<Pick<Product, "assets" | "coverAssetId">>,
) {
  return validateProductForPublishFromContent({
    ...product,
    assets: product.assets ?? [],
    coverAssetId: product.coverAssetId ?? "",
  });
}

export function buildProductSlug(title: string) {
  return slugify(title);
}

export function exportUsersToCsv(options: { marketingOnly?: boolean } = {}) {
  const rows = demoUsers
    .filter((user) => (options.marketingOnly ? user.marketingConsent : true))
    .map((user) => [
      user.email,
      user.role,
      user.emailVerified ? "verified" : "unverified",
      user.marketingConsent ? "yes" : "no",
      user.unlockedProductIds.length.toString(),
    ]);

  return [
    ["email", "role", "email_status", "marketing_consent", "unlocks"].join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\n");
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}
