import fs from "node:fs";
import path from "node:path";

import type { ContentSnapshot, StaticPageRecord } from "./types";
import {
  categories as seededCategories,
  products as seededProducts,
  tags as seededTags,
} from "./seed-data";

const contentStorePath = path.join(
  process.cwd(),
  "data",
  "lamilialomi-content.local.json",
);

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
    id: "static-privacy-pl",
    slug: "privacy",
    locale: "pl",
    title: "Polityka prywatnosci",
    body: "LamiliaLomi przechowuje dane konta, zgody, odblokowania produktow i zdarzenia pobran tylko w celu obslugi konta oraz materialow premium. Podmien ten placeholder przed produkcja.",
    updatedAt: "2026-05-31T00:00:00.000Z",
  },
  {
    id: "static-privacy-de",
    slug: "privacy",
    locale: "de",
    title: "Datenschutzerklaerung",
    body: "Replace with the final German privacy policy before production.",
    updatedAt: "2026-05-31T00:00:00.000Z",
  },
  {
    id: "static-privacy-es",
    slug: "privacy",
    locale: "es",
    title: "Politica de privacidad",
    body: "Replace with the final Spanish privacy policy before production.",
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
  {
    id: "static-terms-pl",
    slug: "terms",
    locale: "pl",
    title: "Regulamin",
    body: "Konto wymaga akceptacji regulaminu i polityki prywatnosci. Zgoda marketingowa jest osobna i dobrowolna. Podmien ten placeholder przed produkcja.",
    updatedAt: "2026-05-31T00:00:00.000Z",
  },
  {
    id: "static-terms-de",
    slug: "terms",
    locale: "de",
    title: "Nutzungsbedingungen",
    body: "Replace with the final German terms before production.",
    updatedAt: "2026-05-31T00:00:00.000Z",
  },
  {
    id: "static-terms-es",
    slug: "terms",
    locale: "es",
    title: "Terminos",
    body: "Replace with the final Spanish terms before production.",
    updatedAt: "2026-05-31T00:00:00.000Z",
  },
];

export function getSeedContentSnapshot(): ContentSnapshot {
  return cloneSnapshot({
    products: seededProducts,
    categories: seededCategories,
    tags: seededTags,
    staticPages: seededStaticPages,
  });
}

export function getContentStorePath() {
  return contentStorePath;
}

export function getContentSnapshot(): ContentSnapshot {
  if (process.env.VITEST) {
    return getSeedContentSnapshot();
  }

  if (!fs.existsSync(contentStorePath)) {
    return getSeedContentSnapshot();
  }

  try {
    const stored = JSON.parse(fs.readFileSync(contentStorePath, "utf8")) as Partial<ContentSnapshot>;
    const seed = getSeedContentSnapshot();

    return cloneSnapshot({
      products: Array.isArray(stored.products) ? stored.products : seed.products,
      categories: Array.isArray(stored.categories) ? stored.categories : seed.categories,
      tags: Array.isArray(stored.tags) ? stored.tags : seed.tags,
      staticPages: Array.isArray(stored.staticPages)
        ? stored.staticPages
        : seed.staticPages,
    });
  } catch {
    return getSeedContentSnapshot();
  }
}

export function saveContentSnapshot(snapshot: ContentSnapshot) {
  fs.mkdirSync(path.dirname(contentStorePath), { recursive: true });
  fs.writeFileSync(contentStorePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

function cloneSnapshot(snapshot: ContentSnapshot): ContentSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ContentSnapshot;
}
