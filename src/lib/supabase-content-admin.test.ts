import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentAccessToken: vi.fn(),
  getAdminContentSnapshot: vi.fn(),
  getBackendMode: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  insertedTagTranslations: undefined as unknown,
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
  saveTagForRequest,
} from "./supabase-content-admin";

const productId = "11111111-1111-4111-8111-111111111111";
const assetId = "11111111-1111-4111-8111-111111111199";

function uploadedCoverForm(slug: string, title: string) {
  const form = new FormData();
  form.set("id", productId);
  form.set("slug", slug);
  form.set("status", "draft");
  form.set("audience", "kids");
  form.set("productType", "coloring-book");
  form.set("title_en", title);
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
    mocks.from.mockImplementation(() => ({
      upsert: vi.fn(() => resolvedQuery()),
      delete: vi.fn(() => ({ eq: vi.fn(() => resolvedQuery()) })),
      insert: vi.fn((rows) => {
        mocks.insertedTagTranslations = rows;
        return resolvedQuery();
      }),
    }));
    mocks.createClient.mockResolvedValue({ from: mocks.from, rpc: mocks.rpc });
    mocks.storageExists.mockResolvedValue({ data: true, error: null });
    mocks.storageRemove.mockResolvedValue({ error: null });
    mocks.storageFrom.mockReturnValue({ exists: mocks.storageExists, remove: mocks.storageRemove });
    mocks.createServiceRoleClient.mockReturnValue({
      storage: { from: mocks.storageFrom },
    });
  });

  it("persists the last visible tag name and description when the drawer has mirrored fields", async () => {
    const form = new FormData();
    form.append("name_en", "Old name");
    form.append("description_en", "Old description");
    form.append("name_en", "New name");
    form.append("description_en", "New description");
    form.set("slug", "new-name");

    await expect(saveTagForRequest(form)).resolves.toMatchObject({ ok: true });

    expect(mocks.insertedTagTranslations).toEqual([
      {
        tag_id: expect.any(String),
        locale: "en",
        name: "New name",
        description: "New description",
      },
    ]);
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
    form.set("title_en", "Duplicate code product");
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
    retry.set("title_en", "");

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
    form.set("title_en", "Oversized code product");
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
