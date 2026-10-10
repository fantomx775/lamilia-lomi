import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  createServiceRoleClient: vi.fn(),
  assertR2PrivateObject: vi.fn(),
  assertR2PublicObject: vi.fn(),
  deleteR2Media: vi.fn(),
  deleteR2PublicMedia: vi.fn(),
  demoteR2PublicObject: vi.fn(),
  finalizeR2StagingUpload: vi.fn(),
  getBackendMode: vi.fn(),
  getR2StorageConfig: vi.fn(),
  getRequiredSupabaseEnv: vi.fn(),
  promoteR2PrivateObject: vi.fn(),
  r2StagingPath: vi.fn(),
  verifyPublicDelivery: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./config", () => ({
  getBackendMode: mocks.getBackendMode,
  getRequiredSupabaseEnv: mocks.getRequiredSupabaseEnv,
}));
vi.mock("./supabase/admin", () => ({ createServiceRoleClient: mocks.createServiceRoleClient }));
vi.mock("./supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("./media-r2-config", () => ({ getR2StorageConfig: mocks.getR2StorageConfig }));
vi.mock("./media-r2", () => ({
  assertR2PrivateObject: mocks.assertR2PrivateObject,
  assertR2PublicObject: mocks.assertR2PublicObject,
  deleteR2Media: mocks.deleteR2Media,
  deleteR2PublicMedia: mocks.deleteR2PublicMedia,
  demoteR2PublicObject: mocks.demoteR2PublicObject,
  finalizeR2StagingUpload: mocks.finalizeR2StagingUpload,
  promoteR2PrivateObject: mocks.promoteR2PrivateObject,
  r2StagingPath: mocks.r2StagingPath,
  verifyPublicDelivery: mocks.verifyPublicDelivery,
}));

import {
  cleanupNewMediaFromFormData,
  cleanupPersistedMedia,
  createSignedMediaUpload,
  reconcileR2Publication,
  removeUploadedMedia,
  revokeR2PublicAssetsBeforeMutation,
} from "./media-storage";

const productId = "11111111-1111-4111-8111-111111111111";

function asset(id: string, storagePath: string) {
  return {
    id,
    productId,
    kind: "cover" as const,
    bucket: "public-media",
    path: `/api/media/${id}`,
    storagePath,
    filename: `${id}.jpg`,
    contentType: "image/jpeg",
    sortOrder: 1,
    isPublic: true,
  };
}

function providerQuery(rows: Array<{ id: string; path: string; storage_provider: string }> = []) {
  const query = {
    in: vi.fn().mockResolvedValue({ data: rows, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null }),
    eq: vi.fn(),
    then: vi.fn((resolve?: (value: { data: typeof rows; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve, reject)),
  };
  query.eq.mockImplementation(() => query);
  return { select: vi.fn(() => query) };
}

function productStatusQuery(status: string | null = "published") {
  const query = {
    maybeSingle: vi.fn().mockResolvedValue({ data: status ? { status } : null, error: null }),
    eq: vi.fn(),
  };
  query.eq.mockImplementation(() => query);
  return { select: vi.fn(() => query) };
}

function singleAssetQuery(row: Record<string, unknown> | null) {
  const query = {
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    eq: vi.fn(),
  };
  query.eq.mockImplementation(() => query);
  return { select: vi.fn(() => query) };
}

function mockLiveAssetState(
  assetId: string,
  storagePath: string,
  readProvider: () => string | null,
  otherRows: Array<Record<string, unknown>> = [],
) {
  mocks.from.mockImplementation((table: string) => {
    if (table === "products") return productStatusQuery("published");
    return {
      select: vi.fn(() => {
        const currentRows = () => {
          const storageProvider = readProvider();
          const current = storageProvider ? [{
            id: assetId,
            product_id: productId,
            kind: "cover",
            path: storagePath,
            storage_provider: storageProvider,
            is_active: true,
            is_public: true,
            products: { status: "published" },
          }] : [];
          return [...current, ...otherRows];
        };
        const query = {
          in: vi.fn().mockImplementation(async () => ({ data: currentRows(), error: null })),
          maybeSingle: vi.fn().mockImplementation(async () => ({
            data: currentRows()[0] ? { storage_provider: readProvider() } : null,
            error: null,
          })),
          eq: vi.fn(),
          then: vi.fn((resolve?: (value: { data: ReturnType<typeof currentRows>; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve({ data: currentRows(), error: null }).then(resolve, reject)),
        };
        query.eq.mockImplementation(() => query);
        return query;
      }),
    };
  });
}

describe("persisted media cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.from.mockImplementation(() => providerQuery());
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from });
    mocks.createServiceRoleClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.demoteR2PublicObject.mockResolvedValue(undefined);
    mocks.deleteR2PublicMedia.mockResolvedValue(undefined);
    mocks.promoteR2PrivateObject.mockResolvedValue(undefined);
    mocks.assertR2PrivateObject.mockResolvedValue({ ContentLength: 1024, ContentType: "image/jpeg" });
    mocks.assertR2PublicObject.mockResolvedValue({ ContentLength: 1024, ContentType: "image/jpeg" });
    mocks.getR2StorageConfig.mockReturnValue({ publicBaseUrl: "https://media.example.com" });
  });

  it("retains a removed Supabase object as the rollback source", async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    mocks.createServiceRoleClient.mockReturnValue({ storage: { from: vi.fn(() => ({ remove })) } });

    await cleanupPersistedMedia({
      previous: [asset("old", `products/${productId}/cover/old.jpg`)],
      next: [asset("new", `products/${productId}/cover/new.jpg`)],
    });

    expect(remove).not.toHaveBeenCalled();
  });

  it("keeps unchanged Supabase objects referenced by parsed product assets", async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    mocks.createServiceRoleClient.mockReturnValue({ storage: { from: vi.fn(() => ({ remove })) } });
    const storagePath = "products/" + productId + "/cover/existing.jpg";

    await cleanupPersistedMedia({
      previous: [asset("existing", storagePath)],
      next: [{
        id: "existing",
        productId,
        kind: "cover",
        bucket: "public-media",
        path: storagePath,
        filename: "existing.jpg",
        contentType: "image/jpeg",
        sortOrder: 1,
        isPublic: true,
      }],
    });

    expect(remove).not.toHaveBeenCalled();
  });

  it("retains persisted R2 and Supabase copies after an asset is removed", async () => {
    const storagePath = `products/${productId}/cover/removed.jpg`;
    mocks.from.mockImplementation(() => providerQuery([{
      id: "removed-asset",
      path: storagePath,
      storage_provider: "r2_public",
    }]));
    const remove = vi.fn().mockResolvedValue({ error: null });
    mocks.createServiceRoleClient.mockReturnValue({ storage: { from: vi.fn(() => ({ remove })) } });

    await cleanupPersistedMedia({
      previous: [{ ...asset("removed-asset", storagePath), storageProvider: "r2_public" }],
      next: [],
    });

    expect(mocks.deleteR2Media).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("retains R2 bytes if a removed stable asset ID may have been reactivated", async () => {
    const storagePath = `products/${productId}/cover/reactivated.jpg`;
    const remove = vi.fn().mockResolvedValue({ error: null });
    mocks.createServiceRoleClient.mockReturnValue({ storage: { from: vi.fn(() => ({ remove })) } });

    await cleanupPersistedMedia({
      previous: [{ ...asset("same-asset", storagePath), storageProvider: "r2_public" }],
      next: [],
    });

    expect(mocks.deleteR2Media).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("defers cloud object cleanup after an uploaded-form failure to avoid racing concurrent saves", async () => {
    const storagePath = `products/${productId}/cover/retried.jpg`;
    const remove = vi.fn().mockResolvedValue({ error: null });
    mocks.createServiceRoleClient.mockReturnValue({
      storage: { from: vi.fn(() => ({ remove })) },
    });
    const formData = new FormData();
    formData.set("id", productId);
    formData.append("assetId", "persisted-asset");
    formData.append("assetKind", "cover");
    formData.append("assetPath", storagePath);
    formData.append("assetStorageProvider", "r2_private");
    formData.append("assetUploaded", "1");

    await cleanupNewMediaFromFormData(formData);

    expect(mocks.deleteR2Media).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("defers direct cleanup of Supabase and R2 uploads", async () => {
    const storagePath = `products/${productId}/cover/asset.jpg`;
    const remove = vi.fn().mockResolvedValue({ error: null });
    mocks.createServiceRoleClient.mockReturnValue({ storage: { from: vi.fn(() => ({ remove })) } });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(removeUploadedMedia({
      productId,
      kind: "cover",
      storagePath,
      storageProvider: "r2_public_revoking",
    })).resolves.toBe(false);
    await expect(removeUploadedMedia({
      productId,
      kind: "cover",
      storagePath,
      storageProvider: "supabase",
    })).resolves.toBe(false);

    expect(mocks.deleteR2Media).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

});

describe("R2 public media revocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockReset();
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.from.mockImplementation(() => providerQuery());
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from });
    mocks.createServiceRoleClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.demoteR2PublicObject.mockResolvedValue(undefined);
    mocks.deleteR2PublicMedia.mockResolvedValue(undefined);
    mocks.promoteR2PrivateObject.mockResolvedValue(undefined);
    mocks.assertR2PrivateObject.mockResolvedValue({ ContentLength: 1024, ContentType: "image/jpeg" });
    mocks.assertR2PublicObject.mockResolvedValue({ ContentLength: 1024, ContentType: "image/jpeg" });
    mocks.getR2StorageConfig.mockReturnValue({ publicBaseUrl: "https://media.example.com" });
  });

  it("sets the private-serving revocation fence before deleting a public object", async () => {
    const events: string[] = [];
    const previous = [{ ...asset("public-image", `products/${productId}/cover/public.jpg`), storageProvider: "r2_public" as const }];
    const adminRpc = vi.fn(async (name: string, args: Record<string, string>) => {
      if (name === "begin_product_asset_public_revocation") {
        events.push("provider-r2_public_revoking");
        return { data: true, error: null };
      }
      events.push(`admin-provider-${args.requested_provider}`);
      return { data: true, error: null };
    });
    const serviceRoleRpc = vi.fn(async (_name: string, args: Record<string, string>) => {
      events.push(`provider-${args.requested_provider}`);
      return { data: true, error: null };
    });
    mocks.createClient.mockResolvedValue({ rpc: adminRpc, from: mocks.from });
    mocks.createServiceRoleClient.mockReturnValue({ rpc: serviceRoleRpc });
    mocks.demoteR2PublicObject.mockImplementation(async () => { events.push("private-copy-verified"); });
    mocks.deleteR2PublicMedia.mockImplementation(async () => { events.push("public-copy-deleted"); });

    await expect(revokeR2PublicAssetsBeforeMutation({
      previousAssets: previous,
      nextAssets: previous,
      status: "draft",
    })).resolves.toEqual(new Set(["public-image"]));

    expect(events).toEqual([
      "provider-r2_public_revoking",
      "private-copy-verified",
      "public-copy-deleted",
      "provider-r2_private",
    ]);
    expect(adminRpc).toHaveBeenCalledTimes(1);
    expect(adminRpc).toHaveBeenCalledWith("begin_product_asset_public_revocation", expect.objectContaining({
      requested_path: previous[0].storagePath,
    }));
    expect(serviceRoleRpc).toHaveBeenCalledWith("set_product_asset_storage_provider", {
      requested_asset_id: previous[0].id,
      requested_provider: "r2_private",
      requested_path: previous[0].storagePath,
    });
  });

  it("keeps the private-serving pending marker when deletion fails", async () => {
    const previous = [{ ...asset("public-image", `products/${productId}/cover/public.jpg`), storageProvider: "r2_public" as const }];
    mocks.deleteR2PublicMedia.mockRejectedValue(new Error("temporary R2 delete failure"));

    await expect(revokeR2PublicAssetsBeforeMutation({
      previousAssets: previous,
      nextAssets: previous,
      status: "draft",
    })).rejects.toThrow("temporary R2 delete failure");

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("begin_product_asset_public_revocation", expect.objectContaining({
      requested_path: previous[0].storagePath,
    }));
  });

  it("blocks a mutation when an earlier public revocation is unfinished", async () => {
    const previous = [{ ...asset("public-image", `products/${productId}/cover/public.jpg`), storageProvider: "r2_public" as const }];
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    mocks.from.mockImplementation(() => providerQuery([{
      id: previous[0].id,
      path: previous[0].storagePath!,
      storage_provider: "r2_public_revoking",
    }]));

    await expect(revokeR2PublicAssetsBeforeMutation({
      previousAssets: previous,
      nextAssets: previous,
      status: "archived",
    })).rejects.toThrow("unfinished R2 public revocation");

    expect(mocks.demoteR2PublicObject).not.toHaveBeenCalled();
    expect(mocks.deleteR2PublicMedia).not.toHaveBeenCalled();
  });

  it("revokes a public marker when an image becomes inactive on a published product", async () => {
    const previous = [{ ...asset("public-image", `products/${productId}/cover/public.jpg`), storageProvider: "r2_public" as const }];
    const next = [{ ...previous[0], isActive: false }];

    await expect(revokeR2PublicAssetsBeforeMutation({
      previousAssets: previous,
      nextAssets: next,
      status: "published",
    })).resolves.toEqual(new Set(["public-image"]));

    expect(mocks.rpc).toHaveBeenCalledWith("set_product_asset_storage_provider", {
      requested_asset_id: "public-image",
      requested_provider: "r2_private",
      requested_path: previous[0].storagePath,
    });
  });

  it("deletes the public object when the same-key sibling is already private", async () => {
    const storagePath = `products/${productId}/cover/shared.jpg`;
    const previous = [{ ...asset("public-image", storagePath), storageProvider: "r2_public" as const }];
    const next = [{ ...previous[0], isActive: false }];
    const currentRow = {
      id: previous[0].id,
      path: storagePath,
      storage_provider: "r2_public",
      product_id: productId,
      kind: "cover",
      is_active: false,
      is_public: true,
      products: { status: "published" },
    };
    const otherReference = {
      id: "other-image",
      path: storagePath,
      storage_provider: "r2_private",
      product_id: productId,
      kind: "cover",
      is_active: true,
      is_public: true,
      products: { status: "published" },
    };
    mocks.from.mockImplementation((table: string) => table === "products"
      ? productStatusQuery("published")
      : providerQuery([currentRow, otherReference]));

    await reconcileR2Publication({ assets: next, previousAssets: previous, status: "published" });

    expect(mocks.deleteR2PublicMedia).toHaveBeenCalledWith(storagePath);
    expect(mocks.rpc).toHaveBeenCalledWith("set_product_asset_storage_provider", {
      requested_asset_id: previous[0].id,
      requested_provider: "r2_private",
      requested_path: storagePath,
    });
  });

  it.each(["r2_public", "r2_public_pending"] as const)(
    "does not demote a same-key object while another published image is %s",
    async (storageProvider) => {
      const storagePath = `products/${productId}/cover/shared.jpg`;
      const previous = [{ ...asset("public-image", storagePath), storageProvider: "r2_public" as const }];
      const next = [{ ...previous[0], isActive: false }];
      const currentRow = {
        id: previous[0].id,
        path: storagePath,
        storage_provider: "r2_public",
        product_id: productId,
        kind: "cover",
        is_active: false,
        is_public: true,
        products: { status: "published" },
      };
      const otherReference = {
        id: "other-image",
        path: storagePath,
        storage_provider: storageProvider,
        product_id: productId,
        kind: "cover",
        is_active: true,
        is_public: true,
        products: { status: "published" },
      };
      mocks.from.mockImplementation((table: string) => table === "products"
        ? productStatusQuery("published")
        : providerQuery([currentRow, otherReference]));

      await reconcileR2Publication({ assets: next, previousAssets: previous, status: "published" });

      expect(mocks.demoteR2PublicObject).not.toHaveBeenCalled();
      expect(mocks.deleteR2PublicMedia).not.toHaveBeenCalled();
      expect(mocks.rpc).toHaveBeenCalledWith("set_product_asset_storage_provider", {
        requested_asset_id: previous[0].id,
        requested_provider: "r2_private",
        requested_path: storagePath,
      });
    },
  );

  it("keeps a failed cleanup revocation-fenced and retryable", async () => {
    const previous = [{ ...asset("private-image", `products/${productId}/cover/private.jpg`), storageProvider: "r2_private" as const }];
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let provider = "r2_private";
    mockLiveAssetState(previous[0].id, previous[0].storagePath!, () => provider);
    mocks.rpc.mockImplementation(async (name, args) => {
      if (name === "set_product_asset_storage_provider" && args.requested_provider === "r2_public_pending") {
        provider = "r2_public_pending";
        return { data: true, error: null };
      }
      if (name === "begin_product_asset_public_revocation") {
        provider = "r2_public_revoking";
        return { data: true, error: null };
      }
      return { data: false, error: null };
    });
    mocks.promoteR2PrivateObject.mockRejectedValue(new Error("temporary verification failure"));
    mocks.deleteR2PublicMedia.mockRejectedValue(new Error("temporary R2 delete failure"));

    await reconcileR2Publication({ assets: previous, previousAssets: [], status: "published" });

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith("set_product_asset_storage_provider", {
      requested_asset_id: "private-image",
      requested_provider: "r2_public_pending",
      requested_path: previous[0].storagePath,
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith("set_product_asset_storage_provider", expect.objectContaining({ requested_provider: "r2_public" }));
    expect(provider).toBe("r2_public_revoking");
    expect(mocks.deleteR2PublicMedia).toHaveBeenCalledWith(previous[0].storagePath);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("publiczny URL może nadal być dostępny"), expect.objectContaining({
      assetId: previous[0].id,
      providerObserved: "r2_public_revoking",
    }));
    logged.mockRestore();
  });

  it("removes a public copy if the database no longer confirms eligibility after copying", async () => {
    const privateAsset = [{ ...asset("private-image", `products/${productId}/cover/private.jpg`), storageProvider: "r2_private" as const }];
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let provider = "r2_private";
    mockLiveAssetState(privateAsset[0].id, privateAsset[0].storagePath!, () => provider);
    mocks.rpc.mockImplementation(async (name, args) => {
      if (name === "set_product_asset_storage_provider" && args.requested_provider === "r2_public_pending") {
        provider = "r2_public_pending";
        return { data: true, error: null };
      }
      if (name === "set_product_asset_storage_provider" && args.requested_provider === "r2_public") {
        return { data: false, error: null };
      }
      if (name === "begin_product_asset_public_revocation") {
        provider = "r2_public_revoking";
        return { data: true, error: null };
      }
      if (name === "set_product_asset_storage_provider" && args.requested_provider === "r2_private") {
        provider = "r2_private";
        return { data: true, error: null };
      }
      return { data: false, error: null };
    });

    await reconcileR2Publication({ assets: privateAsset, previousAssets: [], status: "published" });

    expect(mocks.promoteR2PrivateObject).toHaveBeenCalledTimes(1);
    expect(mocks.deleteR2PublicMedia).toHaveBeenCalledWith(privateAsset[0].storagePath);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "set_product_asset_storage_provider", {
      requested_asset_id: "private-image",
      requested_provider: "r2_public",
      requested_path: privateAsset[0].storagePath,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(4, "set_product_asset_storage_provider", {
      requested_asset_id: "private-image",
      requested_provider: "r2_private",
      requested_path: privateAsset[0].storagePath,
    });
    logged.mockRestore();
  });

  it("does not leave a copy public unless Supabase confirms final eligibility", async () => {
    const privateAsset = [{ ...asset("private-image", `products/${productId}/cover/private.jpg`), storageProvider: "r2_private" as const }];
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let provider = "r2_private";
    mockLiveAssetState(privateAsset[0].id, privateAsset[0].storagePath!, () => provider);
    mocks.rpc.mockImplementation(async (name, args) => {
      if (name === "set_product_asset_storage_provider" && args.requested_provider === "r2_public_pending") {
        provider = "r2_public_pending";
        return { data: true, error: null };
      }
      if (name === "set_product_asset_storage_provider" && args.requested_provider === "r2_public") {
        return { data: false, error: null };
      }
      if (name === "begin_product_asset_public_revocation") {
        provider = "r2_public_revoking";
        return { data: true, error: null };
      }
      if (name === "set_product_asset_storage_provider" && args.requested_provider === "r2_private") {
        provider = "r2_private";
        return { data: true, error: null };
      }
      return { data: false, error: null };
    });

    await reconcileR2Publication({ assets: privateAsset, previousAssets: [], status: "published" });

    expect(mocks.rpc).toHaveBeenCalledWith("set_product_asset_storage_provider", {
      requested_asset_id: "private-image",
      requested_provider: "r2_public",
      requested_path: privateAsset[0].storagePath,
    });
    expect(mocks.createServiceRoleClient).toHaveBeenCalledWith();
    expect(mocks.promoteR2PrivateObject).toHaveBeenCalledTimes(1);
    expect(mocks.deleteR2PublicMedia).toHaveBeenCalledWith(privateAsset[0].storagePath);
    logged.mockRestore();
  });

  it("deletes a late public copy when the asset row disappears during publication", async () => {
    const privateAsset = [{ ...asset("private-image", `products/${productId}/cover/private.jpg`), storageProvider: "r2_private" as const }];
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });

    await reconcileR2Publication({ assets: privateAsset, previousAssets: [], status: "published" });

    expect(mocks.deleteR2PublicMedia).toHaveBeenCalledWith(privateAsset[0].storagePath);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });

  it("deletes a copy that finishes after the revoker's delete and preserves its fence", async () => {
    const privateAsset = [{ ...asset("private-image", `products/${productId}/cover/private.jpg`), storageProvider: "r2_private" as const }];
    const storagePath = privateAsset[0].storagePath!;
    const events: string[] = [];
    const publicObjects = new Set<string>();
    let provider = "r2_private";
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    mocks.from.mockImplementation((table: string) => {
      if (table === "products") return productStatusQuery("published");
      const currentRow = {
        id: privateAsset[0].id,
        product_id: productId,
        kind: "cover",
        path: storagePath,
        storage_provider: provider,
        is_active: true,
        is_public: true,
        products: { status: "published" },
      };
      const query = {
        in: vi.fn().mockResolvedValue({ data: [{ ...currentRow }], error: null }),
        maybeSingle: vi.fn().mockImplementation(async () => ({ data: { storage_provider: provider }, error: null })),
        eq: vi.fn(),
        then: vi.fn((resolve?: (value: { data: typeof currentRow[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: [{ ...currentRow }], error: null }).then(resolve, reject)),
      };
      query.eq.mockImplementation(() => query);
      return { select: vi.fn(() => query) };
    });
    mocks.rpc.mockImplementation(async (name, args) => {
      if (name === "set_product_asset_storage_provider" && args.requested_provider === "r2_public_pending") {
        provider = "r2_public_pending";
        return { data: true, error: null };
      }
      if (name === "set_product_asset_storage_provider" && args.requested_provider === "r2_public") {
        return { data: false, error: null };
      }
      if (name === "begin_product_asset_public_revocation") {
        return { data: false, error: null };
      }
      if (name === "set_product_asset_storage_provider" && args.requested_provider === "r2_private") {
        provider = "r2_private";
        return { data: true, error: null };
      }
      return { data: false, error: null };
    });
    mocks.deleteR2PublicMedia.mockImplementation(async (path: string) => {
      events.push(`delete:${publicObjects.has(path) ? "object" : "empty"}`);
      publicObjects.delete(path);
    });
    mocks.promoteR2PrivateObject.mockImplementation(async () => {
      // The revoker finishes its first delete while the public copy is in flight.
      provider = "r2_public_revoking";
      await mocks.deleteR2PublicMedia(storagePath);
      publicObjects.add(storagePath);
      events.push("copy-completed-after-revoker-delete");
    });

    await reconcileR2Publication({ assets: privateAsset, previousAssets: [], status: "published" });

    expect(events).toEqual(["delete:empty", "copy-completed-after-revoker-delete", "delete:object"]);
    expect(publicObjects.has(storagePath)).toBe(false);
    expect(provider).toBe("r2_public_revoking");
    expect(mocks.rpc).not.toHaveBeenCalledWith("set_product_asset_storage_provider", expect.objectContaining({
      requested_provider: "r2_private",
    }));

    // The revocation owner may now finish its state transition; no public copy remains.
    provider = "r2_private";
    expect(publicObjects.has(storagePath)).toBe(false);
    logged.mockRestore();
  });

  it("re-fences a late copy when revocation completed before publication cleanup", async () => {
    const privateAsset = [{ ...asset("private-image", `products/${productId}/cover/private.jpg`), storageProvider: "r2_private" as const }];
    const storagePath = privateAsset[0].storagePath!;
    const events: string[] = [];
    const publicObjects = new Set<string>();
    let provider = "r2_private";
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockLiveAssetState(privateAsset[0].id, storagePath, () => provider);
    mocks.rpc.mockImplementation(async (name, args) => {
      if (name === "set_product_asset_storage_provider" && args.requested_provider === "r2_public_pending") {
        provider = "r2_public_pending";
        return { data: true, error: null };
      }
      if (name === "set_product_asset_storage_provider" && args.requested_provider === "r2_public") {
        return { data: false, error: null };
      }
      if (name === "begin_product_asset_public_revocation") {
        provider = "r2_public_revoking";
        return { data: true, error: null };
      }
      if (name === "set_product_asset_storage_provider" && args.requested_provider === "r2_private") {
        provider = "r2_private";
        return { data: true, error: null };
      }
      return { data: false, error: null };
    });
    mocks.deleteR2PublicMedia.mockImplementation(async (path: string) => {
      events.push(`delete:${publicObjects.has(path) ? "object" : "empty"}`);
      publicObjects.delete(path);
    });
    mocks.promoteR2PrivateObject.mockImplementation(async () => {
      // The earlier revoker has already removed the object and released its fence.
      provider = "r2_public_revoking";
      await mocks.deleteR2PublicMedia(storagePath);
      provider = "r2_private";
      events.push("revocation-completed");
      publicObjects.add(storagePath);
      events.push("copy-completed-after-revocation");
    });

    await reconcileR2Publication({ assets: privateAsset, previousAssets: [], status: "published" });

    expect(events).toEqual([
      "delete:empty",
      "revocation-completed",
      "copy-completed-after-revocation",
      "delete:object",
    ]);
    expect(publicObjects.has(storagePath)).toBe(false);
    expect(provider).toBe("r2_private");
    expect(mocks.rpc).toHaveBeenCalledWith("begin_product_asset_public_revocation", {
      requested_asset_id: privateAsset[0].id,
      requested_path: storagePath,
    });
    logged.mockRestore();
  });

  it("retains a same-key public object while another published image still references it", async () => {
    const privateAsset = [{ ...asset("private-image", `products/${productId}/cover/shared.jpg`), storageProvider: "r2_private" as const }];
    const storagePath = privateAsset[0].storagePath!;
    const publicObjects = new Set<string>();
    const otherReference = {
      id: "other-image",
      product_id: productId,
      kind: "cover",
      path: storagePath,
      storage_provider: "r2_public",
      is_active: true,
      is_public: true,
      products: { status: "published" },
    };
    let provider = "r2_private";
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockLiveAssetState(privateAsset[0].id, storagePath, () => provider, [otherReference]);
    mocks.rpc.mockImplementation(async (name, args) => {
      if (name === "set_product_asset_storage_provider" && args.requested_provider === "r2_public_pending") {
        provider = "r2_public_pending";
        return { data: true, error: null };
      }
      if (name === "set_product_asset_storage_provider" && args.requested_provider === "r2_public") {
        return { data: false, error: null };
      }
      return { data: false, error: null };
    });
    mocks.promoteR2PrivateObject.mockImplementation(async () => {
      publicObjects.add(storagePath);
    });

    await reconcileR2Publication({ assets: privateAsset, previousAssets: [], status: "published" });

    expect(publicObjects.has(storagePath)).toBe(true);
    expect(mocks.deleteR2PublicMedia).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith("begin_product_asset_public_revocation", expect.anything());
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("inny kwalifikujący się obraz"), expect.objectContaining({
      assetId: privateAsset[0].id,
    }));
    logged.mockRestore();
  });

  it("revokes an ineligible public image during publication reconciliation", async () => {
    const previous = [{ ...asset("public-image", `products/${productId}/cover/public.jpg`), storageProvider: "r2_public" as const }];
    const next = [{ ...previous[0], isActive: false }];

    await reconcileR2Publication({ assets: next, previousAssets: previous, status: "published" });

    expect(mocks.rpc).toHaveBeenCalledWith("begin_product_asset_public_revocation", {
      requested_asset_id: "public-image",
      requested_path: previous[0].storagePath,
    });
    expect(mocks.promoteR2PrivateObject).not.toHaveBeenCalled();
  });

  it("cleans a pending public copy when its image becomes inactive", async () => {
    const pending = [{ ...asset("public-image", `products/${productId}/cover/public.jpg`), storageProvider: "r2_public_pending" as const }];
    const next = [{ ...pending[0], isActive: false }];

    await reconcileR2Publication({ assets: next, previousAssets: pending, status: "published" });

    expect(mocks.deleteR2PublicMedia).toHaveBeenCalledWith(pending[0].storagePath);
    expect(mocks.rpc).toHaveBeenLastCalledWith("set_product_asset_storage_provider", {
      requested_asset_id: "public-image",
      requested_provider: "r2_private",
      requested_path: pending[0].storagePath,
    });
    expect(mocks.promoteR2PrivateObject).not.toHaveBeenCalled();
  });

  it("refreshes the provider after save so an interleaved pending publication is revoked", async () => {
    const savedPrivate = asset("public-image", `products/${productId}/cover/public.jpg`);
    mocks.from.mockImplementation((table: string) => table === "products"
      ? productStatusQuery("draft")
      : providerQuery([{
          id: savedPrivate.id,
          path: savedPrivate.storagePath!,
          storage_provider: "r2_public_pending",
        }]));

    await reconcileR2Publication({ assets: [savedPrivate], previousAssets: [], status: "draft" });

    expect(mocks.deleteR2PublicMedia).toHaveBeenCalledWith(savedPrivate.storagePath);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "begin_product_asset_public_revocation", {
      requested_asset_id: savedPrivate.id,
      requested_path: savedPrivate.storagePath,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "set_product_asset_storage_provider", {
      requested_asset_id: savedPrivate.id,
      requested_provider: "r2_private",
      requested_path: savedPrivate.storagePath,
    });
  });

  it("uses the current published product state instead of a stale archive request", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const publicAsset = [{ ...asset("public-image", `products/${productId}/cover/public.jpg`), storageProvider: "r2_public" as const }];
    mocks.from.mockImplementation((table: string) => table === "products"
      ? productStatusQuery("published")
      : providerQuery([{
          id: publicAsset[0].id,
          path: publicAsset[0].storagePath!,
          storage_provider: "r2_public",
        }]));

    await reconcileR2Publication({ assets: publicAsset, previousAssets: publicAsset, status: "archived" });

    expect(mocks.from).toHaveBeenCalledWith("products");
    expect(mocks.from).toHaveBeenCalledWith("product_assets");
    expect(mocks.assertR2PublicObject).toHaveBeenCalledWith(publicAsset[0].storagePath, undefined);
    expect(errors).not.toHaveBeenCalled();
    expect(mocks.verifyPublicDelivery).toHaveBeenCalledWith("https://media.example.com", publicAsset[0].storagePath, undefined);
    expect(mocks.deleteR2PublicMedia).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("restores public delivery if a concurrent publish wins during archive cleanup", async () => {
    const publicAsset = [{ ...asset("public-image", `products/${productId}/cover/public.jpg`), storageProvider: "r2_public" as const }];
    let assetReads = 0;
    let productReads = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === "products") {
        productReads += 1;
        return productStatusQuery(productReads === 1 ? "archived" : "published");
      }

      assetReads += 1;
      if (assetReads === 4) {
        return singleAssetQuery({
          id: publicAsset[0].id,
          path: publicAsset[0].storagePath,
          storage_provider: "r2_private",
          is_active: true,
          is_public: true,
          content_type: "image/jpeg",
          products: { status: "published" },
        });
      }

      return providerQuery([{
        id: publicAsset[0].id,
        path: publicAsset[0].storagePath!,
        storage_provider: assetReads === 1 ? "r2_public" : "r2_private",
      }]);
    });

    await reconcileR2Publication({ assets: publicAsset, previousAssets: publicAsset, status: "archived" });

    expect(mocks.deleteR2PublicMedia).toHaveBeenCalledWith(publicAsset[0].storagePath);
    expect(mocks.promoteR2PrivateObject).toHaveBeenCalledWith(publicAsset[0].storagePath, "image/jpeg");
    expect(mocks.rpc).toHaveBeenCalledWith("set_product_asset_storage_provider", {
      requested_asset_id: publicAsset[0].id,
      requested_provider: "r2_public",
      requested_path: publicAsset[0].storagePath,
    });
  });
});

describe("signed media upload targets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBackendMode.mockReturnValue("supabase");
  });

  it("keeps the original filename for display while generating a Storage-safe path", async () => {
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: { token: "signed-token" },
      error: null,
    });
    mocks.getRequiredSupabaseEnv.mockReturnValue({ url: "https://project.supabase.co" });
    mocks.createServiceRoleClient.mockReturnValue({
      storage: {
        from: vi.fn(() => ({ createSignedUploadUrl })),
      },
    });

    const result = await createSignedMediaUpload({
      assetId: "22222222-2222-4222-8222-222222222222",
      productId,
      kind: "gallery",
      filename: "Zdjęcie cyfrowe 1.webp",
    });

    expect(createSignedUploadUrl).toHaveBeenCalledWith(
      `products/${productId}/gallery/22222222-2222-4222-8222-222222222222-Zdjecie-cyfrowe-1.webp`,
    );
    expect(result.filename).toBe("Zdjęcie cyfrowe 1.webp");
  });
});
