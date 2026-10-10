import "server-only";

import { randomUUID } from "node:crypto";

import { getBackendMode } from "@/lib/config";
import { createClient, getCurrentAccessToken } from "@/lib/supabase/server";

import {
  archiveProduct,
  buildProductFromFormData,
  buildCategoryFromFormData,
  buildTagFromFormData,
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
import { getContentSnapshot, saveContentSnapshot } from "./content-store";
import { getAdminContentSnapshot } from "./content-repository";
import {
  cleanupNewMediaFromFormData,
  cleanupPersistedMedia,
  finalizeR2MediaUploads,
  reconcileR2Publication,
  revokeR2PublicAssetsBeforeMutation,
} from "./media-storage";
import { mediaBucketForKind } from "./media-upload";
import { createServiceRoleClient } from "./supabase/admin";
import {
  ADMIN_ERROR_CODES,
  AdminApplicationError,
  AdminDatabaseError,
  mapAdminError,
  type AdminMutationResult,
  type DatabaseErrorLike,
} from "./admin-errors";
import type { CatalogDesktopColumns, Product } from "./types";

export async function saveProductForRequest(formData: FormData): Promise<AdminMutationResult> {
  let storageAuthorizationToken: string | null | undefined;
  let savedProduct: Product | undefined;
  let previousAssets: Product["assets"] = [];
  let productSaveOutcomeUnknown = false;

  try {
    const backendMode = getBackendMode();
    storageAuthorizationToken = backendMode === "supabase"
      ? await getCurrentAccessToken()
      : undefined;
    const mediaErrors = validateProductMediaSubmission(formData);

    if (mediaErrors.length) {
      const mediaCleanupFailures = await cleanupNewMediaFromFormData(formData, storageAuthorizationToken);
      return { ok: false, errors: mediaErrors, ...(mediaCleanupFailures.length ? { mediaCleanupFailures } : {}) };
    }

    if (backendMode === "local") {
      const snapshot = getContentSnapshot();
      const existing = snapshot.products.find((product) => product.id === stringField(formData, "id"));
      const { product, errors } = buildProductFromFormData(formData, { existing, snapshot });
      const assetErrors = validateProductAssetSubmission(formData, product, existing);

      if (errors.length || assetErrors.length) {
        const mediaCleanupFailures = await cleanupNewMediaFromFormData(formData, storageAuthorizationToken);
        return { ok: false, errors: [...errors, ...assetErrors], ...(mediaCleanupFailures.length ? { mediaCleanupFailures } : {}) };
      }

      const result = saveProductFromFormData(formData);
      if (!result.ok) {
        const mediaCleanupFailures = await cleanupNewMediaFromFormData(formData, storageAuthorizationToken);
        if (mediaCleanupFailures.length) {
          return { ...result, mediaCleanupFailures };
        }
      } else {
        await cleanupPersistedMedia({
          previous: existing?.assets ?? [],
          next: product.assets,
        });
      }
      return result;
    }

    const snapshot = await getAdminContentSnapshot();
    const existing = snapshot.products.find((product) => product.id === stringField(formData, "id"));
    const { product: parsedProduct, errors } = buildProductFromFormData(formData, { existing, snapshot });
    let product = parsedProduct;
    previousAssets = existing?.assets ?? [];
    const assetErrors = validateProductAssetSubmission(formData, product, existing);

    if (errors.length || assetErrors.length) {
      const mediaCleanupFailures = await cleanupNewMediaFromFormData(formData, storageAuthorizationToken);
      return { ok: false, errors: [...errors, ...assetErrors], ...(mediaCleanupFailures.length ? { mediaCleanupFailures } : {}) };
    }

    assertUuidSet(product.id);
    if (product.coverAssetId) {
      assertUuidSet(product.coverAssetId);
    }
    if (product.videoAssetId) {
      assertUuidSet(product.videoAssetId);
    }
    product.assets.forEach((asset) => assertUuidSet(asset.id));
    product.amazonLinks.forEach((link) => assertUuidSet(link.id));
    product.premiumCodes.forEach((code) => assertUuidSet(code.id));

    const supabase = await createClient();
    const uploadedIds = new Set(
      formData.getAll("assetId").flatMap((value, index) =>
        typeof value === "string" && formData.getAll("assetUploaded")[index] === "1"
          ? [value.trim()]
          : [],
      ),
    );
    await assertSupabaseUploadsExist(
      product.assets.filter((asset) => product.status === "published" || !existing?.assets.some((previous) => previous.id === asset.id)),
      storageAuthorizationToken,
    );
    await finalizeR2MediaUploads(product.assets, uploadedIds);
    const revokedPublicAssetIds = await revokeR2PublicAssetsBeforeMutation({
      previousAssets,
      nextAssets: product.assets,
      status: product.status,
    });
    if (revokedPublicAssetIds.size) {
      product = {
        ...product,
        assets: product.assets.map((asset) => revokedPublicAssetIds.has(asset.id)
          ? { ...asset, storageProvider: "r2_private" as const }
          : asset),
      };
    }
    savedProduct = product;
    const usesStorageProviderMetadata =
      process.env.MEDIA_STORAGE_PROVIDER?.trim().toLowerCase() === "r2" ||
      product.assets.some((asset) => asset.storageProvider !== undefined && asset.storageProvider !== "supabase") ||
      previousAssets.some((asset) => asset.storageProvider !== undefined && asset.storageProvider !== "supabase");
    let saveResult: Awaited<ReturnType<typeof supabase.rpc>>;
    try {
      saveResult = await supabase.rpc(
        usesStorageProviderMetadata ? "save_product_with_storage_provider" : "save_product",
        { product_state: buildProductMutationPayload(product) },
      );
    } catch (error) {
      productSaveOutcomeUnknown = true;
      throw error;
    }

    const { data, error } = saveResult;

    if (error) {
      productSaveOutcomeUnknown = !isDefinitivePostgresFailure(error);
      throw new AdminDatabaseError("product mutation", error);
    }

    if (!data || typeof data !== "object" || data.status !== "success") {
      productSaveOutcomeUnknown = true;
      throw new AdminApplicationError(ADMIN_ERROR_CODES.INTERNAL);
    }
  } catch (error) {
    let mediaCleanupFailures: Awaited<ReturnType<typeof cleanupNewMediaFromFormData>> = [];
    if (productSaveOutcomeUnknown) {
      console.error("Product save outcome is unknown; uploaded media was retained for recovery.");
    } else {
      mediaCleanupFailures = await cleanupNewMediaFromFormData(formData, storageAuthorizationToken);
    }
    return {
      ok: false,
      errors: [mapAdminError(error, "product mutation")],
      ...(mediaCleanupFailures.length ? { mediaCleanupFailures } : {}),
    };
  }

  if (!savedProduct) {
    return { ok: false, errors: [ADMIN_ERROR_CODES.INTERNAL] };
  }

  await cleanupPersistedMedia({
    previous: previousAssets,
    next: savedProduct.assets,
  });
  await reconcileR2Publication({
    assets: savedProduct.assets,
    previousAssets,
    status: savedProduct.status,
  });

  return { ok: true, id: savedProduct.id };
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
      storageProvider: asset.storageProvider ?? "supabase",
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
  return runAdminMutation("product deletion", async () => {
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
    if (!previous) {
      return { ok: false, errors: [ADMIN_ERROR_CODES.NOT_FOUND_PRODUCT] };
    }

    const supabase = await createClient();
    await revokeR2PublicAssetsBeforeMutation({
      previousAssets: previous.assets,
      nextAssets: [],
      status: "archived",
    });
    const { data, error } = await supabase.rpc("delete_product", {
      requested_product_id: productId,
    });
    if (error) throw new AdminDatabaseError("product deletion", error);
    if (data !== true) {
      return { ok: false, errors: [ADMIN_ERROR_CODES.NOT_FOUND_PRODUCT] };
    }
    await cleanupPersistedMedia({
      previous: previous.assets,
      next: [],
    });
    return { ok: true, id: productId };
  });
}

export async function archiveProductForRequest(productId: string): Promise<AdminMutationResult> {
  return runAdminMutation("product archive", async () => {
    if (getBackendMode() === "local") {
      return archiveProduct(productId);
    }

    const snapshot = await getAdminContentSnapshot();
    const previous = snapshot.products.find((product) => product.id === productId);
    if (!previous) {
      return { ok: false, errors: [ADMIN_ERROR_CODES.NOT_FOUND_PRODUCT] };
    }

    const supabase = await createClient();
    await revokeR2PublicAssetsBeforeMutation({
      previousAssets: previous.assets,
      nextAssets: previous.assets,
      status: "archived",
    });
    const { data, error } = await supabase.rpc("archive_product", {
      requested_product_id: productId,
    });
    if (error) throw new AdminDatabaseError("product archive", error);
    if (data !== true) return { ok: false, errors: [ADMIN_ERROR_CODES.NOT_FOUND_PRODUCT] };
    return { ok: true, id: productId };
  });
}

export async function saveCategoryForRequest(formData: FormData): Promise<AdminMutationResult> {
  return runAdminMutation("category", async () => {
    if (getBackendMode() === "local") {
      return saveCategoryFromFormData(formData);
    }

    const snapshot = await getAdminContentSnapshot();
    const existing = snapshot.categories.find((category) => category.id === stringField(formData, "id"));
    const category = buildCategoryFromFormData(formData, snapshot, existing);
    const english = category.translations.find((translation) => translation.locale === "en");

    if (!english?.name) {
      return { ok: false, errors: [ADMIN_ERROR_CODES.VALIDATION_CATEGORY_NAME_REQUIRED] };
    }

    assertUuidSet(category.id);
    const supabase = await createClient();
    await run(supabase.from("categories").upsert({ id: category.id, slug: category.slug, sort_order: category.sortOrder }), "category");
    await run(supabase.from("category_translations").upsert({
      category_id: category.id,
      locale: "en",
      name: english.name,
      description: english.description ?? null,
    }, { onConflict: "category_id,locale" }), "category translation");
    return { ok: true, id: category.id };
  });
}

export async function deleteCategoryForRequest(categoryId: string): Promise<AdminMutationResult> {
  return runAdminMutation("category deletion", async () => {
    if (getBackendMode() === "local") {
      return deleteCategory(categoryId);
    }

    const snapshot = await getAdminContentSnapshot();
    if (!snapshot.categories.some((category) => category.id === categoryId)) {
      return { ok: false, errors: [ADMIN_ERROR_CODES.NOT_FOUND_RESOURCE] };
    }

    const supabase = await createClient();
    await run(supabase.from("categories").delete().eq("id", categoryId), "category deletion");
    return { ok: true, id: categoryId };
  });
}

export async function saveTagForRequest(formData: FormData): Promise<AdminMutationResult> {
  return runAdminMutation("tag", async () => {
    if (getBackendMode() === "local") {
      return saveTagFromFormData(formData);
    }

    const snapshot = await getAdminContentSnapshot();
    const existing = snapshot.tags.find((tag) => tag.id === stringField(formData, "id"));
    const tag = buildTagFromFormData(formData, snapshot, existing);
    const english = tag.translations.find((translation) => translation.locale === "en");

    if (!english?.name) {
      return { ok: false, errors: [ADMIN_ERROR_CODES.VALIDATION_TAG_NAME_REQUIRED] };
    }

    assertUuidSet(tag.id);
    const supabase = await createClient();
    await run(supabase.from("tags").upsert({ id: tag.id, slug: tag.slug }), "tag");
    await run(supabase.from("tag_translations").upsert({
      tag_id: tag.id,
      locale: "en",
      name: english.name,
      description: english.description ?? null,
    }, { onConflict: "tag_id,locale" }), "tag translation");
    return { ok: true, id: tag.id };
  });
}

export async function deleteTagForRequest(tagId: string): Promise<AdminMutationResult> {
  return runAdminMutation("tag deletion", async () => {
    if (getBackendMode() === "local") {
      return deleteTag(tagId);
    }

    const snapshot = await getAdminContentSnapshot();
    if (!snapshot.tags.some((tag) => tag.id === tagId)) {
      return { ok: false, errors: [ADMIN_ERROR_CODES.NOT_FOUND_RESOURCE] };
    }

    const supabase = await createClient();
    await run(supabase.from("tags").delete().eq("id", tagId), "tag deletion");
    return { ok: true, id: tagId };
  });
}

export async function savePagesForRequest(
  formData: FormData,
  slug: "privacy" | "terms",
): Promise<AdminMutationResult> {
  return runAdminMutation("static page", async () => {
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
        }, { onConflict: "slug,locale" }),
        "static page",
      );
    }

    return { ok: true, id: slug };
  });
}

