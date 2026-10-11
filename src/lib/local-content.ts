import {
  categories as seededCategories,
  products as seededProducts,
  tags as seededTags,
} from "./seed-data";
import { DEFAULT_CATALOG_SETTINGS } from "./catalog-settings";
import type { ContentSnapshot, StaticPageRecord } from "./types";

const seededStaticPages: StaticPageRecord[] = [
  {
    id: "static-privacy-en",
    slug: "privacy",
    locale: "en",
    title: "Privacy Policy",
    body: "LamiliaLomi stores account data, consents, product unlocks, and download events only to operate accounts and premium materials. Replace this placeholder before production.",
    updatedAt: "2026-05-31T00:00:00.000Z",
  },
  {
    id: "static-terms-en",
    slug: "terms",
    locale: "en",
    title: "Terms",
    body: "An account requires acceptance of terms and privacy. Marketing consent is separate and optional. Replace this placeholder before production.",
    updatedAt: "2026-05-31T00:00:00.000Z",
  },
];

export function getSeedContentSnapshot(): ContentSnapshot {
  return structuredClone({
    products: seededProducts,
    categories: seededCategories,
    tags: seededTags,
    staticPages: seededStaticPages,
    catalogSettings: DEFAULT_CATALOG_SETTINGS,
  });
}
