import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentAccessToken: vi.fn(),
  getAdminContentSnapshot: vi.fn(),
  getBackendMode: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  upsertedRows: [] as Array<{ table: string; rows: unknown; options?: unknown }>,
  deletedTables: [] as string[],
  createServiceRoleClient: vi.fn(),
  storageFrom: vi.fn(),
  storageExists: vi.fn(),
  storageInfo: vi.fn(),
  storageDownload: vi.fn(),
  storageRemove: vi.fn(),
  finalizeR2MediaUploads: vi.fn(),
  storeCategoryImage: vi.fn(),
  removeCategoryImageStorage: vi.fn(),
  deleteCategory: vi.fn(),
  updateCategoryImageInSnapshot: vi.fn(),
  removeCollectionImage: vi.fn(),
  categoryImageUpdates: [] as Array<{ table: string; fields: unknown }>,
  categoryImageUpdateResult: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config", () => ({ getBackendMode: mocks.getBackendMode }));
vi.mock("@/lib/content-repository", () => ({
  getAdminContentSnapshot: mocks.getAdminContentSnapshot,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
  getCurrentAccessToken: mocks.getCurrentAccessToken,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
}));
vi.mock("./admin-content", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./admin-content")>();
  return {
    ...actual,
    deleteCategory: mocks.deleteCategory,
    updateCategoryImageInSnapshot: (...args: Parameters<typeof actual.updateCategoryImageInSnapshot>) => {
      const implementation = mocks.updateCategoryImageInSnapshot.getMockImplementation();
      return implementation ? implementation(...args) : actual.updateCategoryImageInSnapshot(...args);
    },
  };
});
vi.mock("./category-image-storage", () => ({
  storeCategoryImage: mocks.storeCategoryImage,
  removeCategoryImageStorage: mocks.removeCategoryImageStorage,
}));
vi.mock("./collection-image-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./collection-image-storage")>();
  return { ...actual, removeCollectionImage: mocks.removeCollectionImage };
});
vi.mock("./media-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./media-storage")>();
  return { ...actual, finalizeR2MediaUploads: mocks.finalizeR2MediaUploads };
});

import {
  archiveProductForRequest,
  assertSupabaseUploadsExist,
  deleteCategoryForRequest,
  deleteCollectionForRequest,
  removeCategoryImageForRequest,
  saveProductForRequest,
  saveCategoryForRequest,
  saveCategoryImageForRequest,
  saveCollectionForRequest,
  savePagesForRequest,
  saveTagForRequest,
} from "./supabase-content-admin";
import { getSeedContentSnapshot } from "./content-store";
import { RICH_TEXT_FORMAT_PREFIX, serializeRichTextDocument } from "./rich-text";

const productId = "11111111-1111-4111-8111-111111111111";
const assetId = "11111111-1111-4111-8111-111111111199";
let validSquareJpeg = new Uint8Array();

beforeAll(async () => {
  validSquareJpeg = new Uint8Array(await sharp({
    create: { width: 800, height: 800, channels: 3, background: { r: 50, g: 60, b: 70 } },
  }).jpeg().toBuffer());
});

function uploadedCoverForm(slug: string, title: string) {
  const form = new FormData();
  form.set("id", productId);
  form.set("slug", slug);
  form.set("status", "draft");
  form.set("audience", "kids");
  form.set("productType", "coloring-book");
  form.set("title", title);
  form.append("assetId", assetId);
  form.append("assetKind", "cover");
  form.append("assetPath", `products/${productId}/cover/${assetId}-cover.jpg`);
  form.append("assetFilename", "cover.jpg");
  form.append("assetContentType", "image/jpeg");
  form.append("assetSizeBytes", String(validSquareJpeg.byteLength));
  form.append("assetStorageProvider", "supabase");
  form.append("assetUploaded", "1");
  form.set("coverAssetId", assetId);
  return form;
}

