import "server-only";

import { cache } from "react";

import { getBackendMode } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

import type {
  AmazonLink,
  Category,
  ContentSnapshot,
  Product,
  ProductAsset,
  ProductTranslation,
  PremiumCode,
  StaticPageRecord,
  Tag,
  TaxonomyTranslation,
} from "./types";

type DbRow = Record<string, unknown>;

export const getPublicContentSnapshot = cache(async () =>
  getContentSnapshotForRequest({ includePremiumCodes: false }),
);

export const getAdminContentSnapshot = cache(async () =>
  getContentSnapshotForRequest({ includePremiumCodes: true }),
);

export async function getContentSnapshotForRequest(options: {
  includePremiumCodes?: boolean;
} = {}): Promise<ContentSnapshot> {
  if (getBackendMode() === "local") {
    const { getContentSnapshot } = await import("./content-store");

    return getContentSnapshot();
  }

  const supabase = await createClient();
  const [
    productRows,
    productTranslationRows,
    productCategoryRows,
    productTagRows,
    assetRows,
    amazonRows,
    categoryRows,
    categoryTranslationRows,
    tagRows,
    tagTranslationRows,
    staticPageRows,
    premiumCodeRows,
  ] = await Promise.all([
    selectRows(supabase, "products"),
    selectRows(supabase, "product_translations"),
    selectRows(supabase, "product_categories"),
    selectRows(supabase, "product_tags"),
    selectRows(supabase, "product_assets"),
    selectRows(supabase, "amazon_links"),
    selectRows(supabase, "categories"),
    selectRows(supabase, "category_translations"),
    selectRows(supabase, "tags"),
    selectRows(supabase, "tag_translations"),
    selectRows(supabase, "static_pages"),
    options.includePremiumCodes
      ? selectRows(supabase, "premium_codes")
      : Promise.resolve([]),
  ]);

  const categoryTranslations = groupByString(categoryTranslationRows, "category_id");
  const tagTranslations = groupByString(tagTranslationRows, "tag_id");
  const translations = groupByString(productTranslationRows, "product_id");
  const assets = groupByString(assetRows, "product_id");
  const amazonLinks = groupByString(amazonRows, "product_id");
  const premiumCodes = groupByString(premiumCodeRows, "product_id");
  const productCategories = groupByString(productCategoryRows, "product_id");
  const productTags = groupByString(productTagRows, "product_id");

  const categories = categoryRows.map((row) =>
    mapCategory(row, categoryTranslations.get(stringValue(row.id)) ?? []),
  );
  const tags = tagRows.map((row) =>
    mapTag(row, tagTranslations.get(stringValue(row.id)) ?? []),
  );

  return {
    products: productRows.map((row) =>
      mapProduct(
        row,
        translations.get(stringValue(row.id)) ?? [],
        productCategories.get(stringValue(row.id)) ?? [],
        productTags.get(stringValue(row.id)) ?? [],
        assets.get(stringValue(row.id)) ?? [],
        amazonLinks.get(stringValue(row.id)) ?? [],
        premiumCodes.get(stringValue(row.id)) ?? [],
      ),
    ),
    categories,
    tags,
    staticPages: staticPageRows
      .map(mapStaticPage)
      .filter((page): page is StaticPageRecord => Boolean(page)),
  };
}

async function selectRows(
  client: Awaited<ReturnType<typeof createClient>>,
  table: string,
) {
  const { data, error } = await client.from(table).select("*");

  if (error) {
    throw new Error(`Supabase ${table} read failed: ${error.message}`);
  }

  return (data ?? []) as DbRow[];
}

