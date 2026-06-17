import { randomUUID } from "node:crypto";

import { routing, type Locale } from "@/i18n/routing";

import {
  getContentSnapshot,
  saveContentSnapshot,
} from "./content-store";
import type {
  AmazonLink,
  Category,
  ContentSnapshot,
  Product,
  ProductAsset,
  ProductTranslation,
  StaticPageRecord,
  Tag,
  TaxonomyTranslation,
} from "./types";
import { slugify } from "./utils";

const locales = routing.locales;

export type AdminMutationResult =
  | { ok: true; id: string }
  | { ok: false; errors: string[] };

export function buildProductFromFormData(
  formData: FormData,
  options: {
    existing?: Product;
    snapshot?: ContentSnapshot;
    now?: Date;
  } = {},
) {
  const snapshot = options.snapshot ?? getContentSnapshot();
  const existing = options.existing;
  const now = (options.now ?? new Date()).toISOString();
  const id = textField(formData, "id") || existing?.id || randomUUID();
  const translations = parseProductTranslations(formData, existing);
  const englishTitle =
    translations.find((translation) => translation.locale === "en")?.title ??
    existing?.translations.find((translation) => translation.locale === "en")?.title ??
    "untitled product";
  const slug = uniqueSlug(
    textField(formData, "slug") || slugify(englishTitle),
    snapshot.products,
    id,
  );
  const assets = parseAssets(formData, id, existing?.assets ?? []);
  const coverAssetId =
    textField(formData, "coverAssetId") ||
    assets.find((asset) => asset.kind === "cover")?.id ||
    existing?.coverAssetId ||
    "";
  const videoAssetId =
    textField(formData, "videoAssetId") ||
    assets.find((asset) => asset.kind === "video")?.id ||
    existing?.videoAssetId;

  const product: Product = {
    id,
    slug,
    status: productStatusField(formData, "status", existing?.status ?? "draft"),
    audience: audienceField(formData, "audience", existing?.audience ?? "kids"),
    productType:
      textField(formData, "productType") || existing?.productType || "coloring-book",
    coverAssetId,
    videoAssetId: videoAssetId || undefined,
    reviewDelayDays: positiveIntField(
      formData,
      "reviewDelayDays",
      existing?.reviewDelayDays ?? 14,
    ),
    sortOrder: intField(formData, "sortOrder", existing?.sortOrder ?? 100),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    translations,
    categoryIds: existingIds(formData, "categoryIds").filter((id) =>
      snapshot.categories.some((category) => category.id === id),
    ),
    tagIds: existingIds(formData, "tagIds").filter((id) =>
      snapshot.tags.some((tag) => tag.id === id),
    ),
    assets,
    amazonLinks: normalizePrimaryAmazonLink(parseAmazonLinks(formData, id, existing)),
    premiumCodes: parsePremiumCodes(formData, id, existing),
  };

  return {
    product,
    errors: validateProductDraft(product),
  };
}

export function saveProductFromFormData(formData: FormData): AdminMutationResult {
  const snapshot = getContentSnapshot();
  const existing = snapshot.products.find(
    (product) => product.id === textField(formData, "id"),
  );
  const { product, errors } = buildProductFromFormData(formData, {
    existing,
    snapshot,
  });

  if (errors.length) {
    return { ok: false, errors };
  }

  saveContentSnapshot({
    ...snapshot,
    products: upsertById(snapshot.products, product),
  });

  return { ok: true, id: product.id };
}

export function deleteProduct(productId: string): AdminMutationResult {
  const snapshot = getContentSnapshot();
  const product = snapshot.products.find((item) => item.id === productId);

  if (!product) {
    return { ok: false, errors: ["Product not found."] };
  }

  saveContentSnapshot({
    ...snapshot,
    products: snapshot.products.filter((item) => item.id !== productId),
  });

  return { ok: true, id: productId };
}

export function archiveProduct(productId: string): AdminMutationResult {
  const snapshot = getContentSnapshot();
  const product = snapshot.products.find((item) => item.id === productId);

  if (!product) {
    return { ok: false, errors: ["Product not found."] };
  }

  saveContentSnapshot({
    ...snapshot,
    products: upsertById(snapshot.products, {
      ...product,
      status: "archived",
      updatedAt: new Date().toISOString(),
    }),
  });

  return { ok: true, id: productId };
}

