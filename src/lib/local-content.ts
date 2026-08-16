import {
  categories as seededCategories,
  products as seededProducts,
  tags as seededTags,
} from "./seed-data";
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
  return structuredClone({
    products: seededProducts,
    categories: seededCategories,
    tags: seededTags,
    staticPages: seededStaticPages,
  });
}
