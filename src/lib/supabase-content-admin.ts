import "server-only";

import { randomUUID } from "node:crypto";

import { getBackendMode } from "@/lib/config";
import { createClient, getCurrentAccessToken } from "@/lib/supabase/server";

import {
  archiveProduct,
  buildProductFromFormData,
  buildStaticPagesFromFormData,
  deleteCategory,
  deleteProduct,
  deleteTag,
  saveCategoryFromFormData,
  saveProductFromFormData,
  validateProductAssetSubmission,
  validateProductMediaSubmission,
  saveStaticPageFromFormData,
  saveStaticPagesFromFormData,
  saveTagFromFormData,
} from "./admin-content";
import { getContentSnapshot } from "./content-store";
import { getAdminContentSnapshot } from "./content-repository";
import { cleanupNewMediaFromFormData, cleanupPersistedMedia } from "./media-storage";
import { mediaBucketForKind } from "./media-upload";
import { createServiceRoleClient } from "./supabase/admin";
import type { AdminMutationResult } from "./admin-content";
import type { Product } from "./types";

export async function saveProductForRequest(formData: FormData): Promise<AdminMutationResult> {
  const storageAuthorizationToken = getBackendMode() === "supabase"
    ? await getCurrentAccessToken()
    : undefined;
  const mediaErrors = validateProductMediaSubmission(formData);

  if (mediaErrors.length) {
    await cleanupNewMediaFromFormData(formData, storageAuthorizationToken);
    return { ok: false, errors: mediaErrors };
  }

  if (getBackendMode() === "local") {
    const snapshot = getContentSnapshot();
    const existing = snapshot.products.find((product) => product.id === stringField(formData, "id"));
    const { product, errors } = buildProductFromFormData(formData, { existing, snapshot });
    const assetErrors = validateProductAssetSubmission(formData, product, existing);

    if (errors.length || assetErrors.length) {
      await cleanupNewMediaFromFormData(formData, storageAuthorizationToken);
      return { ok: false, errors: [...errors, ...assetErrors] };
    }

    const result = saveProductFromFormData(formData);
    if (!result.ok) {
      await cleanupNewMediaFromFormData(formData, storageAuthorizationToken);
    } else {
      await cleanupPersistedMedia({
        previous: existing?.assets ?? [],
        next: product.assets,
        authorizationToken: storageAuthorizationToken,
      });
    }
    return result;
  }

  const snapshot = await getAdminContentSnapshot();
  const existing = snapshot.products.find((product) => product.id === stringField(formData, "id"));
  const { product, errors } = buildProductFromFormData(formData, { existing, snapshot });

  const assetErrors = validateProductAssetSubmission(formData, product, existing);

  if (errors.length || assetErrors.length) {
    await cleanupNewMediaFromFormData(formData, storageAuthorizationToken);
    return { ok: false, errors: [...errors, ...assetErrors] };
  }

  assertUuidSet(product.id, "product");
  if (product.coverAssetId) {
    assertUuidSet(product.coverAssetId, "cover asset");
  }
  if (product.videoAssetId) {
    assertUuidSet(product.videoAssetId, "video asset");
  }
  product.assets.forEach((asset) => assertUuidSet(asset.id, "asset"));
  product.amazonLinks.forEach((link) => assertUuidSet(link.id, "Amazon link"));
  product.premiumCodes.forEach((code) => assertUuidSet(code.id, "premium code"));

  const supabase = await createClient();
  try {
    await assertSupabaseUploadsExist(
      product.assets.filter((asset) => !existing?.assets.some((previous) => previous.id === asset.id)),
      storageAuthorizationToken,
    );
    const { data, error } = await supabase.rpc("save_product", {
      product_state: buildProductMutationPayload(product),
    });

    if (error) {
      throw new Error(`Supabase product mutation failed: ${error.message}`);
    }

    if (!data || typeof data !== "object" || data.status !== "success") {
      throw new Error("Supabase product mutation returned an unknown result.");
    }
  } catch (error) {
    await cleanupNewMediaFromFormData(formData, storageAuthorizationToken);
    throw error;
  }

  await cleanupPersistedMedia({
    previous: existing?.assets ?? [],
    next: product.assets,
    authorizationToken: storageAuthorizationToken,
  });

  return { ok: true, id: product.id };
}

