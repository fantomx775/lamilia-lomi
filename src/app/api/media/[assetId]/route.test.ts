import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAssetByIdForRequest: vi.fn(),
  getBackendMode: vi.fn(),
  getProductByIdForRequest: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/config", () => ({ getBackendMode: mocks.getBackendMode }));
vi.mock("@/lib/products-request", () => ({
  getAssetByIdForRequest: mocks.getAssetByIdForRequest,
  getProductByIdForRequest: mocks.getProductByIdForRequest,
}));
vi.mock("@/lib/supabase/admin", () => ({ createServiceRoleClient: mocks.createServiceRoleClient }));

import { GET } from "./route";

const productId = "11111111-1111-4111-8111-111111111111";
const assetId = "11111111-1111-4111-8111-111111111199";

describe("public media delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(consoleError).not.toHaveBeenCalled();
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
      filename: 'guide".pdf',
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