describe("Supabase content admin mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateCategoryImageInSnapshot.mockReset();
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getCurrentAccessToken.mockResolvedValue(null);
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
      collections: [],
      categories: [],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });

    const resolvedQuery = () => Promise.resolve({ error: null });
    mocks.upsertedRows = [];
    mocks.deletedTables = [];
    mocks.categoryImageUpdates = [];
    mocks.categoryImageUpdateResult = { data: { id: "33333333-3333-4333-8333-333333333333" }, error: null };
    mocks.deleteCategory.mockReturnValue({ ok: true, id: "33333333-3333-4333-8333-333333333333" });
    mocks.from.mockImplementation((table: string) => ({
      upsert: vi.fn((rows, options) => {
        mocks.upsertedRows.push({ table, rows, options });
        return resolvedQuery();
      }),
      delete: vi.fn(() => {
        mocks.deletedTables.push(table);
        return { eq: vi.fn(() => resolvedQuery()) };
      }),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          neq: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) })),
        })),
      })),
      update: vi.fn((fields: unknown) => {
        mocks.categoryImageUpdates.push({ table, fields });
        return {
          eq: vi.fn(() => ({
            select: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(mocks.categoryImageUpdateResult) })),
          })),
        };
      }),
      insert: vi.fn(() => resolvedQuery()),
    }));
    mocks.createClient.mockResolvedValue({ from: mocks.from, rpc: mocks.rpc });
    mocks.storageExists.mockResolvedValue({ data: true, error: null });
    mocks.storageInfo.mockResolvedValue({
      data: { size: validSquareJpeg.byteLength, contentType: "image/jpeg" },
      error: null,
    });
    mocks.storageRemove.mockResolvedValue({ error: null });
    mocks.storageFrom.mockReturnValue({
      exists: mocks.storageExists,
      info: mocks.storageInfo,
      download: mocks.storageDownload,
      remove: mocks.storageRemove,
    });
    mocks.storageDownload.mockResolvedValue({
      data: new Blob([validSquareJpeg], { type: "image/jpeg" }),
      error: null,
    });
    mocks.createServiceRoleClient.mockReturnValue({
      storage: { from: mocks.storageFrom },
    });
    mocks.removeCategoryImageStorage.mockResolvedValue(true);
    mocks.removeCollectionImage.mockResolvedValue(undefined);
  });

  it("persists category image metadata and replaces the previous unique object", async () => {
    const categoryId = "33333333-3333-4333-8333-333333333333";
    const oldImage = {
      id: "44444444-4444-4444-8444-444444444444",
      path: `/api/category-media/${categoryId}?v=44444444-4444-4444-8444-444444444444`,
      storagePath: `categories/${categoryId}/image/44444444-4444-4444-8444-444444444444-old.webp`,
      storageProvider: "supabase" as const,
      filename: "old.webp",
      contentType: "image/webp",
      sizeBytes: 1000,
    };
    const image = {
      id: "55555555-5555-4555-8555-555555555555",
      path: `https://media.example.com/categories/${categoryId}/image/55555555-5555-4555-8555-555555555555-new.webp`,
      storagePath: `categories/${categoryId}/image/55555555-5555-4555-8555-555555555555-new.webp`,
      storageProvider: "r2_public" as const,
      filename: "new.webp",
      contentType: "image/webp",
      sizeBytes: 2000,
    };
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
      categories: [{ id: categoryId, slug: "books", sortOrder: 1, translations: [{ locale: "en", name: "Books" }], image: oldImage }],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });
    mocks.storeCategoryImage.mockResolvedValue(image);

    await expect(saveCategoryImageForRequest({
      categoryId,
      imageId: image.id,
      filename: image.filename,
      contentType: image.contentType,
      bytes: new Uint8Array([1, 2, 3]),
    })).resolves.toMatchObject({ ok: true, categoryImage: image, cleanupDeferred: false });

    expect(mocks.categoryImageUpdates).toEqual([{
      table: "categories",
      fields: {
        image_asset_id: image.id,
        image_storage_path: image.storagePath,
        image_storage_provider: "r2_public",
        image_filename: image.filename,
        image_content_type: image.contentType,
        image_size_bytes: image.sizeBytes,
      },
    }]);
    expect(mocks.removeCategoryImageStorage).toHaveBeenCalledWith({ categoryId, image: oldImage, authorizationToken: null });
  });

  it("removes the newly uploaded category image when the category disappears before its metadata update", async () => {
    const categoryId = "33333333-3333-4333-8333-333333333333";
    const image = {
      id: "55555555-5555-4555-8555-555555555555",
      path: `/api/category-media/${categoryId}?v=55555555-5555-4555-8555-555555555555`,
      storagePath: `categories/${categoryId}/image/55555555-5555-4555-8555-555555555555-new.webp`,
      storageProvider: "supabase" as const,
      filename: "new.webp",
      contentType: "image/webp",
      sizeBytes: 2000,
    };
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
      categories: [{ id: categoryId, slug: "books", sortOrder: 1, translations: [{ locale: "en", name: "Books" }] }],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });
    mocks.storeCategoryImage.mockResolvedValue(image);
    mocks.categoryImageUpdateResult = { data: null, error: null };

    await expect(saveCategoryImageForRequest({
      categoryId,
      imageId: image.id,
      filename: image.filename,
      contentType: image.contentType,
      bytes: new Uint8Array([1, 2, 3]),
    })).resolves.toEqual({ ok: false, errors: ["admin.not_found.resource"] });

    expect(mocks.removeCategoryImageStorage).toHaveBeenCalledTimes(1);
    expect(mocks.removeCategoryImageStorage).toHaveBeenCalledWith({
      categoryId,
      image,
      authorizationToken: null,
    });
  });

  it("reports deferred cleanup when a disappeared category leaves the new image behind", async () => {
    const categoryId = "33333333-3333-4333-8333-333333333333";
    const image = {
      id: "55555555-5555-4555-8555-555555555555",
      path: "/api/category-media/" + categoryId + "?v=55555555-5555-4555-8555-555555555555",
      storagePath: "categories/" + categoryId + "/image/55555555-5555-4555-8555-555555555555-new.webp",
      storageProvider: "supabase" as const,
      filename: "new.webp",
      contentType: "image/webp",
      sizeBytes: 2000,
    };
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
      categories: [{ id: categoryId, slug: "books", sortOrder: 1, translations: [{ locale: "en", name: "Books" }] }],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });
    mocks.storeCategoryImage.mockResolvedValue(image);
    mocks.categoryImageUpdateResult = { data: null, error: null };
    mocks.removeCategoryImageStorage.mockResolvedValue(false);

    await expect(saveCategoryImageForRequest({
      categoryId,
      imageId: image.id,
      filename: image.filename,
      contentType: image.contentType,
      bytes: new Uint8Array([1, 2, 3]),
    })).resolves.toEqual({
      ok: false,
      errors: ["admin.not_found.resource"],
      cleanupDeferred: true,
      id: categoryId,
      cleanupImageId: image.id,
    });

    expect(mocks.removeCategoryImageStorage).toHaveBeenCalledTimes(1);
  });

  it("reports deferred cleanup when a local category disappears and its new image cannot be removed", async () => {
    const categoryId = "33333333-3333-4333-8333-333333333333";
    const image = {
      id: "55555555-5555-4555-8555-555555555555",
      path: "/api/category-media/" + categoryId + "?v=55555555-5555-4555-8555-555555555555",
      storagePath: "categories/" + categoryId + "/image/55555555-5555-4555-8555-555555555555-new.webp",
      storageProvider: "supabase" as const,
      filename: "new.webp",
      contentType: "image/webp",
      sizeBytes: 2000,
    };
    mocks.getBackendMode.mockReturnValue("local");
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
      categories: [{ id: categoryId, slug: "books", sortOrder: 1, translations: [{ locale: "en", name: "Books" }] }],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });
    mocks.updateCategoryImageInSnapshot.mockReturnValue({ ok: false, errors: ["admin.not_found.resource"] });
    mocks.storeCategoryImage.mockResolvedValue(image);
    mocks.removeCategoryImageStorage.mockResolvedValue(false);

    await expect(saveCategoryImageForRequest({
      categoryId,
      imageId: image.id,
      filename: image.filename,
      contentType: image.contentType,
      bytes: new Uint8Array([1, 2, 3]),
    })).resolves.toEqual({
      ok: false,
      errors: ["admin.not_found.resource"],
      cleanupDeferred: true,
      id: categoryId,
      cleanupImageId: image.id,
    });

    expect(mocks.removeCategoryImageStorage).toHaveBeenCalledWith({ categoryId, image });
  });

  it("clears category image metadata before removing its stored object", async () => {
    const categoryId = "33333333-3333-4333-8333-333333333333";
    const image = {
      id: "44444444-4444-4444-8444-444444444444",
      path: `/api/category-media/${categoryId}?v=44444444-4444-4444-8444-444444444444`,
      storagePath: `categories/${categoryId}/image/44444444-4444-4444-8444-444444444444-old.webp`,
      storageProvider: "supabase" as const,
      filename: "old.webp",
      contentType: "image/webp",
      sizeBytes: 1000,
    };
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
      categories: [{ id: categoryId, slug: "books", sortOrder: 1, translations: [{ locale: "en", name: "Books" }], image }],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });

    await expect(removeCategoryImageForRequest(categoryId)).resolves.toMatchObject({ ok: true, cleanupDeferred: false });

    expect(mocks.categoryImageUpdates[0]).toEqual({
      table: "categories",
      fields: {
        image_asset_id: null,
        image_storage_path: null,
        image_storage_provider: null,
        image_filename: null,
        image_content_type: null,
        image_size_bytes: null,
      },
    });
    expect(mocks.removeCategoryImageStorage).toHaveBeenCalledWith({ categoryId, image, authorizationToken: null });
  });

  it("removes a local category and its image file together", async () => {
    const categoryId = "33333333-3333-4333-8333-333333333333";
    const image = {
      id: "44444444-4444-4444-8444-444444444444",
      path: `/uploads/categories/${categoryId}/image/44444444-4444-4444-8444-444444444444-books.webp`,
      storagePath: `categories/${categoryId}/image/44444444-4444-4444-8444-444444444444-books.webp`,
      storageProvider: "supabase" as const,
      filename: "books.webp",
      contentType: "image/webp",
      sizeBytes: 1000,
    };
    mocks.getBackendMode.mockReturnValue("local");
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
      categories: [{ id: categoryId, slug: "books", sortOrder: 1, translations: [{ locale: "en", name: "Books" }], image }],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });

    await expect(deleteCategoryForRequest(categoryId)).resolves.toMatchObject({
      ok: true,
      id: categoryId,
      cleanupDeferred: false,
    });

    expect(mocks.deleteCategory).toHaveBeenCalledWith(categoryId);
    expect(mocks.removeCategoryImageStorage).toHaveBeenCalledWith({ categoryId, image, authorizationToken: undefined });
  });

  it("removes a hosted category and its Supabase/R2 image object together", async () => {
    const categoryId = "33333333-3333-4333-8333-333333333333";
    const image = {
      id: "44444444-4444-4444-8444-444444444444",
      path: `https://media.example.com/categories/${categoryId}/image/44444444-4444-4444-8444-444444444444-books.webp`,
      storagePath: `categories/${categoryId}/image/44444444-4444-4444-8444-444444444444-books.webp`,
      storageProvider: "r2_public" as const,
      filename: "books.webp",
      contentType: "image/webp",
      sizeBytes: 1000,
    };
    mocks.getCurrentAccessToken.mockResolvedValue("test-access-token");
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
      categories: [{ id: categoryId, slug: "books", sortOrder: 1, translations: [{ locale: "en", name: "Books" }], image }],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });

    await expect(deleteCategoryForRequest(categoryId)).resolves.toMatchObject({
      ok: true,
      id: categoryId,
      cleanupDeferred: false,
    });

    expect(mocks.deletedTables).toEqual(["categories"]);
    expect(mocks.removeCategoryImageStorage).toHaveBeenCalledWith({
      categoryId,
      image,
      authorizationToken: "test-access-token",
    });
  });

  it("updates only the English tag translation without deleting other locales", async () => {
    const tagId = "22222222-2222-4222-8222-222222222222";
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
      collections: [],
      categories: [],
      tags: [{ id: tagId, slug: "old-name", translations: [
        { locale: "en", name: "Old name", description: "Old description" },
        { locale: "pl", name: "Stara nazwa", description: "Polski opis" },
      ] }],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });
    const form = new FormData();
    form.set("id", tagId);
    form.set("name", "New name");
    form.set("description", "New description");
    form.set("slug", "new-name");

    await expect(saveTagForRequest(form)).resolves.toMatchObject({ ok: true });

    expect(mocks.upsertedRows).toContainEqual({
      table: "tag_translations",
      rows: { tag_id: tagId, locale: "en", name: "New name", description: "New description" },
      options: { onConflict: "tag_id,locale" },
    });
    expect(mocks.deletedTables).not.toContain("tag_translations");
  });

  it("updates only the English category translation", async () => {
    const categoryId = "33333333-3333-4333-8333-333333333333";
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
      collections: [],
      categories: [{ id: categoryId, slug: "books", sortOrder: 1, translations: [
        { locale: "en", name: "Books", description: "English books" },
        { locale: "pl", name: "Książki", description: "Polskie książki" },
      ] }],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });
    const form = new FormData();
    form.set("id", categoryId);
    form.set("name", "Updated books");
    form.set("description", "Updated description");
    form.set("slug", "books");

    await expect(saveCategoryForRequest(form)).resolves.toMatchObject({ ok: true });

    expect(mocks.upsertedRows).toContainEqual({
      table: "category_translations",
      rows: { category_id: categoryId, locale: "en", name: "Updated books", description: "Updated description" },
      options: { onConflict: "category_id,locale" },
    });
    expect(mocks.deletedTables).not.toContain("category_translations");
  });

  it("rejects over-limit product text before sending a Supabase write", async () => {
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
      collections: [],
      categories: [],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });
    const form = new FormData();
    form.set("title", "T".repeat(141));
    form.set("shortDescription", "S".repeat(301));

    await expect(saveProductForRequest(form)).resolves.toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        "admin.validation.product_title_too_long",
        "admin.validation.product_short_description_too_long",
      ]),
    });

    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("includes a validated collection assignment in the atomic product-save payload", async () => {
    const collectionId = "aaaaaaaa-4999-4999-8999-aaaaaaaaaaaa";
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
      collections: [{
        id: collectionId,
        name: "Forest stories",
        slug: "forest-stories",
        sortOrder: 100,
        createdAt: "2026-10-11T00:00:00.000Z",
        updatedAt: "2026-10-11T00:00:00.000Z",
      }],
      categories: [],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });
    mocks.rpc.mockResolvedValue({ data: { status: "success" }, error: null });
    const form = new FormData();
    form.set("id", productId);
    form.set("slug", "forest-book");
    form.set("status", "draft");
    form.set("audience", "kids");
    form.set("productType", "coloring-book");
    form.set("title", "Forest book");
    form.set("collectionId", collectionId);

    await expect(saveProductForRequest(form)).resolves.toMatchObject({ ok: true, id: productId });

    expect(mocks.rpc).toHaveBeenCalledWith("save_product", expect.objectContaining({
      product_state: expect.objectContaining({ collectionId }),
    }));
  });

  it("rejects an unavailable collection before calling the product-save RPC", async () => {
    const form = new FormData();
    form.set("id", productId);
    form.set("slug", "forest-book");
    form.set("status", "draft");
    form.set("audience", "kids");
    form.set("productType", "coloring-book");
    form.set("title", "Forest book");
    form.set("collectionId", "aaaaaaaa-4999-4999-8999-aaaaaaaaaaaa");

    await expect(saveProductForRequest(form)).resolves.toMatchObject({
      ok: false,
      errors: ["admin.not_found.collection"],
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("creates a collection row with an automatically normalized unique slug", async () => {
    const collectionId = "aaaaaaaa-4999-4999-8999-aaaaaaaaaaaa";
    const form = new FormData();
    form.set("id", collectionId);
    form.set("name", "Forest Stories");
    form.set("slug", "");
    form.set("imagePath", "");
    form.set("imageStorageProvider", "");
    form.set("imageFilename", "");
    form.set("imageContentType", "");
    form.set("imageSizeBytes", "");

    await expect(saveCollectionForRequest(form)).resolves.toMatchObject({ ok: true, id: collectionId });

    expect(mocks.upsertedRows).toContainEqual(expect.objectContaining({
      table: "collections",
      rows: expect.objectContaining({ id: collectionId, name: "Forest Stories", slug: "forest-stories" }),
    }));
  });

  it("reports collection image cleanup failures with the orphaned storage path", async () => {
    const collectionId = "aaaaaaaa-4999-4999-8999-aaaaaaaaaaaa";
    const imagePath = `collections/${collectionId}/image/22222222-2222-4222-8222-222222222222-cover.png`;
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
      collections: [{
        id: collectionId,
        name: "Forest Stories",
        slug: "forest-stories",
        imagePath,
        imageStorageProvider: "supabase",
        imageContentType: "image/png",
        sortOrder: 100,
        createdAt: "2026-10-12T00:00:00.000Z",
        updatedAt: "2026-10-12T00:00:00.000Z",
      }],
      categories: [],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });
    mocks.removeCollectionImage.mockRejectedValue(new Error("storage unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(deleteCollectionForRequest(collectionId)).resolves.toMatchObject({
      ok: true,
      id: collectionId,
      cleanupDeferred: true,
      cleanupImagePath: imagePath,
    });

    expect(mocks.deletedTables).toContain("collections");
    expect(consoleError).toHaveBeenCalledWith("Collection image cleanup was deferred.", expect.any(Error));
    consoleError.mockRestore();
  });

  it("saves a product with existing non-English content intact", async () => {
    const seededProduct = getSeedContentSnapshot().products[0];
    const existingProduct = {
      ...seededProduct,
      id: productId,
      slug: "existing-product",
      translations: [
        ...seededProduct.translations,
        {
          locale: "pl" as const,
          title: "Legacy Polish product",
          shortDescription: "Stored legacy translation.",
          longDescription: "Stored legacy translation.",
        },
      ],
      coverAssetId: "",
      videoAssetId: undefined,
      assets: [],
      amazonLinks: [],
      premiumCodes: [],
    };
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [existingProduct],
      collections: [],
      categories: [],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });
    mocks.rpc.mockResolvedValue({ data: { status: "success" }, error: null });
    const form = new FormData();
    form.set("id", productId);
    form.set("slug", "existing-product");
    form.set("status", "draft");
    form.set("audience", existingProduct.audience);
    form.set("productType", existingProduct.productType);
    form.set("title", "Updated English product");
    form.set("shortDescription", "Updated English description");
    form.set("longDescription", `${RICH_TEXT_FORMAT_PREFIX}${JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Updated rich description", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
        },
        { type: "rawHTML", attrs: { html: "<script>alert(1)</script>" } },
      ],
    })}`);

    await expect(saveProductForRequest(form)).resolves.toMatchObject({ ok: true, id: productId });

    const payload = mocks.rpc.mock.calls[0][1] as { product_state: { translations: Array<{ locale: string; title: string; longDescription: string }> } };
    expect(payload.product_state.translations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        locale: "en",
        title: "Updated English product",
        longDescription: serializeRichTextDocument({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Updated rich description" }] }],
        }),
      }),
      expect.objectContaining({ locale: "pl", title: "Legacy Polish product" }),
    ]));
    expect(payload.product_state.translations.find((translation) => translation.locale === "en")?.longDescription).not.toContain("javascript:");
  });

  it("preserves codes created after an editor loaded while honoring explicit removals", async () => {
    const seededProduct = getSeedContentSnapshot().products[0];
    const preservedCode = {
      id: "22222222-2222-4222-8222-222222222221",
      productId,
      code: "LOMI-BATCH-PRESERVED-2026",
      active: true,
    };
    const removedCode = {
      id: "22222222-2222-4222-8222-222222222222",
      productId,
      code: "LOMI-BATCH-REMOVED-2026",
      active: true,
    };
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [{
        ...seededProduct,
        id: productId,
        slug: "existing-product",
        coverAssetId: "",
        videoAssetId: undefined,
        assets: [],
        amazonLinks: [],
        premiumCodes: [preservedCode, removedCode],
      }],
      categories: [],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });
    mocks.rpc.mockResolvedValue({ data: { status: "success" }, error: null });

    const form = new FormData();
    form.set("id", productId);
    form.set("slug", "existing-product");
    form.set("status", "draft");
    form.set("audience", "kids");
    form.set("productType", "coloring-book");
    form.set("title", "Updated product");
    form.set("shortDescription", "Updated description");
    form.set("premiumCodeClientId", "removed-code-row");
    form.set("premiumCodeId", removedCode.id);
    form.set("premiumCode", removedCode.code);
    form.set("premiumCodeRemove", removedCode.id);
    form.set("premiumCodeRemoveClientId", "removed-code-row");

    await expect(saveProductForRequest(form)).resolves.toMatchObject({ ok: true, id: productId });

    const payload = mocks.rpc.mock.calls[0][1] as {
      product_state: {
        premiumCodes: Array<{ id: string; code: string }>;
        premiumCodeRemovals: string[];
      };
    };
    expect(payload.product_state.premiumCodes).toEqual([
      expect.objectContaining({ id: preservedCode.id, code: preservedCode.code }),
    ]);
    expect(payload.product_state.premiumCodeRemovals).toEqual([removedCode.id]);
  });

  it("saves only the English static page while retaining other locale rows", async () => {
    const seededPages = [
      ...getSeedContentSnapshot().staticPages.filter((page) => page.slug === "terms"),
      {
        id: "legacy-terms-pl",
        slug: "terms" as const,
        locale: "pl" as const,
        title: "Legacy Polish terms",
        body: "Stored legacy terms content.",
        updatedAt: "2026-05-31T00:00:00.000Z",
      },
    ];
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
      collections: [],
      categories: [],
      tags: [],
      staticPages: seededPages,
      catalogSettings: { desktopColumns: 4 },
    });
    const form = new FormData();
    form.set("title", "Updated English terms");
    form.set("body", `${RICH_TEXT_FORMAT_PREFIX}${JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Updated English terms" }] },
        { type: "paragraph", content: [{ type: "text", text: "Terms body", marks: [{ type: "link", attrs: { href: "data:text/html,unsafe" } }] }] },
      ],
    })}`);

    await expect(savePagesForRequest(form, "terms")).resolves.toMatchObject({ ok: true, id: "terms" });

    expect(mocks.upsertedRows.filter((row) => row.table === "static_pages")).toHaveLength(1);
    expect(mocks.upsertedRows).toContainEqual(expect.objectContaining({
      table: "static_pages",
      rows: expect.objectContaining({
        slug: "terms",
        locale: "en",
        title: "Updated English terms",
        body: serializeRichTextDocument({
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Updated English terms" }] },
            { type: "paragraph", content: [{ type: "text", text: "Terms body" }] },
          ],
        }),
      }),
      options: { onConflict: "slug,locale" },
    }));
    expect(mocks.deletedTables).toHaveLength(0);
  });

  it("archives through the update-only RPC without saving a stale product snapshot", async () => {
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [{ id: productId, assets: [] }],
      collections: [],
      categories: [],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });
    mocks.rpc.mockResolvedValue({ data: true, error: null });

    await expect(archiveProductForRequest(productId)).resolves.toEqual({ ok: true, id: productId });

    expect(mocks.rpc).toHaveBeenCalledWith("archive_product", {
      requested_product_id: productId,
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith("save_product", expect.anything());
    expect(mocks.rpc).not.toHaveBeenCalledWith("save_product_with_storage_provider", expect.anything());
  });

  it("does not recreate a product deleted after the admin snapshot was read", async () => {
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [{ id: productId, assets: [] }],
      collections: [],
      categories: [],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    await expect(archiveProductForRequest(productId)).resolves.toEqual({
      ok: false,
      errors: ["admin.not_found.product"],
    });

    expect(mocks.rpc).toHaveBeenCalledWith("archive_product", {
      requested_product_id: productId,
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith("save_product", expect.anything());
  });

  it("returns a stable application error when Supabase rejects a duplicate premium code", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        constraint: "premium_codes_normalized_code_key",
        message: "duplicate key value violates unique constraint",
      },
    });

    const form = new FormData();
    form.set("id", "11111111-1111-4111-8111-111111111111");
    form.set("slug", "duplicate-code-product");
    form.set("status", "draft");
    form.set("audience", "kids");
    form.set("productType", "coloring-book");
    form.set("title", "Duplicate code product");
    form.set("premiumCodeId", "22222222-2222-4222-8222-222222222222");
    form.set("premiumCode", "MOON-123");
    form.set("premiumCodeActive", "22222222-2222-4222-8222-222222222222");

    await expect(saveProductForRequest(form)).resolves.toEqual({
      ok: false,
      errors: ["admin.conflict.premium_code_duplicate"],
    });
  });

  it.each([undefined, "40003", "08007", "08006"])(
    "retains uploaded media when a product save RPC outcome is ambiguous (%s)",
    async (code) => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: {
          ...(code ? { code } : {}),
          message: "upstream connection closed before the save result was confirmed",
        },
      });

      const form = uploadedCoverForm("ambiguous-save-product", "Ambiguous save product");
      await expect(saveProductForRequest(form)).resolves.toMatchObject({ ok: false });

      expect(mocks.storageRemove).not.toHaveBeenCalled();
    },
  );

  it("retains uploaded media when PostgreSQL confirms the save transaction failed", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key value violates a unique constraint" },
    });

    const form = uploadedCoverForm("failed-save-product", "Failed save product");
    await expect(saveProductForRequest(form)).resolves.toMatchObject({ ok: false });

    expect(mocks.storageRemove).not.toHaveBeenCalled();
  });

  it("retains uploaded media when a retry fails validation after an ambiguous save outcome", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("connection closed after database commit"));
    const firstAttempt = uploadedCoverForm("retry-after-ambiguous-save", "First attempt");
    await expect(saveProductForRequest(firstAttempt)).resolves.toMatchObject({ ok: false });

    const retry = uploadedCoverForm("retry-after-ambiguous-save", "Retry");
    retry.set("title", "");

    await expect(saveProductForRequest(retry)).resolves.toMatchObject({ ok: false });

    expect(mocks.storageRemove).not.toHaveBeenCalled();
  });

  it("revalidates the Supabase mirror when retrying an already saved R2 asset still marked uploaded", async () => {
    const storagePath = `products/${productId}/cover/${assetId}-cover.jpg`;
    const existingAsset = {
      id: assetId,
      productId,
      kind: "cover" as const,
      bucket: "public-media",
      path: storagePath,
      storagePath,
      storageProvider: "r2_private" as const,
      filename: "cover.jpg",
      contentType: "image/jpeg",
      sizeBytes: validSquareJpeg.byteLength,
      isPublic: true,
      isActive: true,
      sortOrder: 1,
    };
    const seededProduct = getSeedContentSnapshot().products[0];
    const existingProduct = {
      ...seededProduct,
      id: productId,
      slug: "retry-after-lost-save-response",
      status: "draft" as const,
      coverAssetId: assetId,
      assets: [existingAsset],
      amazonLinks: [],
      premiumCodes: [],
    };
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [existingProduct],
      categories: [],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });
    mocks.rpc.mockResolvedValue({ data: { status: "success" }, error: null });

    const retry = uploadedCoverForm("retry-after-lost-save-response", "Retry after lost response");
    retry.set("assetStorageProvider", "r2_private");
    retry.set("assetPath", storagePath);

    await expect(saveProductForRequest(retry)).resolves.toMatchObject({ ok: true, id: productId });

    expect(mocks.storageDownload).toHaveBeenCalledWith(storagePath);
    expect(mocks.finalizeR2MediaUploads).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: assetId, storageProvider: "r2_private" })]),
      new Set([assetId]),
      new Map([[assetId, createHash("sha256").update(validSquareJpeg).digest("hex")]]),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("save_product_with_storage_provider", expect.anything());
  });

  it("rejects a newly uploaded cover with a forged invalid ratio before saving product metadata", async () => {
    const invalidRatioJpeg = new Uint8Array(await sharp({
      create: { width: 800, height: 1000, channels: 3, background: { r: 50, g: 60, b: 70 } },
    }).jpeg().toBuffer());
    const storagePath = `products/${productId}/cover/${assetId}-cover.jpg`;
    const form = uploadedCoverForm("invalid-ratio-product", "Invalid ratio product");
    form.set("assetSizeBytes", String(invalidRatioJpeg.byteLength));
    mocks.storageDownload.mockResolvedValue({
      data: new Blob([invalidRatioJpeg], { type: "image/jpeg" }),
      error: null,
    });
    mocks.storageInfo.mockResolvedValue({
      data: { size: invalidRatioJpeg.byteLength, contentType: "image/jpeg" },
      error: null,
    });

    await expect(saveProductForRequest(form)).resolves.toEqual({
      ok: false,
      errors: ["admin.validation.image_dimensions"],
    });

    expect(mocks.storageDownload).toHaveBeenCalledWith(storagePath);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.storageRemove).not.toHaveBeenCalled();
  });

  it("rejects an oversized Supabase object from Storage metadata before downloading its bytes", async () => {
    const form = uploadedCoverForm("oversized-cover-product", "Oversized cover product");
    mocks.storageInfo.mockResolvedValue({
      data: { size: 20 * 1024 * 1024 + 1, contentType: "image/jpeg" },
      error: null,
    });

    await expect(saveProductForRequest(form)).resolves.toEqual({
      ok: false,
      errors: ["admin.validation.asset_file"],
    });

    expect(mocks.storageInfo).toHaveBeenCalledWith(`products/${productId}/cover/${assetId}-cover.jpg`);
    expect(mocks.storageDownload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns the checksum of the exact fully decoded Supabase image bytes", async () => {
    const storagePath = "products/" + productId + "/cover/" + assetId + "-cover.jpg";
    const hashes = await assertSupabaseUploadsExist([{
      id: assetId,
      productId,
      kind: "cover",
      bucket: "public-media",
      path: storagePath,
      storagePath,
      filename: "cover.jpg",
      contentType: "image/jpeg",
      sizeBytes: validSquareJpeg.byteLength,
      isPublic: true,
      isActive: true,
      sortOrder: 1,
    }], null, new Set([assetId]));

    expect(hashes.get(assetId)).toBe(createHash("sha256").update(validSquareJpeg).digest("hex"));
    expect(mocks.storageDownload).toHaveBeenCalledWith(storagePath);
  });

  it("rejects an oversized premium code before calling the save RPC", async () => {
    const form = new FormData();
    form.set("id", productId);
    form.set("slug", "oversized-code-product");
    form.set("status", "draft");
    form.set("audience", "kids");
    form.set("productType", "coloring-book");
    form.set("title", "Oversized code product");
    form.set("premiumCodeId", "22222222-2222-4222-8222-222222222222");
    form.set("premiumCode", "x".repeat(129));
    form.set("premiumCodeActive", "22222222-2222-4222-8222-222222222222");

    await expect(saveProductForRequest(form)).resolves.toEqual({
      ok: false,
      errors: ["admin.validation.premium_code_too_long"],
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("checks uploaded objects by exact path and skips static seed assets", async () => {
    await expect(assertSupabaseUploadsExist([
      {
        id: assetId,
        productId,
        kind: "cover",
        bucket: "public-media",
        path: "products/11111111-1111-4111-8111-111111111111/cover/11111111-1111-4111-8111-111111111199-cover.jpg",
        storagePath: "products/11111111-1111-4111-8111-111111111111/cover/11111111-1111-4111-8111-111111111199-cover.jpg",
        filename: "cover.jpg",
        contentType: "image/jpeg",
        isPublic: true,
        isActive: true,
        sortOrder: 1,
      },
      {
        id: "22222222-2222-4222-8222-222222222299",
        productId,
        kind: "gallery",
        bucket: "public-media",
        path: "assets/gallery-placeholder.svg",
        filename: "gallery-placeholder.svg",
        contentType: "image/svg+xml",
        isPublic: true,
        isActive: true,
        sortOrder: 2,
      },
    ])).resolves.toEqual(new Map());

    expect(mocks.storageFrom).toHaveBeenCalledWith("public-media");
    expect(mocks.storageExists).toHaveBeenCalledWith(
      "products/11111111-1111-4111-8111-111111111111/cover/11111111-1111-4111-8111-111111111199-cover.jpg",
    );
    expect(mocks.storageExists).toHaveBeenCalledTimes(1);
  });

  it("rejects missing uploaded objects before product metadata can be saved", async () => {
    mocks.storageExists.mockResolvedValue({
      data: false,
      error: { message: "Object not found", status: 400 },
    });

    await expect(assertSupabaseUploadsExist([{
      id: assetId,
      productId,
      kind: "public_download",
      bucket: "public-media",
      path: "products/11111111-1111-4111-8111-111111111111/public_download/11111111-1111-4111-8111-111111111199-guide.pdf",
      filename: "guide.pdf",
      contentType: "application/pdf",
      isPublic: true,
      isActive: true,
      sortOrder: 1,
    }])).rejects.toMatchObject({
      name: "AdminDatabaseError",
      operation: "asset upload lookup",
    });
  });

  it("rejects an uploaded path that crosses the product or asset-kind boundary", async () => {
    await expect(assertSupabaseUploadsExist([{
      id: assetId,
      productId,
      kind: "video",
      bucket: "public-videos",
      path: "products/other-product/cover/asset.jpg",
      filename: "asset.jpg",
      contentType: "video/mp4",
      isPublic: true,
      isActive: true,
      sortOrder: 1,
    }])).rejects.toMatchObject({
      name: "AdminApplicationError",
      code: "admin.validation.asset_path",
    });

    expect(mocks.storageExists).not.toHaveBeenCalled();
  });
});