export async function saveCatalogSettingsForRequest(
  desktopColumns: CatalogDesktopColumns,
): Promise<AdminMutationResult> {
  return runAdminMutation("catalog settings", async () => {
    if (getBackendMode() === "local") {
      const snapshot = getContentSnapshot();
      saveContentSnapshot({
        ...snapshot,
        catalogSettings: { desktopColumns },
      });

      return { ok: true, id: "global" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("catalog_settings")
      .update({ desktop_columns: desktopColumns })
      .eq("id", "global")
      .select("id")
      .maybeSingle();

    if (error) {
      throw new AdminDatabaseError("catalog settings", error);
    }

    return data
      ? { ok: true, id: "global" }
      : { ok: false, errors: [ADMIN_ERROR_CODES.NOT_FOUND_RESOURCE] };
  });
}

export async function savePageForRequest(formData: FormData): Promise<AdminMutationResult> {
  return runAdminMutation("static page", async () => {
    if (getBackendMode() === "local") {
      return saveStaticPageFromFormData(formData);
    }

    const slug = stringField(formData, "slug");
    if (slug !== "privacy" && slug !== "terms") {
      return { ok: false, errors: [ADMIN_ERROR_CODES.VALIDATION_PAGE_SLUG] };
    }

    return savePagesForRequest(formData, slug);
  });
}

async function run(query: PromiseLike<{ error: DatabaseErrorLike | null }>, label: string) {
  const { error } = await query;

  if (error) {
    throw new AdminDatabaseError(label, error);
  }
}

export async function assertSupabaseUploadsExist(
  assets: Product["assets"],
  storageAuthorizationToken?: string | null,
) {
  if (!assets.length) return;

  const storage = createServiceRoleClient({
    storageAuthorizationToken: storageAuthorizationToken ?? undefined,
  }).storage;

  for (const asset of assets) {
    const storagePath = asset.storagePath ?? asset.path;
    if (!storagePath.startsWith("products/")) continue;

    const expectedPrefix = `products/${asset.productId}/${asset.kind}/`;
    if (!storagePath.startsWith(expectedPrefix)) {
      throw new AdminApplicationError(ADMIN_ERROR_CODES.VALIDATION_ASSET_PATH);
    }

    const { data, error } = await storage
      .from(mediaBucketForKind(asset.kind))
      .exists(storagePath);

    if (error) {
      throw new AdminDatabaseError("asset upload lookup", error);
    }

    if (data !== true) {
      throw new AdminApplicationError(ADMIN_ERROR_CODES.NOT_FOUND_ASSET_UPLOAD);
    }
  }
}

function isDefinitivePostgresFailure(error: DatabaseErrorLike) {
  if (typeof error.code !== "string" || !/^[0-9A-Z]{5}$/.test(error.code)) {
    return false;
  }

  // Connection exceptions and SQLSTATE 40003 can leave a committed write's
  // outcome unknown. Keep uploaded media until a later reconciliation proves
  // whether the product row references it.
  return !error.code.startsWith("08") && error.code !== "40003";
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

function assertUuidSet(value: string) {
  if (!isUuid(value)) {
    throw new AdminApplicationError(ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT);
  }
}

async function runAdminMutation(
  operation: string,
  mutation: () => Promise<AdminMutationResult>,
): Promise<AdminMutationResult> {
  try {
    return await mutation();
  } catch (error) {
    return { ok: false, errors: [mapAdminError(error, operation)] };
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
