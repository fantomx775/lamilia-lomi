import "server-only";

import { cache } from "react";
import { getBackendMode } from "./config";
import { createClient } from "./supabase/server";

import {
  getAdminContentSnapshot,
  getPublicCatalogSnapshotForRequest,
  getPublicHomeProductSnapshotForRequest,
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

  const current = snapshot.products.find((product) => product.slug === slug);
  if (current || options.includeDrafts) return current;
  const productId = await resolveHistoricalProductSlug(slug);
  return productId ? snapshot.products.find((product) => product.id === productId) : undefined;
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

export async function getAssetByIdForRequest(
  assetId: string,
  options: { includeDrafts?: boolean } = {},
) {
  const snapshot = options.includeDrafts
    ? await getAdminContentSnapshot()
    : await getPublicContentSnapshot();

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

  const current = getLocalizedProductViewFromSnapshot(snapshot, slug, requestedLocale, options);
  if (current || options.includeDrafts) return current;
  const productId = await resolveHistoricalProductSlug(slug);
  const product = productId ? snapshot.products.find((item) => item.id === productId) : null;
  return product ? getLocalizedProductViewFromSnapshot(snapshot, product.slug, requestedLocale, options) : null;
}

async function resolveHistoricalProductSlug(slug: string): Promise<string | null> {
  if (getBackendMode() !== "supabase" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("product_slug_aliases").select("product_id").eq("slug", slug).maybeSingle();
  if (error) throw new Error("Could not resolve the printed book link.");
  return typeof data?.product_id === "string" ? data.product_id : null;
}

export async function getLocalizedProductViewByIdForRequest(
  productId: string,
  requestedLocale: string | undefined,
) {
  const snapshot = await getPublicContentSnapshot();
  const product = snapshot.products.find((item) => item.id === productId);

  return product
    ? getLocalizedProductViewFromSnapshot(snapshot, product.slug, requestedLocale)
    : null;
}

const getLocalizedProductDetailViewForRequestCached = cache(
  async (slug: string, requestedLocale: string | undefined) => {
    await delayProductDetailForE2E();
    let snapshot = await getPublicProductDetailSnapshotForRequest(slug);
    if (!snapshot) {
      const productId = await resolveHistoricalProductSlug(slug);
      const product = productId ? await getProductByIdForRequest(productId) : null;
      if (product) {
        snapshot = await getPublicProductDetailSnapshotForRequest(product.slug);
        slug = product.slug;
      }
    }

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
  return getFeaturedProductsFromSnapshot(
    await getPublicHomeProductSnapshotForRequest(locale),
    locale,
    audience,
  );
}

export async function getCatalogProductsForRequest(locale: Locale, filters: CatalogFilters) {
  return getCatalogProductsFromSnapshot(
    await getPublicCatalogSnapshotForRequest(locale),
    locale,
    filters,
  );
}

export async function getAllProductTypesForRequest() {
  return getAllProductTypesFromSnapshot(await getPublicContentSnapshot());
}

export async function getCategoryOptionsForRequest(locale: Locale) {
  const snapshot = await getPublicContentSnapshot();

  return snapshot.categories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((category) => {
      const translation = getTranslation(category.translations, locale);

      return translation ? [{ slug: category.slug, name: translation.name }] : [];
    });
}

export async function getTagOptionsForRequest(locale: Locale) {
  const snapshot = await getPublicContentSnapshot();

  return getTagOptionsFromSnapshot(snapshot, locale);
}

function getTagOptionsFromSnapshot(
  snapshot: Awaited<ReturnType<typeof getPublicContentSnapshot>>,
  locale: Locale,
) {
  return snapshot.tags.flatMap((tag) => {
    const translation = getTranslation(tag.translations, locale);

    return translation ? [{ slug: tag.slug, name: translation.name }] : [];
  });
}
