import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSignedMediaUpload: vi.fn(),
  getBackendMode: vi.fn(),
  getCurrentAccessToken: vi.fn(),
  getDemoSession: vi.fn(),
  storeMediaFile: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ hasAdminAccess: vi.fn(() => true) }));
vi.mock("@/lib/config", () => ({ getBackendMode: mocks.getBackendMode }));
vi.mock("@/lib/media-storage", () => ({
  createSignedMediaUpload: mocks.createSignedMediaUpload,
  removeUploadedMedia: vi.fn(),
  storeMediaFile: mocks.storeMediaFile,
}));
vi.mock("@/lib/session.server", () => ({ getDemoSession: mocks.getDemoSession }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentAccessToken: mocks.getCurrentAccessToken }));

import { POST } from "./route";

const productId = "11111111-1111-4111-8111-111111111111";

describe("admin media upload setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a scoped resumable target without parsing or buffering multipart data", async () => {
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getDemoSession.mockResolvedValue({ role: "admin" });
    mocks.getCurrentAccessToken.mockResolvedValue("admin-user-jwt");
    mocks.createSignedMediaUpload.mockResolvedValue({
      bucket: "public-videos",
      storagePath: `products/${productId}/video/11111111-1111-4111-8111-111111111199-preview.mp4`,
      publicPath: "unused",
      filename: "preview.mp4",
      uploadEndpoint: "https://project.storage.supabase.co/storage/v1/upload/resumable",
      uploadToken: "signed-token",
    });
    const request = new Request("https://lamilialomi.com/api/admin/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, kind: "video", filename: "preview.mp4", sizeBytes: 1024, contentType: "video/mp4" }),
    });
    const formData = vi.spyOn(request, "formData");

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(formData).not.toHaveBeenCalled();
    expect(payload.upload).toMatchObject({ token: "signed-token", bucket: "public-videos" });
    expect(payload.asset.uploaded).toBe(false);
    expect(mocks.createSignedMediaUpload).toHaveBeenCalledWith(expect.objectContaining({ authorizationToken: "admin-user-jwt" }));
  });

  it("rejects prototype names and SVG video metadata before issuing a target", async () => {
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getDemoSession.mockResolvedValue({ role: "admin" });
    const request = (kind: string, filename: string, contentType: string) => new Request("https://lamilialomi.com/api/admin/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, kind, filename, sizeBytes: 1024, contentType }),
    });

    expect((await POST(request("constructor", "x.mp4", "video/mp4"))).status).toBe(400);
    expect((await POST(request("video", "preview.svg", "image/svg+xml"))).status).toBe(400);
    expect(mocks.createSignedMediaUpload).not.toHaveBeenCalled();
  });

  it("keeps local mode on the multipart upload path", async () => {
    mocks.getBackendMode.mockReturnValue("local");
    mocks.getDemoSession.mockResolvedValue({ role: "admin" });
    mocks.storeMediaFile.mockResolvedValue({
      bucket: "public-media",
      storagePath: "/uploads/product-id/cover/cover.jpg",
      publicPath: "/uploads/product-id/cover/cover.jpg",
      filename: "cover.jpg",
    });
    const formData = new FormData();
    formData.append("productId", "product-id");
    formData.append("kind", "cover");
    formData.append("file", new File(["cover"], "cover.jpg", { type: "image/jpeg" }));

    const response = await POST(new Request("https://lamilialomi.com/api/admin/assets", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.asset).toMatchObject({ filename: "cover.jpg", uploaded: true });
    expect(mocks.storeMediaFile).toHaveBeenCalledWith(expect.objectContaining({ productId: "product-id", kind: "cover" }));
  });
});
