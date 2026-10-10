import { beforeEach, describe, expect, it, vi } from "vitest";

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
  storageRemove: vi.fn(),
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

import {
  archiveProductForRequest,
  assertSupabaseUploadsExist,
  saveProductForRequest,
  saveCategoryForRequest,
  savePagesForRequest,
  saveTagForRequest,
} from "./supabase-content-admin";
import { getSeedContentSnapshot } from "./content-store";

const productId = "11111111-1111-4111-8111-111111111111";
const assetId = "11111111-1111-4111-8111-111111111199";

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
  form.append("assetSizeBytes", "1024");
  form.append("assetStorageProvider", "supabase");
  form.append("assetUploaded", "1");
  form.set("coverAssetId", assetId);
  return form;
}

describe("Supabase content admin mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getCurrentAccessToken.mockResolvedValue(null);
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
      categories: [],
      tags: [],
      staticPages: [],
      catalogSettings: { desktopColumns: 4 },
    });

    const resolvedQuery = () => Promise.resolve({ error: null });
    mocks.upsertedRows = [];
    mocks.deletedTables = [];
    mocks.from.mockImplementation((table: string) => ({
      upsert: vi.fn((rows, options) => {
        mocks.upsertedRows.push({ table, rows, options });
        return resolvedQuery();
      }),
      delete: vi.fn(() => {
        mocks.deletedTables.push(table);
        return { eq: vi.fn(() => resolvedQuery()) };
      }),
      insert: vi.fn(() => resolvedQuery()),
    }));
    mocks.createClient.mockResolvedValue({ from: mocks.from, rpc: mocks.rpc });
    mocks.storageExists.mockResolvedValue({ data: true, error: null });
    mocks.storageRemove.mockResolvedValue({ error: null });
    mocks.storageFrom.mockReturnValue({ exists: mocks.storageExists, remove: mocks.storageRemove });
    mocks.createServiceRoleClient.mockReturnValue({
      storage: { from: mocks.storageFrom },
    });
  });

  it("updates only the English tag translation without deleting other locales", async () => {
    const tagId = "22222222-2222-4222-8222-222222222222";
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
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

    await expect(saveProductForRequest(form)).resolves.toMatchObject({ ok: true, id: productId });

    const payload = mocks.rpc.mock.calls[0][1] as { product_state: { translations: Array<{ locale: string; title: string }> } };
    expect(payload.product_state.translations).toEqual(expect.arrayContaining([
      expect.objectContaining({ locale: "en", title: "Updated English product" }),
      expect.objectContaining({ locale: "pl", title: "Legacy Polish product" }),
    ]));
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
      categories: [],
      tags: [],
      staticPages: seededPages,
      catalogSettings: { desktopColumns: 4 },
    });
    const form = new FormData();
    form.set("title", "Updated English terms");
    form.set("body", "Updated English terms body");

    await expect(savePagesForRequest(form, "terms")).resolves.toMatchObject({ ok: true, id: "terms" });

    expect(mocks.upsertedRows.filter((row) => row.table === "static_pages")).toHaveLength(1);
    expect(mocks.upsertedRows).toContainEqual(expect.objectContaining({
      table: "static_pages",
      rows: expect.objectContaining({ slug: "terms", locale: "en", title: "Updated English terms" }),
      options: { onConflict: "slug,locale" },
    }));
    expect(mocks.deletedTables).toHaveLength(0);
  });

  it("archives through the update-only RPC without saving a stale product snapshot", async () => {
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [{ id: productId, assets: [] }],
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
    ])).resolves.toBeUndefined();

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
