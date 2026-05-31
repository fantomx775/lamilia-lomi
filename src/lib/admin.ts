import { demoUsers } from "./seed-data";
import type { Product } from "./types";
import { slugify } from "./utils";

export function validateProductForPublish(product: Pick<Product, "translations" | "amazonLinks">) {
  const english = product.translations.find((translation) => translation.locale === "en");

  return {
    ok: Boolean(english?.title && product.amazonLinks.length > 0),
    missing: [
      english?.title ? null : "English title",
      product.amazonLinks.length > 0 ? null : "Amazon link",
    ].filter((item): item is string => Boolean(item)),
  };
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
