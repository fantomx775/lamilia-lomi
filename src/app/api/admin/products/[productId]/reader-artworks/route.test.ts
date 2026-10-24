import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: false, status: "published", store: vi.fn(), create: vi.fn(), artworks: [] as Array<{ id: string; productId: string; storagePath: string; storageProvider: "local"; displayName: string; filename: string; contentType: "image/png"; sizeBytes: number; sortOrder: number; isVisible: boolean; createdAt: string; updatedAt: string }>, remove: vi.fn(), deleteArtwork: vi.fn() }));
vi.mock("@/lib/auth", () => ({ hasAdminAccess: () => mocks.admin }));
vi.mock("@/lib/session.server", () => ({ getDemoSession: vi.fn(async () => ({})) }));
vi.mock("@/lib/config", () => ({ getBackendMode: () => "local" }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentAccessToken: vi.fn(async () => null) }));
vi.mock("@/lib/reader-artworks", () => ({ getProductStatus: async () => mocks.status, listReaderArtworks: async () => mocks.artworks, createReaderArtwork: mocks.create, updateReaderArtwork: vi.fn(), reorderReaderArtworks: vi.fn(), deleteReaderArtwork: mocks.deleteArtwork }));
vi.mock("@/lib/collection-image-storage", () => ({ storeCollectionImage: mocks.store, removeCollectionImage: mocks.remove, createSignedCollectionImageUrl: vi.fn(), readLocalCollectionImage: vi.fn() }));
vi.mock("@/lib/collection-image-validation", () => ({ hasValidCollectionImageContent: vi.fn(async () => true) }));

import { GET, POST } from "./route";

describe("reader artwork admin API", () => {
  beforeEach(() => { mocks.admin = false; mocks.status = "published"; mocks.store.mockReset(); mocks.create.mockReset(); mocks.remove.mockReset(); mocks.deleteArtwork.mockReset(); mocks.artworks = []; });
  const context = { params: Promise.resolve({ productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) };

  it("denies unauthenticated reads and uploads", async () => {
    expect((await GET(new Request("http://local"), context)).status).toBe(403);
    const form = new FormData();
    expect((await POST(new Request("http://local", { method: "POST", body: form }), context)).status).toBe(403);
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("rejects a missing nickname before storing an otherwise valid image", async () => {
    mocks.admin = true;
    const form = new FormData(); form.set("file", new File([new Uint8Array([1])], "work.png", { type: "image/png" }));
    expect((await POST(new Request("http://local", { method: "POST", body: form }), context)).status).toBe(400);
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("rejects uploads when the product no longer exists", async () => {
    mocks.admin = true; mocks.status = "missing";
    const form = new FormData(); form.set("file", new File([new Uint8Array([1])], "work.png", { type: "image/png" })); form.set("displayName", "Sunny");
    expect((await POST(new Request("http://local", { method: "POST", body: form }), context)).status).toBe(404);
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("keeps the metadata pointer when storage cleanup fails", async () => {
    mocks.admin = true;
    mocks.artworks = [{ id: "art-1", productId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", storagePath: "reader-artworks/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/image/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb-work.png", storageProvider: "local", filename: "work.png", contentType: "image/png", sizeBytes: 12, displayName: "Sunny", sortOrder: 0, isVisible: true, createdAt: "2026-01-01", updatedAt: "2026-01-01" }];
    mocks.remove.mockRejectedValue(new Error("storage unavailable"));
    const response = await (await import("./route")).DELETE(new Request("http://local", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "art-1" }) }), context);
    expect(response.status).toBe(500);
    expect(mocks.deleteArtwork).not.toHaveBeenCalled();
  });
});