export function saveCategoryFromFormData(formData: FormData): AdminMutationResult {
  const snapshot = getContentSnapshot();
  const existing = snapshot.categories.find(
    (category) => category.id === textField(formData, "id"),
  );
  const category = buildCategoryFromFormData(formData, snapshot, existing);
  const errors = validateTaxonomy(category, snapshot.categories, category.id);

  if (errors.length) {
    return { ok: false, errors };
  }

  saveContentSnapshot({
    ...snapshot,
    categories: upsertById(snapshot.categories, category).sort(
      (a, b) => a.sortOrder - b.sortOrder,
    ),
  });

  return { ok: true, id: category.id };
}

export function deleteCategory(categoryId: string): AdminMutationResult {
  const snapshot = getContentSnapshot();

  saveContentSnapshot({
    ...snapshot,
    categories: snapshot.categories.filter((category) => category.id !== categoryId),
    products: snapshot.products.map((product) => ({
      ...product,
      categoryIds: product.categoryIds.filter((id) => id !== categoryId),
    })),
  });

  return { ok: true, id: categoryId };
}

export function saveTagFromFormData(formData: FormData): AdminMutationResult {
  const snapshot = getContentSnapshot();
  const existing = snapshot.tags.find((tag) => tag.id === textField(formData, "id"));
  const tag = buildTagFromFormData(formData, snapshot, existing);
  const errors = validateTaxonomy(tag, snapshot.tags, tag.id);

  if (errors.length) {
    return { ok: false, errors };
  }

  saveContentSnapshot({
    ...snapshot,
    tags: upsertById(snapshot.tags, tag),
  });

  return { ok: true, id: tag.id };
}

export function deleteTag(tagId: string): AdminMutationResult {
  const snapshot = getContentSnapshot();

  saveContentSnapshot({
    ...snapshot,
    tags: snapshot.tags.filter((tag) => tag.id !== tagId),
    products: snapshot.products.map((product) => ({
      ...product,
      tagIds: product.tagIds.filter((id) => id !== tagId),
    })),
  });

  return { ok: true, id: tagId };
}

export function saveStaticPageFromFormData(formData: FormData): AdminMutationResult {
  const snapshot = getContentSnapshot();
  const slug = staticPageSlugField(formData, "slug");
  const locale = localeField(formData, "locale", "en");
  const existing = snapshot.staticPages.find(
    (page) => page.slug === slug && page.locale === locale,
  );
  const page: StaticPageRecord = {
    id: existing?.id ?? `static-${slug}-${locale}`,
    slug,
    locale,
    title: textField(formData, "title") || existing?.title || slug,
    body: textField(formData, "body") || existing?.body || "",
    updatedAt: new Date().toISOString(),
  };

  saveContentSnapshot({
    ...snapshot,
    staticPages: upsertByComposite(
      snapshot.staticPages,
      page,
      (item) => `${item.slug}:${item.locale}`,
    ),
  });

  return { ok: true, id: page.id };
}

export function validateProductForPublish(
  product: Pick<Product, "translations" | "amazonLinks" | "assets" | "coverAssetId">,
) {
  const english = product.translations.find((translation) => translation.locale === "en");
  const cover = product.assets.find((asset) => asset.id === product.coverAssetId);
  const missing = [
    english?.title ? null : "English title",
    english?.shortDescription ? null : "English short description",
    product.amazonLinks.length > 0 ? null : "Amazon link",
    cover ? null : "Cover asset",
  ].filter((item): item is string => Boolean(item));

  return {
    ok: missing.length === 0,
    missing,
  };
}

export function validateAssetClassification(asset: Pick<ProductAsset, "kind" | "isPublic">) {
  if (asset.kind === "premium_download" && asset.isPublic) {
    return {
      ok: false as const,
      reason: "Premium downloads must be private.",
    };
  }

  if (asset.kind !== "premium_download" && !asset.isPublic) {
    return {
      ok: false as const,
      reason: "Guest-visible media must be public.",
    };
  }

  return { ok: true as const };
}

