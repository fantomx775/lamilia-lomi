import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAssetByIdForRequest: vi.fn(),
  getDemoSession: vi.fn(),
  getBackendMode: vi.fn(),
  getProductByIdForRequest: vi.fn(),
  createServiceRoleClient: vi.fn(),
  createSignedR2ReadUrl: vi.fn(),
  getR2PublicBaseUrl: vi.fn(),
  r2PublicMediaUrl: vi.fn(),
  hasAdminAccess: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ hasAdminAccess: mocks.hasAdminAccess }));
vi.mock("@/lib/config", () => ({ getBackendMode: mocks.getBackendMode }));
vi.mock("@/lib/media-r2-config", () => ({
  getR2PublicBaseUrl: mocks.getR2PublicBaseUrl,
  r2PublicMediaUrl: mocks.r2PublicMediaUrl,
}));
vi.mock("@/lib/media-r2", () => ({ createSignedR2ReadUrl: mocks.createSignedR2ReadUrl }));
vi.mock("@/lib/products-request", () => ({
  getAssetByIdForRequest: mocks.getAssetByIdForRequest,
  getProductByIdForRequest: mocks.getProductByIdForRequest,
}));
vi.mock("@/lib/session.server", () => ({ getDemoSession: mocks.getDemoSession }));
vi.mock("@/lib/supabase/admin", () => ({ createServiceRoleClient: mocks.createServiceRoleClient }));

import { GET } from "./route";

const productId = "11111111-1111-4111-8111-111111111111";
const assetId = "11111111-1111-4111-8111-111111111199";

