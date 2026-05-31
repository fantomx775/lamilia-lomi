import type { Metadata } from "next";

import type { Locale } from "@/i18n/routing";

import { defaultLocale, normalizeLocale } from "./locale";
import { categories, products, tags } from "./seed-data";
import type {
  Audience,
  CatalogFilters,
  LocalizedProductView,
  Product,
  ProductAsset,
  ProductTranslation,
  TaxonomyTranslation,
} from "./types";

export function isPublicProduct(product: Product) {
  return product.status === "published";
}

export function getAudienceLabel(audience: Audience, locale: Locale) {
  if (locale === "pl") {
    return audience === "kids" ? "Dzieci" : "Dorośli";
  }

  return audience === "kids" ? "Kids" : "Adults";
}

export function getAudiencePath(audience: Audience, locale: Locale) {
  return `/${locale}/products?audience=${audience}`;
}

export function getTranslation<T extends ProductTranslation | TaxonomyTranslation>(
  translations: T[],
  locale: Locale,
): T {
  return (
    translations.find((translation) => translation.locale === locale) ??
    translations.find((translation) => translation.locale === defaultLocale) ??
    translations[0]
  );
}

export function pickPrimaryAmazonLink(product: Product) {
  return (
    product.amazonLinks.find((link) => link.isPrimary) ?? product.amazonLinks[0]
  );
}

export function getProductBySlug(slug: string) {
  return products.find((product) => product.slug === slug);
}

export function getProductById(id: string) {
  return products.find((product) => product.id === id);
}

export function getAssetById(assetId: string) {
  return products.flatMap((product) => product.assets).find((asset) => asset.id === assetId);
}

export function getLocalizedProductView(
  slug: string,
  requestedLocale: string | undefined,
  options: { includeDrafts?: boolean } = {},
): LocalizedProductView | null {
  const product = getProductBySlug(slug);
  const locale = normalizeLocale(requestedLocale);

  if (!product) {
    return null;
  }

  if (!options.includeDrafts && !isPublicProduct(product)) {
    return null;
  }

  const translation = getTranslation(product.translations, locale);
  const cover = product.assets.find((asset) => asset.id === product.coverAssetId);

  if (!cover) {
    throw new Error(`Product ${product.slug} has no cover asset`);
  }

  return {
    id: product.id,
    slug: product.slug,
    status: product.status,
    audience: product.audience,
    audienceLabel: getAudienceLabel(product.audience, locale),
    productType: product.productType,
    title: translation.title,
    shortDescription: translation.shortDescription,
    longDescription: translation.longDescription,
    seoTitle: translation.seoTitle ?? translation.title,
    seoDescription: translation.seoDescription ?? translation.shortDescription,
    cover,
    gallery: sortAssets(product.assets.filter((asset) => asset.kind === "gallery")),
    video: product.assets.find((asset) => asset.kind === "video"),
    premiumAssets: sortAssets(
      product.assets.filter((asset) => asset.kind === "premium_download"),
    ),
    categories: product.categoryIds
      .map((categoryId) => categories.find((category) => category.id === categoryId))
      .filter((category): category is NonNullable<typeof category> => Boolean(category))
      .map((category) => ({
        ...category,
        name: getTranslation(category.translations, locale).name,
      })),
    tags: product.tagIds
      .map((tagId) => tags.find((tag) => tag.id === tagId))
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
      .map((tag) => ({
        ...tag,
        name: getTranslation(tag.translations, locale).name,
      })),
    amazonLinks: product.amazonLinks,
    primaryAmazonLink: pickPrimaryAmazonLink(product),
    reviewDelayDays: product.reviewDelayDays,
  };
}

export function getPublishedProductViews(locale: Locale) {
  return products
    .filter(isPublicProduct)
    .map((product) => getLocalizedProductView(product.slug, locale))
    .filter((product): product is LocalizedProductView => Boolean(product));
}

export function getFeaturedProducts(locale: Locale, audience?: Audience) {
  return getPublishedProductViews(locale)
    .filter((product) => (audience ? product.audience === audience : true))
    .sort((a, b) => a.reviewDelayDays - b.reviewDelayDays || a.title.localeCompare(b.title))
    .slice(0, audience ? 2 : 4);
}

