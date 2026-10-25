import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ backend: "local" as string, snapshot: { products: [] as Record<string, unknown>[] }, saved: vi.fn(), calls: [] as Array<{ method: string; args: unknown[] }> }));
vi.mock("server-only", () => ({}));
vi.mock("./config", () => ({ getBackendMode: () => mocks.backend }));
vi.mock("./content-store", () => ({ getContentSnapshot: () => structuredClone(mocks.snapshot), saveContentSnapshot: (value: unknown) => { mocks.snapshot = structuredClone(value) as typeof mocks.snapshot; mocks.saved(); } }));
vi.mock("./supabase/admin", () => ({ createServiceRoleClient: () => ({ from: (table: string) => { mocks.calls.push({ method: "from", args: [table] }); const chain = new Proxy({} as object, { get(_target, property) { if (property === "then") return (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve); return (...args: unknown[]) => { mocks.calls.push({ method: String(property), args }); return chain; }; } }); return chain; } }) }));

import { createReaderArtwork, deleteReaderArtwork, getReaderArtwork, listReaderArtworks, reorderReaderArtworks, updateReaderArtwork } from "./reader-artworks";

const productId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const entry = (id: string, owner: string, sortOrder: number) => ({ id, productId: owner, storagePath: `reader-artworks/${owner}/image/${id}-work.png`, storageProvider: "local" as const, filename: "work.png", contentType: "image/png" as const, sizeBytes: 10, displayName: id, sortOrder, isVisible: true, createdAt: "2026-01-01", updatedAt: "2026-01-01" });

describe("reader artwork repository", () => {
  beforeEach(() => {
    mocks.backend = "local"; mocks.saved.mockClear(); mocks.calls.length = 0;
    mocks.snapshot = { products: [
      { id: productId, status: "published", readerArtworks: [entry("art-1", productId, 0), entry("art-2", productId, 1), { ...entry("art-hidden", productId, 2), isVisible: false }] },
      { id: otherId, status: "draft", readerArtworks: [entry("other-art", otherId, 0)] },
    ] };
  });

  it("limits public reads to visible works on published products", async () => {
    await expect(listReaderArtworks(productId)).resolves.toHaveLength(2);
    await expect(listReaderArtworks(otherId)).resolves.toEqual([]);
    await expect(getReaderArtwork("art-hidden")).resolves.toBeNull();
    await expect(getReaderArtwork("other-art")).resolves.toBeNull();
    await expect(getReaderArtwork("art-hidden", true)).resolves.toMatchObject({ id: "art-hidden" });
  });

  it("persists create, edit, reorder, visibility and delete for only the owning product", async () => {
    await createReaderArtwork(entry("art-3", productId, 2));
    expect(mocks.saved).toHaveBeenCalledTimes(1);
    await updateReaderArtwork(productId, "art-3", { displayName: "Sunny", description: "A garden", isVisible: false });
    expect(await listReaderArtworks(productId, true)).toEqual(expect.arrayContaining([expect.objectContaining({ id: "art-3", displayName: "Sunny", description: "A garden", isVisible: false })]));
    expect(await reorderReaderArtworks(productId, ["art-2", "art-1", "art-3", "art-hidden"])).toBe(true);
    const reordered = await listReaderArtworks(productId, true);
    expect(reordered.map((item) => [item.id, item.sortOrder])).toEqual([["art-2", 0], ["art-1", 1], ["art-3", 2], ["art-hidden", 3]]);
    expect(await reorderReaderArtworks(productId, ["art-2", "other-art", "art-1", "art-3"])).toBe(false);
    expect(await deleteReaderArtwork(productId, "other-art")).toBe(false);
    expect((await listReaderArtworks(otherId, true))[0].id).toBe("other-art");
    expect(await deleteReaderArtwork(productId, "art-3")).toBe(true);
  });

  it("filters Supabase public reads by both visible artwork and published product", async () => {
    mocks.backend = "supabase";
    await expect(listReaderArtworks(productId)).resolves.toEqual([]);
    expect(mocks.calls).toContainEqual({ method: "select", args: [expect.stringContaining("products!product_reader_artworks_product_id_fkey!inner(status)")] });
    expect(mocks.calls).toContainEqual({ method: "eq", args: ["is_visible", true] });
    expect(mocks.calls).toContainEqual({ method: "eq", args: ["products.status", "published"] });
  });
});