describe("public media delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDemoSession.mockResolvedValue(null);
    mocks.hasAdminAccess.mockImplementation((session) => session?.role === "admin");
    mocks.getR2PublicBaseUrl.mockReturnValue(null);
    mocks.r2PublicMediaUrl.mockReturnValue(null);
  });

  it("redirects authorized media to a short-lived Storage URL without downloading through Next", async () => {
    const download = vi.fn();
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://project.storage.supabase.co/object/sign/public-media/file?token=short" },
      error: null,
    });
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getAssetByIdForRequest.mockResolvedValue({
      id: assetId,
      productId,
      kind: "cover",
      bucket: "public-media",
      path: `/api/media/${assetId}`,
      storagePath: `products/${productId}/cover/${assetId}-cover.jpg`,
      filename: "cover.jpg",
      contentType: "image/jpeg",
      isPublic: true,
      isActive: true,
    });
    mocks.getProductByIdForRequest.mockResolvedValue({ id: productId, status: "published" });
    mocks.createServiceRoleClient.mockReturnValue({
      storage: { from: vi.fn(() => ({ createSignedUrl, download })) },
    });

    const response = await GET(new Request(`https://lamilialomi.com/api/media/${assetId}`), { params: Promise.resolve({ assetId }) });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("token=short");
    expect(createSignedUrl).toHaveBeenCalledWith(`products/${productId}/cover/${assetId}-cover.jpg`, 60, { download: undefined });
    expect(download).not.toHaveBeenCalled();
  });

  it("serves published private-R2 media through a short-lived signed URL", async () => {
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getAssetByIdForRequest.mockResolvedValue({
      id: assetId,
      productId,
      kind: "cover",
      bucket: "public-media",
      path: `/api/media/${assetId}`,
      storagePath: `products/${productId}/cover/${assetId}-cover.jpg`,
      storageProvider: "r2_private",
      filename: "cover.jpg",
      contentType: "image/jpeg",
      isPublic: true,
      isActive: true,
    });
    mocks.getProductByIdForRequest.mockResolvedValue({ id: productId, status: "published" });
    mocks.createSignedR2ReadUrl.mockResolvedValue("https://r2.example/private-signed-image");

    const response = await GET(new Request(`https://lamilialomi.com/api/media/${assetId}`), { params: Promise.resolve({ assetId }) });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://r2.example/private-signed-image");
    expect(mocks.createSignedR2ReadUrl).toHaveBeenCalledWith(`products/${productId}/cover/${assetId}-cover.jpg`);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it.each(["r2_public_pending", "r2_public_revoking"] as const)(
    "keeps %s media on the private signed route",
    async (storageProvider) => {
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getAssetByIdForRequest.mockResolvedValue({
      id: assetId,
      productId,
      kind: "cover",
      bucket: "public-media",
      path: `/api/media/${assetId}`,
      storagePath: `products/${productId}/cover/${assetId}-cover.jpg`,
      storageProvider,
      filename: "cover.jpg",
      contentType: "image/jpeg",
      isPublic: true,
      isActive: true,
    });
    mocks.getProductByIdForRequest.mockResolvedValue({ id: productId, status: "published" });
    mocks.createSignedR2ReadUrl.mockResolvedValue("https://r2.example/private-signed-image");

    const response = await GET(new Request(`https://lamilialomi.com/api/media/${assetId}`), { params: Promise.resolve({ assetId }) });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://r2.example/private-signed-image");
    expect(mocks.createSignedR2ReadUrl).toHaveBeenCalledWith(`products/${productId}/cover/${assetId}-cover.jpg`);
    },
  );

  it("lets an admin preview archived R2 media through a private URL", async () => {
    const archivedAsset = {
      id: assetId,
      productId,
      kind: "cover",
      bucket: "public-media",
      path: `/api/media/${assetId}`,
      storagePath: `products/${productId}/cover/${assetId}-cover.jpg`,
      storageProvider: "r2_public",
      filename: "cover.jpg",
      contentType: "image/jpeg",
      isPublic: true,
      isActive: true,
    };
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getDemoSession.mockResolvedValue({ role: "admin" });
    mocks.getAssetByIdForRequest.mockImplementation(async (_id, options) =>
      options?.includeDrafts ? archivedAsset : undefined,
    );
    mocks.getProductByIdForRequest.mockResolvedValue({ id: productId, status: "archived" });
    mocks.createSignedR2ReadUrl.mockResolvedValue("https://r2.example/private-admin-preview");
    mocks.getR2PublicBaseUrl.mockReturnValue("https://media.example.com");
    mocks.r2PublicMediaUrl.mockReturnValue("https://media.example.com/public-image");

    const response = await GET(new Request(`https://lamilialomi.com/api/media/${assetId}`), { params: Promise.resolve({ assetId }) });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://r2.example/private-admin-preview");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getAssetByIdForRequest).toHaveBeenLastCalledWith(assetId, { includeDrafts: true });
    expect(mocks.createSignedR2ReadUrl).toHaveBeenCalledWith(`products/${productId}/cover/${assetId}-cover.jpg`);
    expect(mocks.r2PublicMediaUrl).not.toHaveBeenCalled();
  });

  it("falls back to the retained Supabase mirror when private R2 reads fail", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://project.storage.supabase.co/object/sign/public-media/file?token=mirror" },
      error: null,
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getAssetByIdForRequest.mockResolvedValue({
      id: assetId,
      productId,
      kind: "cover",
      bucket: "public-media",
      path: `/api/media/${assetId}`,
      storagePath: `products/${productId}/cover/${assetId}-cover.jpg`,
      storageProvider: "r2_private",
      filename: "cover.jpg",
      contentType: "image/jpeg",
      isPublic: true,
      isActive: true,
    });
    mocks.getProductByIdForRequest.mockResolvedValue({ id: productId, status: "published" });
    mocks.createSignedR2ReadUrl.mockRejectedValue(new Error("R2 unavailable"));
    mocks.createServiceRoleClient.mockReturnValue({
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    });

    const response = await GET(new Request(`https://lamilialomi.com/api/media/${assetId}`), { params: Promise.resolve({ assetId }) });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("token=mirror");
    consoleError.mockRestore();
  });

  it("does not issue a Storage URL for draft or misclassified media", async () => {
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getAssetByIdForRequest.mockResolvedValue({
      id: assetId,
      productId,
      kind: "cover",
      bucket: "public-videos",
      path: `/api/media/${assetId}`,
      storagePath: `products/${productId}/cover/${assetId}-cover.jpg`,
      filename: "cover.jpg",
      contentType: "image/jpeg",
      isPublic: true,
      isActive: true,
    });
    mocks.getProductByIdForRequest.mockResolvedValue({ id: productId, status: "draft" });

    const response = await GET(new Request(`https://lamilialomi.com/api/media/${assetId}`), { params: Promise.resolve({ assetId }) });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("returns not found for a stale metadata row without logging a server failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getAssetByIdForRequest.mockResolvedValue({
      id: assetId,
      productId,
      kind: "cover",
      bucket: "public-media",
      path: `/api/media/${assetId}`,
      storagePath: `products/${productId}/cover/${assetId}-cover.jpg`,
      filename: "cover.jpg",
      contentType: "image/jpeg",
      isPublic: true,
      isActive: true,
    });
    mocks.getProductByIdForRequest.mockResolvedValue({ id: productId, status: "published" });
    mocks.createServiceRoleClient.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "Object not found", status: 400, statusCode: "NoSuchKey" },
          }),
        })),
      },
    });

    const response = await GET(new Request(`https://lamilialomi.com/api/media/${assetId}`), { params: Promise.resolve({ assetId }) });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("returns a sanitized temporary-unavailable response when media metadata cannot be read", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getAssetByIdForRequest.mockRejectedValue(new Error("database credentials must stay server-side"));

    const response = await GET(new Request(`https://lamilialomi.com/api/media/${assetId}`), { params: Promise.resolve({ assetId }) });

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("Media temporarily unavailable");
    expect(consoleError).toHaveBeenCalledWith(
      "[public-media] Signed media URL generation failed.",
      expect.objectContaining({ assetId, bucket: null, kind: null }),
    );
    expect(consoleError.mock.calls[0]?.[1]).not.toHaveProperty("error");
    consoleError.mockRestore();
  });

  it("does not turn Storage authentication or configuration failures into a misleading 404", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getAssetByIdForRequest.mockResolvedValue({
      id: assetId,
      productId,
      kind: "video",
      bucket: "public-videos",
      path: `/api/media/${assetId}`,
      storagePath: `products/${productId}/video/${assetId}-preview.mp4`,
      filename: "preview.mp4",
      contentType: "video/mp4",
      isPublic: true,
      isActive: true,
    });
    mocks.getProductByIdForRequest.mockResolvedValue({ id: productId, status: "published" });
    mocks.createServiceRoleClient.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "Invalid Compact JWS", status: 400, statusCode: "InvalidJWT" },
          }),
        })),
      },
    });

    const response = await GET(new Request(`https://lamilialomi.com/api/media/${assetId}`), { params: Promise.resolve({ assetId }) });

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Media temporarily unavailable");
    expect(consoleError).toHaveBeenCalledWith(
      "[public-media] Signed media URL generation failed.",
      expect.objectContaining({ assetId, bucket: "public-videos", kind: "video", status: 400, statusCode: "InvalidJWT" }),
    );
    consoleError.mockRestore();
  });

  it("keeps premium media unavailable to anonymous public requests", async () => {
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getAssetByIdForRequest.mockResolvedValue({
      id: assetId,
      productId,
      kind: "premium_download",
      bucket: "premium-files",
      path: `products/${productId}/premium_download/${assetId}-bonus.pdf`,
      storagePath: `products/${productId}/premium_download/${assetId}-bonus.pdf`,
      filename: "bonus.pdf",
      contentType: "application/pdf",
      isPublic: false,
      isActive: true,
    });
    mocks.getProductByIdForRequest.mockResolvedValue({ id: productId, status: "published" });

    const response = await GET(new Request(`https://lamilialomi.com/api/media/${assetId}`), { params: Promise.resolve({ assetId }) });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "an unexpected bucket",
      asset: { bucket: "public-videos" },
    },
    {
      label: "a cross-product storage path",
      asset: { storagePath: "products/22222222-2222-4222-8222-222222222222/cover/file.jpg" },
    },
    {
      label: "an inactive asset",
      asset: { isActive: false },
    },
  ])("rejects $label for a published public request", async ({ asset }) => {
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getAssetByIdForRequest.mockResolvedValue({
      id: assetId,
      productId,
      kind: "cover",
      bucket: "public-media",
      path: `/api/media/${assetId}`,
      storagePath: `products/${productId}/cover/${assetId}-cover.jpg`,
      filename: "cover.jpg",
      contentType: "image/jpeg",
      isPublic: true,
      isActive: true,
      ...asset,
    });
    mocks.getProductByIdForRequest.mockResolvedValue({ id: productId, status: "published" });

    const response = await GET(new Request(`https://lamilialomi.com/api/media/${assetId}`), { params: Promise.resolve({ assetId }) });

    expect(response.status).toBe(404);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("passes a safe attachment filename for public downloads", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://project.storage.supabase.co/object/sign/public-media/file?token=short" },
      error: null,
    });
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getAssetByIdForRequest.mockResolvedValue({
      id: assetId,
      productId,
      kind: "public_download",
      bucket: "public-media",
      path: `/api/media/${assetId}`,
      storagePath: `products/${productId}/public_download/${assetId}-guide.pdf`,
      filename: '../../guide"\r\n.pdf',
      contentType: "application/pdf",
      isPublic: true,
      isActive: true,
    });
    mocks.getProductByIdForRequest.mockResolvedValue({ id: productId, status: "published" });
    mocks.createServiceRoleClient.mockReturnValue({
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    });

    const response = await GET(new Request(`https://lamilialomi.com/api/media/${assetId}?download=1`), { params: Promise.resolve({ assetId }) });

    expect(response.status).toBe(307);
    expect(createSignedUrl).toHaveBeenCalledWith(
      `products/${productId}/public_download/${assetId}-guide.pdf`,
      60,
      { download: "guide_.pdf" },
    );
  });

  it("converts thrown Storage failures into a sanitized temporary-unavailable response", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getAssetByIdForRequest.mockResolvedValue({
      id: assetId,
      productId,
      kind: "cover",
      bucket: "public-media",
      path: `/api/media/${assetId}`,
      storagePath: `products/${productId}/cover/${assetId}-cover.jpg`,
      filename: "cover.jpg",
      contentType: "image/jpeg",
      isPublic: true,
      isActive: true,
    });
    mocks.getProductByIdForRequest.mockResolvedValue({ id: productId, status: "published" });
    mocks.createServiceRoleClient.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: vi.fn().mockRejectedValue(new Error("network details must stay server-side")),
        })),
      },
    });

    const response = await GET(new Request(`https://lamilialomi.com/api/media/${assetId}`), { params: Promise.resolve({ assetId }) });

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Media temporarily unavailable");
    expect(consoleError).toHaveBeenCalledWith(
      "[public-media] Signed media URL generation failed.",
      expect.objectContaining({ assetId, bucket: "public-media", kind: "cover" }),
    );
    expect(consoleError.mock.calls[0]?.[1]).not.toHaveProperty("error");
    consoleError.mockRestore();
  });
});
