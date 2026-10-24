import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ artwork: null as { id: string; productId: string; storagePath: string; storageProvider: "local"; contentType: string } | null, status: "published", read: vi.fn(async () => new Uint8Array([1, 2, 3])) }));
vi.mock("@/lib/auth", () => ({ hasAdminAccess: () => false }));
vi.mock("@/lib/session.server", () => ({ getDemoSession: vi.fn(async () => null) }));
vi.mock("@/lib/config", () => ({ getBackendMode: () => "local" }));
vi.mock("@/lib/supabase/server", () => ({ getCurrentAccessToken: vi.fn(async () => null) }));
vi.mock("@/lib/reader-artworks", () => ({ getReaderArtwork: async () => mocks.artwork, getProductStatus: async () => mocks.status }));
vi.mock("@/lib/collection-image-storage", () => ({ readCollectionImage: mocks.read }));

import { GET } from "./route";

describe("public reader artwork proxy", () => {
  beforeEach(() => { mocks.artwork = { id: "public-id", productId: "product-id", storagePath: "reader-artworks/private-key/image/x.png", storageProvider: "local", contentType: "image/png" }; mocks.status = "published"; mocks.read.mockClear(); });
  it("streams bytes without exposing the private object key or redirecting", async () => {
    const response = await GET(new Request("http://local"), { params: Promise.resolve({ artworkId: "public-id" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await response.arrayBuffer()).toEqual(Uint8Array.from([1, 2, 3]).buffer);
  });
  it("hides artwork unless its product is published", async () => {
    mocks.status = "draft";
    expect((await GET(new Request("http://local"), { params: Promise.resolve({ artworkId: "public-id" }) })).status).toBe(404);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