function buildCategoryFromFormData(
  formData: FormData,
  snapshot: ContentSnapshot,
  existing?: Category,
): Category {
  const id = textField(formData, "id") || existing?.id || randomUUID();
  const enName = textField(formData, "name_en") || existing?.translations[0]?.name || "Category";

  return {
    id,
    slug: uniqueSlug(
      textField(formData, "slug") || slugify(enName),
      snapshot.categories,
      id,
    ),
    sortOrder: intField(formData, "sortOrder", existing?.sortOrder ?? 100),
    translations: parseTaxonomyTranslations(formData, existing?.translations),
  };
}

function buildTagFromFormData(
  formData: FormData,
  snapshot: ContentSnapshot,
  existing?: Tag,
): Tag {
  const id = textField(formData, "id") || existing?.id || randomUUID();
  const enName = textField(formData, "name_en") || existing?.translations[0]?.name || "Tag";

  return {
    id,
    slug: uniqueSlug(textField(formData, "slug") || slugify(enName), snapshot.tags, id),
    translations: parseTaxonomyTranslations(formData, existing?.translations),
  };
}

function parseProductTranslations(
  formData: FormData,
  existing?: Product,
): ProductTranslation[] {
  const existingByLocale = new Map(
    existing?.translations.map((translation) => [translation.locale, translation]),
  );

  return locales
    .map((locale): ProductTranslation | null => {
      const previous = existingByLocale.get(locale);
      const title = textField(formData, `title_${locale}`) || previous?.title || "";
      const shortDescription =
        textField(formData, `shortDescription_${locale}`) ||
        previous?.shortDescription ||
        "";
      const longDescription =
        textField(formData, `longDescription_${locale}`) ||
        previous?.longDescription ||
        "";
      const seoTitle = textField(formData, `seoTitle_${locale}`) || previous?.seoTitle;
      const seoDescription =
        textField(formData, `seoDescription_${locale}`) || previous?.seoDescription;

      if (
        !title &&
        !shortDescription &&
        !longDescription &&
        !seoTitle &&
        !seoDescription
      ) {
        return null;
      }

      return {
        locale,
        title,
        shortDescription,
        longDescription,
        seoTitle,
        seoDescription,
      };
    })
    .filter((translation): translation is ProductTranslation => Boolean(translation));
}

function parseTaxonomyTranslations(
  formData: FormData,
  existing: TaxonomyTranslation[] = [],
): TaxonomyTranslation[] {
  const existingByLocale = new Map(
    existing.map((translation) => [translation.locale, translation]),
  );

  return locales
    .map((locale): TaxonomyTranslation | null => {
      const previous = existingByLocale.get(locale);
      const name = textField(formData, `name_${locale}`) || previous?.name || "";
      const description =
        textField(formData, `description_${locale}`) || previous?.description;

      if (!name && !description) {
        return null;
      }

      return { locale, name, description };
    })
    .filter((translation): translation is TaxonomyTranslation => Boolean(translation));
}

function parseAssets(
  formData: FormData,
  productId: string,
  existingAssets: ProductAsset[],
): ProductAsset[] {
  const removed = new Set(existingIds(formData, "assetRemove"));
  const ids = formData.getAll("assetId");
  const kinds = formData.getAll("assetKind");
  const buckets = formData.getAll("assetBucket");
  const paths = formData.getAll("assetPath");
  const filenames = formData.getAll("assetFilename");
  const contentTypes = formData.getAll("assetContentType");
  const localesFromForm = formData.getAll("assetLocale");
  const titles = formData.getAll("assetTitle");
  const sortOrders = formData.getAll("assetSortOrder");
  const existingById = new Map(existingAssets.map((asset) => [asset.id, asset]));
  const rowCount = Math.max(ids.length, kinds.length, paths.length);
  const assets: ProductAsset[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    const existingId = valueAt(ids, index);
    const existing = existingId ? existingById.get(existingId) : undefined;

    if (existingId && removed.has(existingId)) {
      continue;
    }

    const kind = assetKindValue(valueAt(kinds, index) || existing?.kind || "gallery");
    const path = valueAt(paths, index) || existing?.path || "";

    if (!path) {
      continue;
    }

    const isPublic = kind !== "premium_download";
    const filename =
      valueAt(filenames, index) || existing?.filename || filenameFromPath(path);

    assets.push({
      id: existingId || randomUUID(),
      productId,
      kind,
      bucket:
        valueAt(buckets, index) ||
        existing?.bucket ||
        defaultBucketForKind(kind),
      path,
      filename,
      contentType:
        valueAt(contentTypes, index) ||
        existing?.contentType ||
        inferContentType(filename),
      sizeBytes: existing?.sizeBytes,
      locale:
        localeFieldValue(valueAt(localesFromForm, index)) ?? existing?.locale,
      title: valueAt(titles, index) || existing?.title || filename,
      sortOrder: numberFromValue(valueAt(sortOrders, index), existing?.sortOrder ?? 100),
      isPublic,
      demoDownloadPath: existing?.demoDownloadPath,
    });
  }

  return assets.sort((a, b) => a.sortOrder - b.sortOrder);
}

