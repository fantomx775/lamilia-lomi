import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSignedMediaUpload: vi.fn(),
  getBackendMode: vi.fn(),
  getCurrentAccessToken: vi.fn(),
  getMediaUploadProvider: vi.fn(),
  createSignedR2Upload: vi.fn(),
  getDemoSession: vi.fn(),
  removeUploadedMedia: vi.fn(),
  storeMediaFile: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ hasAdminAccess: vi.fn(() => true) }));
vi.mock("@/lib/config", () => ({ getBackendMode: mocks.getBackendMode }));
vi.mock("@/lib/media-r2-config", () => ({ getMediaUploadProvider: mocks.getMediaUploadProvider }));
vi.mock("@/lib/media-r2", () => ({ createSignedR2Upload: mocks.createSignedR2Upload }));
vi.mock("@/lib/media-storage", () => ({
  createSignedMediaUpload: mocks.createSignedMediaUpload,
  removeUploadedMedia: mocks.removeUploadedMedia,
  storeMediaFile: mocks.storeMediaFile,
}));
vi.mock("@/lib/session.server", () => ({ getDemoSession: mocks.getDemoSession }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentAccessToken: mocks.getCurrentAccessToken }));

import { DELETE, POST } from "./route";
import { ADMIN_ERROR_CODES } from "@/lib/admin-errors";

const productId = "11111111-1111-4111-8111-111111111111";

describe("admin media upload setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMediaUploadProvider.mockReturnValue("supabase");
  });

  it("prepares a private R2 upload and a Supabase rollback mirror for cover images", async () => {
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getMediaUploadProvider.mockReturnValue("r2");
    mocks.getDemoSession.mockResolvedValue({ role: "admin" });
    mocks.getCurrentAccessToken.mockResolvedValue("admin-user-jwt");
    mocks.createSignedMediaUpload.mockResolvedValue({
      bucket: "public-media",
      storagePath: `products/${productId}/cover/11111111-1111-4111-8111-111111111199-cover.jpg`,
      publicPath: "unused",
      filename: "cover.jpg",
      uploadEndpoint: "https://project.storage.supabase.co/storage/v1/upload/resumable",
      uploadToken: "signed-token",
    });
    mocks.createSignedR2Upload.mockResolvedValue({
      url: "https://r2.example/upload",
      headers: { "Content-Type": "image/jpeg" },
      storagePath: `products/${productId}/cover/11111111-1111-4111-8111-111111111199-cover.jpg`,
      stagingPath: `staging/products/${productId}/cover/11111111-1111-4111-8111-111111111199-cover.jpg`,
    });

    const response = await POST(new Request("https://lamilialomi.com/api/admin/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, kind: "cover", filename: "cover.jpg", sizeBytes: 1024, contentType: "image/jpeg" }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.asset).toMatchObject({ storageProvider: "r2_private", path: expect.stringMatching(/^\/api\/media\//) });
    expect(payload.upload).toMatchObject({
      driver: "r2-mirrored",
      r2: { url: "https://r2.example/upload" },
      supabase: { driver: "supabase-tus", token: "signed-token" },
    });
    expect(mocks.createSignedR2Upload).toHaveBeenCalledWith(expect.objectContaining({
      productId,
      kind: "cover",
      sizeBytes: 1024,
    }));
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
      body: JSON.stringify({ productId, kind: "video", filename: "preview.mp4", sizeBytes: 1024, contentType: "video/mp4", locale: "pl" }),
    });
    const formData = vi.spyOn(request, "formData");

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(formData).not.toHaveBeenCalled();
    expect(payload.upload).toMatchObject({ token: "signed-token", bucket: "public-videos" });
    expect(payload.asset).toMatchObject({ uploaded: false, locale: "en" });
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
    formData.append("locale", "pl");
    formData.append("file", new File(["cover"], "cover.jpg", { type: "image/jpeg" }));

    const response = await POST(new Request("https://lamilialomi.com/api/admin/assets", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.asset).toMatchObject({ filename: "cover.jpg", uploaded: true, locale: "en" });
    expect(mocks.storeMediaFile).toHaveBeenCalledWith(expect.objectContaining({ productId: "product-id", kind: "cover" }));
  });

  it("defers cloud media cleanup in the private-serving revocation state", async () => {
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getDemoSession.mockResolvedValue({ role: "admin" });
    mocks.getCurrentAccessToken.mockResolvedValue("admin-user-jwt");
    mocks.removeUploadedMedia.mockResolvedValue(false);

    const response = await DELETE(new Request("https://lamilialomi.com/api/admin/assets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId,
        kind: "cover",
        storagePath: `products/${productId}/cover/asset.jpg`,
        storageProvider: "r2_public_revoking",
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, cleanupDeferred: true });
    expect(mocks.removeUploadedMedia).toHaveBeenCalledWith(expect.objectContaining({
      productId,
      kind: "cover",
      storageProvider: "r2_public_revoking",
      authorizationToken: "admin-user-jwt",
    }));
    expect(mocks.removeUploadedMedia.mock.calls[0][0]).not.toHaveProperty("preservePersistedReferences");
  });

  it("does not expose Storage implementation errors from the setup endpoint", async () => {
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getDemoSession.mockResolvedValue({ role: "admin" });
    mocks.getCurrentAccessToken.mockResolvedValue("admin-user-jwt");
    mocks.createSignedMediaUpload.mockRejectedValue(
      new Error(`Invalid key: products/${productId}/gallery/Zdjęcie cyfrowe 1.webp`),
    );

    const response = await POST(new Request("https://lamilialomi.com/api/admin/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, kind: "gallery", filename: "Zdjęcie cyfrowe 1.webp", sizeBytes: 1024, contentType: "image/webp" }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe("Nie udało się przygotować przesyłania pliku. Spróbuj ponownie.");
    expect(payload.errorCode).toBe(ADMIN_ERROR_CODES.INTERNAL);
    expect(payload.error).not.toContain("Invalid key");
  });
});