export function buildProductMutationPayload(product: Product) {
  return {
    id: product.id,
    slug: product.slug,
    status: product.status,
    audience: product.audience,
    productType: product.productType,
    coverAssetId: product.coverAssetId || null,
    videoAssetId: product.videoAssetId || null,
    reviewDelayDays: product.reviewDelayDays,
    sortOrder: product.sortOrder,
    updatedAt: product.updatedAt,
    translations: product.translations.map((translation) => ({
      locale: translation.locale,
      title: translation.title,
      shortDescription: translation.shortDescription,
      longDescription: translation.longDescription,
      seoTitle: translation.seoTitle ?? null,
      seoDescription: translation.seoDescription ?? null,
    })),
    categoryIds: product.categoryIds,
    tagIds: product.tagIds,
    assets: product.assets.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      bucket: mediaBucketForKind(asset.kind),
      path: asset.storagePath ?? asset.path,
      filename: asset.filename,
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes ?? null,
      locale: asset.locale ?? null,
      title: asset.title ?? null,
      sortOrder: asset.sortOrder,
    })),
    amazonLinks: product.amazonLinks.map((link) => ({
      id: link.id,
      market: link.market,
      url: link.url,
      isPrimary: link.isPrimary,
    })),
    premiumCodes: product.premiumCodes.map((code) => ({
      id: code.id,
      code: code.code,
      active: code.active,
    })),
  };
}

export async function deleteProductForRequest(productId: string): Promise<AdminMutationResult> {
  if (getBackendMode() === "local") {
    const previous = getContentSnapshot().products.find((product) => product.id === productId);
    const result = deleteProduct(productId);
    if (result.ok) {
      await cleanupPersistedMedia({ previous: previous?.assets ?? [], next: [] });
    }
    return result;
  }

  const snapshot = await getAdminContentSnapshot();
  const previous = snapshot.products.find((product) => product.id === productId);
  const supabase = await createClient();
  const storageAuthorizationToken = await getCurrentAccessToken();
  await run(supabase.from("products").delete().eq("id", productId), "product deletion");
  await cleanupPersistedMedia({
    previous: previous?.assets ?? [],
    next: [],
    authorizationToken: storageAuthorizationToken,
  });
  return { ok: true, id: productId };
}

export async function archiveProductForRequest(productId: string): Promise<AdminMutationResult> {
  if (getBackendMode() === "local") {
    return archiveProduct(productId);
  }

  const supabase = await createClient();
  await run(
    supabase.from("products").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", productId),
    "product archive",
  );
  return { ok: true, id: productId };
}

export async function saveCategoryForRequest(formData: FormData): Promise<AdminMutationResult> {
  if (getBackendMode() === "local") {
    return saveCategoryFromFormData(formData);
  }

  const snapshot = await getAdminContentSnapshot();
  const existing = snapshot.categories.find((category) => category.id === stringField(formData, "id"));
  const categoryId = stringField(formData, "id") || existing?.id || randomUUID();
  assertUuidSet(categoryId, "category");
  const name = stringField(formData, "name_en") || existing?.translations[0]?.name || "Category";
  const slug = stringField(formData, "slug") || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const category = {
    id: categoryId,
    slug,
    sortOrder: numberField(formData, "sortOrder", existing?.sortOrder ?? 100),
    translations: ["en", "pl", "de", "es"].map((locale) => ({
      locale: locale as "en" | "pl" | "de" | "es",
      name: stringField(formData, `name_${locale}`) || existing?.translations.find((item) => item.locale === locale)?.name || "",
      description: stringField(formData, `description_${locale}`) || existing?.translations.find((item) => item.locale === locale)?.description,
    })).filter((translation) => translation.name || translation.description),
  };

  if (!category.translations.some((translation) => translation.locale === "en" && translation.name)) {
    return { ok: false, errors: ["English category name is required."] };
  }

  const supabase = await createClient();
  await run(supabase.from("categories").upsert({ id: category.id, slug: category.slug, sort_order: category.sortOrder }), "category");
  await run(supabase.from("category_translations").delete().eq("category_id", category.id), "category translations cleanup");
  await run(supabase.from("category_translations").insert(category.translations.map((translation) => ({
    category_id: category.id,
    locale: translation.locale,
    name: translation.name,
    description: translation.description ?? null,
  }))), "category translations");
  return { ok: true, id: category.id };
}

export async function deleteCategoryForRequest(categoryId: string): Promise<AdminMutationResult> {
  if (getBackendMode() === "local") {
    return deleteCategory(categoryId);
  }

  const supabase = await createClient();
  await run(supabase.from("categories").delete().eq("id", categoryId), "category deletion");
  return { ok: true, id: categoryId };
}