function parseAmazonLinks(
  formData: FormData,
  productId: string,
  existing?: Product,
): AmazonLink[] {
  const removed = new Set(existingIds(formData, "amazonRemove"));
  const ids = formData.getAll("amazonId");
  const markets = formData.getAll("amazonMarket");
  const urls = formData.getAll("amazonUrl");
  const primaryIds = new Set(existingIds(formData, "amazonPrimary"));
  const existingById = new Map(existing?.amazonLinks.map((link) => [link.id, link]));
  const rowCount = Math.max(ids.length, markets.length, urls.length);
  const links: AmazonLink[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    const existingId = valueAt(ids, index);
    const existingLink = existingId ? existingById.get(existingId) : undefined;

    if (existingId && removed.has(existingId)) {
      continue;
    }

    const url = valueAt(urls, index) || existingLink?.url || "";

    if (!url) {
      continue;
    }

    const id = existingId || randomUUID();

    links.push({
      id,
      productId,
      market:
        amazonMarketValue(valueAt(markets, index) || existingLink?.market) ??
        "amazon.com",
      url,
      isPrimary: primaryIds.has(id) || (!existingId && primaryIds.has(`new-${index}`)),
    });
  }

  return links;
}

function parsePremiumCodes(
  formData: FormData,
  productId: string,
  existing?: Product,
) {
  const removed = new Set(existingIds(formData, "premiumCodeRemove"));
  const ids = formData.getAll("premiumCodeId");
  const codes = formData.getAll("premiumCode");
  const activeIds = new Set(existingIds(formData, "premiumCodeActive"));
  const existingById = new Map(existing?.premiumCodes.map((code) => [code.id, code]));
  const rowCount = Math.max(ids.length, codes.length);

  return Array.from({ length: rowCount }, (_, index) => {
    const existingId = valueAt(ids, index);
    const existingCode = existingId ? existingById.get(existingId) : undefined;

    if (existingId && removed.has(existingId)) {
      return null;
    }

    const code = (valueAt(codes, index) || existingCode?.code || "")
      .trim()
      .toUpperCase();

    if (!code) {
      return null;
    }

    const id = existingId || randomUUID();

    return {
      id,
      productId,
      code,
      active: activeIds.has(id) || (!existingId && activeIds.has(`new-${index}`)),
    };
  }).filter((code): code is Product["premiumCodes"][number] => Boolean(code));
}

function normalizePrimaryAmazonLink(links: AmazonLink[]) {
  const primaryIndex = links.findIndex((link) => link.isPrimary);

  if (!links.length) {
    return links;
  }

  return links.map((link, index) => ({
    ...link,
    isPrimary: primaryIndex === -1 ? index === 0 : index === primaryIndex,
  }));
}

function validateProductDraft(product: Product) {
  const errors: string[] = [];
  const english = product.translations.find((translation) => translation.locale === "en");

  if (!product.slug) {
    errors.push("Slug is required.");
  }

  if (!english?.title) {
    errors.push("English title is required.");
  }

  if (product.status === "published") {
    errors.push(...validateProductForPublish(product).missing);
  }

  product.assets.forEach((asset) => {
    const classification = validateAssetClassification(asset);

    if (!classification.ok) {
      errors.push(`${asset.filename}: ${classification.reason}`);
    }
  });

  return Array.from(new Set(errors));
}

