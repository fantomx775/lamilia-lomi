import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({
  hasAdminAccess: vi.fn(),
  getBackendMode: vi.fn(),
  getDemoSession: vi.fn(),
  getCurrentAccessToken: vi.fn(),
  storeCollectionImage: vi.fn(),
  removeCollectionImage: vi.fn(),
  createSignedCollectionImageUrl: vi.fn(),
  readLocalCollectionImage: vi.fn(),
  getCollectionImageForRequest: vi.fn(),
  isCollectionImageReferencedForRequest: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ hasAdminAccess: mocks.hasAdminAccess }));
vi.mock("@/lib/config", () => ({ getBackendMode: mocks.getBackendMode }));
vi.mock("@/lib/session.server", () => ({ getDemoSession: mocks.getDemoSession }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentAccessToken: mocks.getCurrentAccessToken }));
vi.mock("@/lib/collection-image-storage", () => ({
  storeCollectionImage: mocks.storeCollectionImage,
  removeCollectionImage: mocks.removeCollectionImage,
  createSignedCollectionImageUrl: mocks.createSignedCollectionImageUrl,
  readLocalCollectionImage: mocks.readLocalCollectionImage,
}));
vi.mock("@/lib/content-repository", () => ({
  getCollectionImageForRequest: mocks.getCollectionImageForRequest,
  isCollectionImageReferencedForRequest: mocks.isCollectionImageReferencedForRequest,
}));

import { POST } from "./route";

const collectionId = "11111111-1111-4111-8111-111111111111";

describe("admin collection image route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasAdminAccess.mockReturnValue(true);
    mocks.getBackendMode.mockReturnValue("local");
    mocks.getDemoSession.mockResolvedValue({ role: "admin" });
    mocks.storeCollectionImage.mockResolvedValue({
      path: `collections/${collectionId}/image/22222222-2222-4222-8222-222222222222-cover.png`,
      provider: "local",
      filename: "cover.png",
    });
  });

  it("rejects bytes that claim to be an allowed image before storing", async () => {
    const form = new FormData();
    form.set("collectionId", collectionId);
    form.set("file", new File(["not a PNG"], "cover.png", { type: "image/png" }));

    const response = await POST(new Request("http://localhost/api/admin/collection-image", { method: "POST", body: form }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "admin.validation.collection_image" });
    expect(mocks.storeCollectionImage).not.toHaveBeenCalled();
  });

  it("stores a valid image whose detected format matches the declared type", async () => {
    const bytes = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 50, g: 60, b: 70 } },
    }).png().toBuffer();
    const form = new FormData();
    form.set("collectionId", collectionId);
    form.set("file", new File([bytes], "cover.png", { type: "image/png" }));

    const response = await POST(new Request("http://localhost/api/admin/collection-image", { method: "POST", body: form }));

    expect(response.status).toBe(200);
    expect(mocks.storeCollectionImage).toHaveBeenCalledWith(expect.objectContaining({
      collectionId,
      contentType: "image/png",
      bytes: expect.any(Uint8Array),
    }));
  });
});
