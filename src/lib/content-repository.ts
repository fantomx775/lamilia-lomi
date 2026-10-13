import "server-only";

import { cache } from "react";

import { getBackendMode } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

import { normalizeCatalogSettings } from "./catalog-settings";
import { normalizeAboutPageSettings } from "./about-settings";
import { getR2PublicBaseUrl, r2PublicMediaUrl } from "./media-r2-config";
import type {
  AmazonLink,
  AboutPageSettings,
  Category,
  CatalogSettings,
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
const PREMIUM_CODE_PAGE_SIZE = 1_000;

export const getPublicContentSnapshot = cache(async () =>
  getContentSnapshotForRequest({ includePremiumCodes: false }),
);

export const getPublicProductDetailSnapshotForRequest = cache(
  async (slug: string): Promise<ContentSnapshot | null> => {
    if (getBackendMode() === "local") {
      const snapshot = await getPublicContentSnapshot();
      return snapshot.products.some(
        (product) => product.slug === slug && product.status === "published",
      )
        ? snapshot
        : null;
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("products")
      .select(
        `
          id,
          slug,
          status,
          audience,
          product_type,
          cover_asset_id,
          video_asset_id,
          review_delay_days,
          sort_order,
          created_at,
          updated_at,
          product_translations (
            locale,
            title,
            short_description,
            long_description,
            seo_title,
            seo_description
          ),
          product_categories (
            category_id,
            category:categories (
              id,
              slug,
              sort_order,
              image_asset_id,
              image_storage_path,
              image_storage_provider,
              image_filename,
              image_content_type,
              image_size_bytes,
              category_translations ( locale, name, description )
            )
          ),
          product_tags (
            tag_id,
            tag:tags (
              id,
              slug,
              tag_translations ( locale, name )
            )
          ),
          product_assets!product_assets_product_id_fkey (
            id,
            product_id,
            kind,
            bucket,
            path,
            filename,
            content_type,
            size_bytes,
            locale,
            title,
            sort_order,
            is_public,
            is_active,
            storage_provider
          ),
          amazon_links ( id, product_id, market, url, is_primary )
        `,
      )
      .eq("slug", slug)
      .eq("status", "published")
      .eq("product_assets.is_active", true)
      .maybeSingle();

    if (error) {
      throw new Error(`Supabase product detail read failed: ${error.message}`);
    }

    return data ? mapPublicProductDetailRow(data as DbRow) : null;
  },
);

export const getPublicHomeProductSnapshotForRequest = cache(
  async (locale: string): Promise<ContentSnapshot> => {
    if (getBackendMode() === "local") {
      return getPublicContentSnapshot();
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("products")
      .select(`
        id,
        slug,
        status,
        audience,
        product_type,
        cover_asset_id,
        review_delay_days,
        sort_order,
        product_translations!inner ( locale, title, short_description ),
        product_assets!product_assets_product_id_fkey (
          id,
          product_id,
          kind,
          bucket,
          path,
          filename,
          content_type,
          size_bytes,
          locale,
          title,
          sort_order,
          is_public,
          is_active,
          storage_provider
        )
      `)
      .eq("status", "published")
      .eq("product_translations.locale", locale)
      .eq("product_assets.is_active", true)
      .eq("product_assets.kind", "cover");

    if (error) {
      throw new Error(`Supabase Home products read failed: ${error.message}`);
    }

    return {
      products: rowsValue(data).map((row) =>
        mapProduct(
          row,
          rowsValue(row.product_translations),
          [],
          [],
          rowsValue(row.product_assets),
          [],
          [],
        ),
      ),
      categories: [],
      tags: [],
      staticPages: [],
      catalogSettings: normalizeCatalogSettings(undefined),
      aboutPageSettings: normalizeAboutPageSettings(undefined),
    };
  },
);

export const getPublicCatalogSnapshotForRequest = cache(
  async (locale: string): Promise<ContentSnapshot> => {
    if (getBackendMode() === "local") {
      return getPublicContentSnapshot();
    }

    const supabase = await createClient();
    const [productResult, categoryResult, tagResult, settingsResult] =
      await Promise.all([
        supabase
          .from("products")
          .select(`
            id,
            slug,
            status,
            audience,
            product_type,
            cover_asset_id,
            review_delay_days,
            sort_order,
            created_at,
            product_translations!inner ( locale, title, short_description, long_description, seo_title, seo_description ),
            product_categories ( category_id ),
            product_tags ( tag_id ),
            product_assets!product_assets_product_id_fkey (
              id,
              product_id,
              kind,
              bucket,
              path,
              filename,
              content_type,
              size_bytes,
              locale,
              title,
              sort_order,
              is_public,
              is_active,
              storage_provider
            )
          `)
          .eq("status", "published")
          .eq("product_translations.locale", locale)
          .eq("product_assets.is_active", true)
          .eq("product_assets.kind", "cover"),
        supabase
          .from("categories")
          .select(`
            id,
            slug,
            sort_order,
            image_asset_id,
            image_storage_path,
            image_storage_provider,
            image_filename,
            image_content_type,
            image_size_bytes,
            category_translations!inner ( locale, name, description )
          `)
          .eq("category_translations.locale", locale),
        supabase
          .from("tags")
          .select(`
            id,
            slug,
            tag_translations!inner ( locale, name )
          `)
          .eq("tag_translations.locale", locale),
        supabase
          .from("catalog_settings")
          .select("desktop_columns")
          .eq("id", "global")
          .maybeSingle(),
      ]);

    if (productResult.error) {
      throw new Error(`Supabase catalog products read failed: ${productResult.error.message}`);
    }
    if (categoryResult.error) {
      throw new Error(`Supabase catalog categories read failed: ${categoryResult.error.message}`);
    }
    if (tagResult.error) {
      throw new Error(`Supabase catalog tags read failed: ${tagResult.error.message}`);
    }
    if (settingsResult.error) {
      throw new Error(`Supabase catalog settings read failed: ${settingsResult.error.message}`);
    }

    const settings = settingsResult.data as DbRow | null;

    return {
      products: rowsValue(productResult.data).map((row) =>
        mapProduct(
          row,
          rowsValue(row.product_translations),
          rowsValue(row.product_categories),
          rowsValue(row.product_tags),
          rowsValue(row.product_assets),
          [],
          [],
        ),
      ),
      categories: rowsValue(categoryResult.data).map((row) =>
        mapCategory(row, rowsValue(row.category_translations)),
      ),
      tags: rowsValue(tagResult.data).map((row) =>
        mapTag(row, rowsValue(row.tag_translations)),
      ),
      staticPages: [],
      catalogSettings: normalizeCatalogSettings(
        settings ? { desktopColumns: settings.desktop_columns } : undefined,
      ),
      aboutPageSettings: normalizeAboutPageSettings(undefined),
    };
  },
);

export const getAdminContentSnapshot = cache(async () =>
  getContentSnapshotForRequest({ includePremiumCodes: true }),
);

export const getCatalogSettingsForRequest = cache(async (): Promise<CatalogSettings> => {
  if (getBackendMode() === "local") {
    const { getContentSnapshot } = await import("./content-store");

    return getContentSnapshot().catalogSettings;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_settings")
    .select("desktop_columns")
    .eq("id", "global")
    .maybeSingle();

  if (error) {
    throw new Error("Supabase catalog settings read failed: " + error.message);
  }

  return normalizeCatalogSettings(
    data ? { desktopColumns: data.desktop_columns } : undefined,
  );
});

export const getAboutPageSettingsForRequest = cache(async (): Promise<AboutPageSettings> => {
  if (getBackendMode() === "local") {
    const { getContentSnapshot } = await import("./content-store");

    return getContentSnapshot().aboutPageSettings;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_settings")
    .select("about_intro, favorite_coloring_book_ids, favorite_picture_book_ids")
    .eq("id", "global")
    .maybeSingle();

  if (error) {
    throw new Error("Supabase About page settings read failed: " + error.message);
  }

  return normalizeAboutPageSettings(data ? {
    intro: data.about_intro,
    favoriteColoringBookIds: data.favorite_coloring_book_ids,
    favoritePictureBookIds: data.favorite_picture_book_ids,
  } : undefined);
});

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
    catalogSettingsRows,
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
    selectRows(supabase, "catalog_settings"),
    options.includePremiumCodes
      ? selectRowsAfterId(supabase, "premium_codes")
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
    catalogSettings: normalizeCatalogSettings(
      catalogSettingsRows[0]
        ? { desktopColumns: catalogSettingsRows[0].desktop_columns }
        : undefined,
    ),
    aboutPageSettings: normalizeAboutPageSettings(catalogSettingsRows[0]
      ? {
          intro: catalogSettingsRows[0].about_intro,
          favoriteColoringBookIds: catalogSettingsRows[0].favorite_coloring_book_ids,
          favoritePictureBookIds: catalogSettingsRows[0].favorite_picture_book_ids,
        }
      : undefined),
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

async function selectRowsAfterId(
  client: Awaited<ReturnType<typeof createClient>>,
  table: string,
) {
  const rows: DbRow[] = [];
  let lastId: string | undefined;

  for (;;) {
    const orderedQuery = client
      .from(table)
      .select("*")
      .order("id", { ascending: true });
    const { data, error } = lastId
      ? await orderedQuery.gt("id", lastId).limit(PREMIUM_CODE_PAGE_SIZE)
      : await orderedQuery.limit(PREMIUM_CODE_PAGE_SIZE);

    if (error) {
      throw new Error(`Supabase ${table} read failed: ${error.message}`);
    }

    const page = (data ?? []) as DbRow[];
    rows.push(...page);

    if (page.length < PREMIUM_CODE_PAGE_SIZE) {
      return rows;
    }

    const nextId = optionalString(page[page.length - 1]?.id);
    if (!nextId || nextId === lastId) {
      throw new Error(`Supabase ${table} pagination did not advance.`);
    }
    lastId = nextId;
  }
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
    assets: assetRows.map((asset) => mapAsset(asset, row.status as Product["status"])),
    amazonLinks: amazonRows.map(mapAmazonLink),
    premiumCodes: premiumCodeRows.map(mapPremiumCode),
  };
}

function mapPublicProductDetailRow(row: DbRow): ContentSnapshot {
  const productCategoryRows = rowsValue(row.product_categories);
  const productTagRows = rowsValue(row.product_tags);
  const categories = productCategoryRows
    .map((item) => {
      const category = recordValue(item.category);
      return category
        ? mapCategory(category, rowsValue(category.category_translations))
        : null;
    })
    .filter((category): category is Category => Boolean(category));
  const tags = productTagRows
    .map((item) => {
      const tag = recordValue(item.tag);
      return tag ? mapTag(tag, rowsValue(tag.tag_translations)) : null;
    })
    .filter((tag): tag is Tag => Boolean(tag));

  return {
    products: [
      mapProduct(
        row,
        rowsValue(row.product_translations),
        productCategoryRows,
        productTagRows,
        rowsValue(row.product_assets),
        rowsValue(row.amazon_links),
        [],
      ),
    ],
    categories,
    tags,
    staticPages: [],
    catalogSettings: normalizeCatalogSettings(undefined),
    aboutPageSettings: normalizeAboutPageSettings(undefined),
  };
}

function rowsValue(value: unknown): DbRow[] {
  return Array.isArray(value) ? value.filter(isDbRow) : [];
}

function recordValue(value: unknown): DbRow | null {
  return isDbRow(value) ? value : null;
}

function isDbRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const id = stringValue(row.id);
  const imageId = optionalString(row.image_asset_id);
  const storagePath = optionalString(row.image_storage_path);
  const storageProvider = row.image_storage_provider === "r2_public" ? "r2_public" : "supabase";
  const imagePath = imageId && storagePath
    ? storageProvider === "r2_public"
      ? r2PublicMediaUrl(getR2PublicBaseUrl() ?? "", storagePath) ?? `/api/category-media/${id}?v=${encodeURIComponent(imageId)}`
      : `/api/category-media/${id}?v=${encodeURIComponent(imageId)}`
    : null;

  return {
    id,
    slug: stringValue(row.slug),
    sortOrder: numberValue(row.sort_order, 100),
    translations: translationRows.map(mapTaxonomyTranslation),
    ...(imagePath && imageId && storagePath ? {
      image: {
        id: imageId,
        path: imagePath,
        storagePath,
        storageProvider,
        filename: stringValue(row.image_filename),
        contentType: stringValue(row.image_content_type),
        sizeBytes: numberValue(row.image_size_bytes, 0),
      },
    } : {}),
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

function mapAsset(row: DbRow, productStatus?: Product["status"]): ProductAsset {
  const kind = row.kind as ProductAsset["kind"];
  const rawPath = stringValue(row.path);
  const isUploadedStorageAsset = rawPath.startsWith("products/");
  const storageProvider = storageProviderValue(row.storage_provider);
  const r2PublicUrl = storageProvider === "r2_public" && Boolean(row.is_public) && productStatus === "published"
    ? r2PublicMediaUrl(getR2PublicBaseUrl() ?? "", rawPath)
    : null;

  return {
    id: stringValue(row.id),
    productId: stringValue(row.product_id),
    kind,
    bucket: stringValue(row.bucket),
    path: r2PublicUrl ?? (Boolean(row.is_public) && isUploadedStorageAsset
      ? `/api/media/${stringValue(row.id)}`
      : Boolean(row.is_public) && !rawPath.startsWith("/")
        ? `/${rawPath}`
        : rawPath),
    storagePath: isUploadedStorageAsset ? rawPath : undefined,
    storageProvider,
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

function storageProviderValue(value: unknown): ProductAsset["storageProvider"] {
  return value === "r2_private" || value === "r2_public_pending" || value === "r2_public_revoking" || value === "r2_public"
    ? value
    : "supabase";
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
  const redeemedAt = stringValue(row.redeemed_at);
  const redeemedBy = stringValue(row.redeemed_by);
  return {
    id: stringValue(row.id),
    productId: stringValue(row.product_id),
    code: stringValue(row.code),
    active: Boolean(row.active),
    ...(redeemedAt ? { redeemedAt } : {}),
    ...(redeemedBy ? { redeemedBy } : {}),
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
