import "server-only";

import { cache } from "react";

import {
  getAdminContentSnapshot,
  getPublicContentSnapshot,
  getPublicProductDetailSnapshotForRequest,
} from "./content-repository";
import {
  getAllProductTypesFromSnapshot,
  getCatalogProductsFromSnapshot,
  getFeaturedProductsFromSnapshot,
  getLocalizedProductViewFromSnapshot,
  getPublishedProductViewsFromSnapshot,
  getTranslation,
} from "./products";
import type { Audience, CatalogFilters } from "./types";
import type { Locale } from "@/i18n/routing";

export async function getProductBySlugForRequest(
  slug: string,
  options: { includeDrafts?: boolean } = {},
) {
  const snapshot = options.includeDrafts
    ? await getAdminContentSnapshot()
    : await getPublicContentSnapshot();

  return snapshot.products.find((product) => product.slug === slug);
}

export async function getProductByIdForRequest(
  id: string,
  options: { includeDrafts?: boolean } = {},
) {
  const snapshot = options.includeDrafts
    ? await getAdminContentSnapshot()
    : await getPublicContentSnapshot();

  return snapshot.products.find((product) => product.id === id);
}

export async function getAssetByIdForRequest(assetId: string) {
  const snapshot = await getPublicContentSnapshot();

  return snapshot.products
    .flatMap((product) => product.assets)
    .find((asset) => asset.id === assetId);
}

export async function getLocalizedProductViewForRequest(
  slug: string,
  requestedLocale: string | undefined,
  options: { includeDrafts?: boolean } = {},
) {
  const snapshot = options.includeDrafts
    ? await getAdminContentSnapshot()
    : await getPublicContentSnapshot();

  return getLocalizedProductViewFromSnapshot(snapshot, slug, requestedLocale, options);
}

const getLocalizedProductDetailViewForRequestCached = cache(
  async (slug: string, requestedLocale: string | undefined) => {
    await delayProductDetailForE2E();
    const snapshot = await getPublicProductDetailSnapshotForRequest(slug);

    return snapshot
      ? getLocalizedProductViewFromSnapshot(snapshot, slug, requestedLocale)
      : null;
  },
);

async function delayProductDetailForE2E() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.LAMILIA_BACKEND?.trim().toLowerCase() !== "local"
  ) {
    return;
  }

  const delayMs = Number(process.env.LAMILIA_TEST_PRODUCT_DETAIL_DELAY_MS);

  if (!Number.isSafeInteger(delayMs) || delayMs < 1 || delayMs > 5_000) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function getLocalizedProductDetailViewForRequest(
  slug: string,
  requestedLocale: string | undefined,
) {
  return getLocalizedProductDetailViewForRequestCached(slug, requestedLocale);
}

export async function getPublishedProductViewsForRequest(locale: Locale) {
  return getPublishedProductViewsFromSnapshot(await getPublicContentSnapshot(), locale);
}

export async function getFeaturedProductsForRequest(locale: Locale, audience?: Audience) {
  return getFeaturedProductsFromSnapshot(await getPublicContentSnapshot(), locale, audience);
}

export async function getCatalogProductsForRequest(locale: Locale, filters: CatalogFilters) {
  return getCatalogProductsFromSnapshot(await getPublicContentSnapshot(), locale, filters);
}

export async function getAllProductTypesForRequest() {
  return getAllProductTypesFromSnapshot(await getPublicContentSnapshot());
}

export async function getCategoryOptionsForRequest(locale: Locale) {
  const snapshot = await getPublicContentSnapshot();

  return snapshot.categories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({
      slug: category.slug,
      name: getTranslation(category.translations, locale).name,
    }));
}

export async function getTagOptionsForRequest(locale: Locale) {
  const snapshot = await getPublicContentSnapshot();

  return getTagOptionsFromSnapshot(snapshot, locale);
}

function getTagOptionsFromSnapshot(
  snapshot: Awaited<ReturnType<typeof getPublicContentSnapshot>>,
  locale: Locale,
) {
  return snapshot.tags.map((tag) => ({
    slug: tag.slug,
    name: getTranslation(tag.translations, locale).name,
  }));
}