function mapProduct(
  row: DbRow,
  translationRows: DbRow[],
  categoryRows: DbRow[],
  tagRows: DbRow[],
  assetRows: DbRow[],
  amazonRows: DbRow[],
  premiumCodeRows: DbRow[],
): Product {
  return {
    id: stringValue(row.id),
    slug: stringValue(row.slug),
    status: row.status as Product["status"],
    audience: row.audience as Product["audience"],
    productType: stringValue(row.product_type),
    coverAssetId: stringValue(row.cover_asset_id),
    videoAssetId: optionalString(row.video_asset_id),
    reviewDelayDays: numberValue(row.review_delay_days, 14),
    sortOrder: numberValue(row.sort_order, 100),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at),
    translations: translationRows.map(mapProductTranslation),
    categoryIds: categoryRows.map((item) => stringValue(item.category_id)),
    tagIds: tagRows.map((item) => stringValue(item.tag_id)),
    assets: assetRows.map(mapAsset),
    amazonLinks: amazonRows.map(mapAmazonLink),
    premiumCodes: premiumCodeRows.map(mapPremiumCode),
  };
}

function mapProductTranslation(row: DbRow): ProductTranslation {
  return {
    locale: row.locale as ProductTranslation["locale"],
    title: stringValue(row.title),
    shortDescription: stringValue(row.short_description),
    longDescription: stringValue(row.long_description),
    seoTitle: optionalString(row.seo_title),
    seoDescription: optionalString(row.seo_description),
  };
}

function mapCategory(row: DbRow, translationRows: DbRow[]): Category {
  return {
    id: stringValue(row.id),
    slug: stringValue(row.slug),
    sortOrder: numberValue(row.sort_order, 100),
    translations: translationRows.map(mapTaxonomyTranslation),
  };
}

function mapTag(row: DbRow, translationRows: DbRow[]): Tag {
  return {
    id: stringValue(row.id),
    slug: stringValue(row.slug),
    translations: translationRows.map(mapTaxonomyTranslation),
  };
}

function mapTaxonomyTranslation(row: DbRow): TaxonomyTranslation {
  return {
    locale: row.locale as TaxonomyTranslation["locale"],
    name: stringValue(row.name),
    description: optionalString(row.description),
  };
}

function mapAsset(row: DbRow): ProductAsset {
  const kind = row.kind as ProductAsset["kind"];

  return {
    id: stringValue(row.id),
    productId: stringValue(row.product_id),
    kind,
    bucket: stringValue(row.bucket),
    path: Boolean(row.is_public) && !stringValue(row.path).startsWith("/")
      ? `/${stringValue(row.path)}`
      : stringValue(row.path),
    filename: stringValue(row.filename),
    contentType: stringValue(row.content_type),
    sizeBytes: numberOrUndefined(row.size_bytes),
    locale: row.locale as ProductAsset["locale"],
    title: optionalString(row.title),
    sortOrder: numberValue(row.sort_order, 100),
    isPublic: Boolean(row.is_public),
    isActive: row.is_active === undefined ? true : Boolean(row.is_active),
  };
}

function mapAmazonLink(row: DbRow): AmazonLink {
  return {
    id: stringValue(row.id),
    productId: stringValue(row.product_id),
    market: row.market as AmazonLink["market"],
    url: stringValue(row.url),
    isPrimary: Boolean(row.is_primary),
  };
}

function mapPremiumCode(row: DbRow): PremiumCode {
  return {
    id: stringValue(row.id),
    productId: stringValue(row.product_id),
    code: stringValue(row.code),
    active: Boolean(row.active),
  };
}

function mapStaticPage(row: DbRow): StaticPageRecord | null {
  if (row.slug !== "privacy" && row.slug !== "terms") {
    return null;
  }

  return {
    id: stringValue(row.id),
    slug: row.slug,
    locale: row.locale as StaticPageRecord["locale"],
    title: stringValue(row.title),
    body: stringValue(row.body),
    updatedAt: stringValue(row.updated_at),
  };
}

function groupByString(rows: DbRow[], key: string) {
  const grouped = new Map<string, DbRow[]>();

  for (const row of rows) {
    const value = optionalString(row[key]);

    if (!value) {
      continue;
    }

    const current = grouped.get(value) ?? [];
    current.push(row);
    grouped.set(value, current);
  }

  return grouped;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
