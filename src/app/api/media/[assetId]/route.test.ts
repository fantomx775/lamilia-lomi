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
});