export async function saveTagForRequest(formData: FormData): Promise<AdminMutationResult> {
  if (getBackendMode() === "local") {
    return saveTagFromFormData(formData);
  }

  const snapshot = await getAdminContentSnapshot();
  const existing = snapshot.tags.find((tag) => tag.id === stringField(formData, "id"));
  const tagId = stringField(formData, "id") || existing?.id || randomUUID();
  assertUuidSet(tagId, "tag");
  const name = stringField(formData, "name_en") || existing?.translations[0]?.name || "Tag";
  const slug = stringField(formData, "slug") || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const translations = ["en", "pl", "de", "es"].map((locale) => ({
    locale: locale as "en" | "pl" | "de" | "es",
    name: stringField(formData, `name_${locale}`) || existing?.translations.find((item) => item.locale === locale)?.name || "",
    description: stringField(formData, `description_${locale}`) || existing?.translations.find((item) => item.locale === locale)?.description,
  })).filter((translation) => translation.name);

  if (!translations.some((translation) => translation.locale === "en")) {
    return { ok: false, errors: ["English tag name is required."] };
  }

  const supabase = await createClient();
  await run(supabase.from("tags").upsert({ id: tagId, slug }), "tag");
  await run(supabase.from("tag_translations").delete().eq("tag_id", tagId), "tag translations cleanup");
  await run(supabase.from("tag_translations").insert(translations.map((translation) => ({
    tag_id: tagId,
    locale: translation.locale,
    name: translation.name,
    description: translation.description ?? null,
  }))), "tag translations");
  return { ok: true, id: tagId };
}

export async function deleteTagForRequest(tagId: string): Promise<AdminMutationResult> {
  if (getBackendMode() === "local") {
    return deleteTag(tagId);
  }

  const supabase = await createClient();
  await run(supabase.from("tags").delete().eq("id", tagId), "tag deletion");
  return { ok: true, id: tagId };
}

export async function savePagesForRequest(
  formData: FormData,
  slug: "privacy" | "terms",
): Promise<AdminMutationResult> {
  if (getBackendMode() === "local") {
    return saveStaticPagesFromFormData(formData, slug);
  }

  const snapshot = await getAdminContentSnapshot();
  const { pages } = buildStaticPagesFromFormData(formData, snapshot, slug);
  const supabase = await createClient();

  for (const page of pages) {
    const pageId = isUuid(page.id) ? page.id : randomUUID();

    await run(
      supabase.from("static_pages").upsert({
        id: pageId,
        slug: page.slug,
        locale: page.locale,
        title: page.title,
        body: page.body,
        updated_at: page.updatedAt,
      }),
      "static page",
    );
  }

  return { ok: true, id: slug };
}

export async function savePageForRequest(formData: FormData): Promise<AdminMutationResult> {
  if (getBackendMode() === "local") {
    return saveStaticPageFromFormData(formData);
  }

  const slug = stringField(formData, "slug");
  if (slug !== "privacy" && slug !== "terms") {
    return { ok: false, errors: ["Only privacy and terms pages can be edited."] };
  }

  return savePagesForRequest(formData, slug);
}

async function run(query: PromiseLike<{ error: { message: string } | null }>, label: string) {
  const { error } = await query;

  if (error) {
    throw new Error(`Supabase ${label} write failed: ${error.message}`);
  }
}

async function assertSupabaseUploadsExist(
  assets: Product["assets"],
  storageAuthorizationToken?: string | null,
) {
  if (!assets.length) return;

  const storage = createServiceRoleClient({
    storageAuthorizationToken: storageAuthorizationToken ?? undefined,
  }).storage;

  for (const asset of assets) {
    const storagePath = asset.storagePath ?? asset.path;
    const slash = storagePath.lastIndexOf("/");
    const folder = slash === -1 ? "" : storagePath.slice(0, slash);
    const filename = slash === -1 ? storagePath : storagePath.slice(slash + 1);
    const { data, error } = await storage
      .from(mediaBucketForKind(asset.kind))
      .list(folder, { limit: 100, search: filename });

    if (error || !data?.some((entry) => entry.name === filename)) {
      throw new Error(`Nie znaleziono przesłanego pliku „${asset.filename}” w Storage.`);
    }
  }
}

function stringField(formData: FormData, key: string) {
  const values = formData.getAll(key);

  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];

    if (typeof value === "string") {
      return value.trim();
    }
  }

  return "";
}

function numberField(formData: FormData, key: string, fallback: number) {
  const value = Number(stringField(formData, key));
  return Number.isFinite(value) ? value : fallback;
}

function assertUuidSet(value: string, label: string) {
  if (!isUuid(value)) {
    throw new Error(`Supabase ${label} identifier must be a UUID.`);
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