function validateTaxonomy<T extends { id: string; slug: string; translations: TaxonomyTranslation[] }>(
  item: T,
  collection: T[],
  currentId: string,
) {
  const errors: string[] = [];

  if (!item.slug) {
    errors.push("Slug is required.");
  }

  if (!item.translations.some((translation) => translation.locale === "en" && translation.name)) {
    errors.push("English name is required.");
  }

  if (
    collection.some(
      (existing) => existing.slug === item.slug && existing.id !== currentId,
    )
  ) {
    errors.push("Slug must be unique.");
  }

  return errors;
}

function textField(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function existingIds(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
}

function intField(formData: FormData, key: string, fallback: number) {
  return numberFromValue(textField(formData, key), fallback);
}

function positiveIntField(formData: FormData, key: string, fallback: number) {
  return Math.max(1, intField(formData, key, fallback));
}

function numberFromValue(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function valueAt(values: FormDataEntryValue[], index: number) {
  const value = values[index];

  return typeof value === "string" ? value.trim() : "";
}

function productStatusField(
  formData: FormData,
  key: string,
  fallback: Product["status"],
): Product["status"] {
  const value = textField(formData, key);

  return value === "published" || value === "archived" || value === "draft"
    ? value
    : fallback;
}

function audienceField(
  formData: FormData,
  key: string,
  fallback: Product["audience"],
): Product["audience"] {
  const value = textField(formData, key);

  return value === "kids" || value === "adults" ? value : fallback;
}

function assetKindValue(value: string): ProductAsset["kind"] {
  return value === "cover" ||
    value === "gallery" ||
    value === "video" ||
    value === "public_download" ||
    value === "premium_download"
    ? value
    : "gallery";
}

function amazonMarketValue(value: string | undefined): AmazonLink["market"] | undefined {
  return value === "amazon.com" || value === "amazon.de" ? value : undefined;
}

function staticPageSlugField(formData: FormData, key: string): StaticPageRecord["slug"] {
  return textField(formData, key) === "terms" ? "terms" : "privacy";
}

function localeField(formData: FormData, key: string, fallback: Locale) {
  return localeFieldValue(textField(formData, key)) ?? fallback;
}

function localeFieldValue(value: string | undefined): Locale | undefined {
  return locales.find((locale) => locale === value);
}

function uniqueSlug<T extends { id: string; slug: string }>(
  input: string,
  collection: T[],
  currentId: string,
) {
  const base = slugify(input) || "item";
  let candidate = base;
  let suffix = 2;

  while (
    collection.some((item) => item.slug === candidate && item.id !== currentId)
  ) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function upsertById<T extends { id: string }>(collection: T[], item: T) {
  const exists = collection.some((current) => current.id === item.id);

  if (!exists) {
    return [...collection, item];
  }

  return collection.map((current) => (current.id === item.id ? item : current));
}

function upsertByComposite<T>(
  collection: T[],
  item: T,
  keySelector: (item: T) => string,
) {
  const key = keySelector(item);
  const exists = collection.some((current) => keySelector(current) === key);

  if (!exists) {
    return [...collection, item];
  }

  return collection.map((current) => (keySelector(current) === key ? item : current));
}

function defaultBucketForKind(kind: ProductAsset["kind"]) {
  if (kind === "premium_download") {
    return "premium-files";
  }

  if (kind === "video") {
    return "public-videos";
  }

  return "public-media";
}

function filenameFromPath(assetPath: string) {
  const normalized = assetPath.split("?")[0].split("#")[0];
  const filename = normalized.split("/").filter(Boolean).at(-1);

  return filename || "asset";
}

function inferContentType(filename: string) {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }

  if (lower.endsWith(".mp4")) {
    return "video/mp4";
  }

  if (lower.endsWith(".webm")) {
    return "video/webm";
  }

  if (lower.endsWith(".png")) {
    return "image/png";
  }

  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (lower.endsWith(".webp")) {
    return "image/webp";
  }

  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }

  return "application/octet-stream";
}