export function parseCatalogFilters(
  searchParams: Record<string, string | string[] | undefined>,
): CatalogFilters {
  const value = (key: string) => {
    const raw = searchParams[key];

    return Array.isArray(raw) ? raw[0] : raw;
  };
  const audience = value("audience");
  const sort = value("sort");

  return {
    q: normalizeText(value("q")),
    audience: audience === "kids" || audience === "adults" ? audience : undefined,
    productType: normalizeText(value("type")),
    category: normalizeText(value("category")),
    tag: normalizeText(value("tag")),
    sort: sort === "newest" || sort === "az" ? sort : "manual",
  };
}

export function getCatalogProducts(locale: Locale, filters: CatalogFilters) {
  const normalizedQuery = normalizeText(filters.q);

  const filtered = getPublishedProductViews(locale).filter((product) => {
    if (filters.audience && product.audience !== filters.audience) {
      return false;
    }

    if (filters.productType && product.productType !== filters.productType) {
      return false;
    }

    if (
      filters.category &&
      !product.categories.some((category) => category.slug === filters.category)
    ) {
      return false;
    }

    if (filters.tag && !product.tags.some((tag) => tag.slug === filters.tag)) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const searchable = [
      product.title,
      product.shortDescription,
      product.longDescription,
      ...product.categories.map((category) => category.name),
      ...product.tags.map((tag) => tag.name),
    ]
      .join(" ")
      .toLowerCase();

    return searchable.includes(normalizedQuery.toLowerCase());
  });

  return filtered.sort((a, b) => {
    if (filters.sort === "az") {
      return a.title.localeCompare(b.title);
    }

    if (filters.sort === "newest") {
      return (
        Date.parse(getProductById(b.id)?.createdAt ?? "") -
        Date.parse(getProductById(a.id)?.createdAt ?? "")
      );
    }

    return (
      (getProductById(a.id)?.sortOrder ?? 0) - (getProductById(b.id)?.sortOrder ?? 0)
    );
  });
}

export function getAllProductTypes() {
  return Array.from(new Set(products.filter(isPublicProduct).map((product) => product.productType)));
}

export function buildProductMetadata(
  product: LocalizedProductView,
  locale: Locale,
  appUrl = "http://localhost:3000",
): Metadata {
  const canonical = `${appUrl}/${locale}/products/${product.slug}`;

  return {
    title: product.seoTitle,
    description: product.seoDescription,
    alternates: {
      canonical,
      languages: {
        en: `${appUrl}/en/products/${product.slug}`,
        pl: `${appUrl}/pl/products/${product.slug}`,
      },
    },
    openGraph: {
      title: product.seoTitle,
      description: product.seoDescription,
      url: canonical,
      siteName: "LamiliaLomi",
      images: [
        {
          url: product.cover.path,
          width: 1200,
          height: 1600,
          alt: product.cover.title ?? product.title,
        },
      ],
      locale,
      type: "website",
    },
  };
}

export function buildProductJsonLd(
  product: LocalizedProductView,
  locale: Locale,
  appUrl = "http://localhost:3000",
) {
  return {
    "@context": "https://schema.org",
    "@type": product.productType.includes("book") ? "Book" : "Product",
    name: product.title,
    description: product.shortDescription,
    image: `${appUrl}${product.cover.path}`,
    url: `${appUrl}/${locale}/products/${product.slug}`,
    brand: {
      "@type": "Brand",
      name: "LamiliaLomi",
    },
    offers: product.primaryAmazonLink
      ? {
          "@type": "Offer",
          availability: "https://schema.org/InStock",
          url: product.primaryAmazonLink.url,
        }
      : undefined,
  };
}

export function getCategoryOptions(locale: Locale) {
  return categories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({
      slug: category.slug,
      name: getTranslation(category.translations, locale).name,
    }));
}

export function getTagOptions(locale: Locale) {
  return tags.map((tag) => ({
    slug: tag.slug,
    name: getTranslation(tag.translations, locale).name,
  }));
}

function sortAssets(assets: ProductAsset[]) {
  return assets.slice().sort((a, b) => a.sortOrder - b.sortOrder);
}

function normalizeText(value: string | undefined) {
  const normalized = value?.trim();

  return normalized ? normalized : undefined;
}
