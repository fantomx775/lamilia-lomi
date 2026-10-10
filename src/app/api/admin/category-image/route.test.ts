import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasAdminAccess: vi.fn(),
  getDemoSession: vi.fn(),
  saveCategoryImageForRequest: vi.fn(),
  removeCategoryImageForRequest: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ hasAdminAccess: mocks.hasAdminAccess }));
vi.mock("@/lib/session.server", () => ({ getDemoSession: mocks.getDemoSession }));
vi.mock("@/lib/supabase-content-admin", () => ({
  saveCategoryImageForRequest: mocks.saveCategoryImageForRequest,
  removeCategoryImageForRequest: mocks.removeCategoryImageForRequest,
}));

import { DELETE, POST } from "./route";

const categoryId = "11111111-1111-4111-8111-111111111111";
const imageId = "22222222-2222-4222-8222-222222222222";

function png(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes.set([width >>> 24, width >>> 16, width >>> 8, width, height >>> 24, height >>> 16, height >>> 8, height], 16);
  return bytes;
}

describe("admin category image route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasAdminAccess.mockReturnValue(true);
    mocks.getDemoSession.mockResolvedValue({ role: "admin" });
    mocks.saveCategoryImageForRequest.mockResolvedValue({
      ok: true,
      id: categoryId,
      categoryImage: {
        id: imageId,
        path: `/api/category-media/${categoryId}?v=${imageId}`,
        storagePath: `categories/${categoryId}/image/${imageId}-books.png`,
        storageProvider: "supabase",
        filename: "books.png",
        contentType: "image/png",
        sizeBytes: 100,
      },
      cleanupDeferred: false,
    });
    mocks.removeCategoryImageForRequest.mockResolvedValue({ ok: true, id: categoryId, cleanupDeferred: false });
  });

  it("rejects a non-square category image before storing it", async () => {
    const form = new FormData();
    form.set("categoryId", categoryId);
    form.set("file", new File([png(600, 900)], "books.png", { type: "image/png" }));

    const response = await POST(new Request("http://localhost/api/admin/category-image", { method: "POST", body: form }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errorCode: "admin.validation.asset_file" });
    expect(mocks.saveCategoryImageForRequest).not.toHaveBeenCalled();
  });

  it("stores validated category images and returns the new media reference", async () => {
    const form = new FormData();
    form.set("categoryId", categoryId);
    form.set("file", new File([png(800, 800)], "books.png", { type: "image/png" }));

    const response = await POST(new Request("http://localhost/api/admin/category-image", { method: "POST", body: form }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ image: { id: imageId, storagePath: `categories/${categoryId}/image/${imageId}-books.png` } });
    expect(mocks.saveCategoryImageForRequest).toHaveBeenCalledWith(expect.objectContaining({
      categoryId,
      filename: "books.png",
      contentType: "image/png",
      bytes: expect.any(Uint8Array),
    }));
  });

  it("removes the category image through the admin persistence service", async () => {
    const response = await DELETE(new Request("http://localhost/api/admin/category-image", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, cleanupDeferred: false });
    expect(mocks.removeCategoryImageForRequest).toHaveBeenCalledWith(categoryId);
  });
});
