import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getBackendMode: vi.fn(),
  getAdminLayoutAccessForRequest: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  getBackendMode: mocks.getBackendMode,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/session.server", () => ({
  getAdminLayoutAccessForRequest: mocks.getAdminLayoutAccessForRequest,
}));

import { getContentSnapshotForRequest } from "./content-repository";

describe("admin content premium code pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getAdminLayoutAccessForRequest.mockResolvedValue({ preferredLocale: "en" });
  });

  it.each([
    { includePremiumCodes: true },
    { includeCollections: true },
    { includePremiumCodes: true, includeCollections: true },
  ])("does not start any snapshot queries before admin authorization: %j", async (options) => {
    mocks.getAdminLayoutAccessForRequest.mockResolvedValue(null);
    mocks.createClient.mockResolvedValue({
      from: () => { throw new Error("permission denied for table collections"); },
    });

    const snapshot = await getContentSnapshotForRequest(options);

    expect(snapshot).toMatchObject({
      products: [], collections: [], categories: [], tags: [], staticPages: [],
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("keeps public reads available without an admin session", async () => {
    mocks.getAdminLayoutAccessForRequest.mockResolvedValue(null);
    const from = vi.fn(() => ({ select: async () => ({ data: [], error: null }) }));
    mocks.createClient.mockResolvedValue({ from });

    await getContentSnapshotForRequest();

    expect(mocks.getAdminLayoutAccessForRequest).not.toHaveBeenCalled();
    expect(from.mock.calls.flat()).not.toContain("collections");
    expect(from.mock.calls.flat()).not.toContain("product_collections");
    expect(from.mock.calls.flat()).not.toContain("premium_codes");
  });

  it("loads every premium code beyond the PostgREST row cap in stable id order", async () => {
    const productId = "11111111-1111-4111-8111-111111111111";
    const premiumCodes = Array.from({ length: 1_001 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      product_id: productId,
      code: `LL-${index}`,
      active: true,
      created_at: "2026-10-11T00:00:00.000Z",
      redeemed_at: null,
      redeemed_by: null,
    }));
    const pageRequests: Array<{ cursor?: string; limit: number }> = [];
    const productRow = {
      id: productId,
      slug: "moon-garden-coloring-book",
      status: "published",
      audience: "kids",
      product_type: "coloring-book",
      cover_asset_id: "",
      video_asset_id: null,
      review_delay_days: 14,
      sort_order: 1,
      created_at: "2026-10-11T00:00:00.000Z",
      updated_at: "2026-10-11T00:00:00.000Z",
    };

    mocks.createClient.mockResolvedValue({
      from: (table: string) => {
        if (table !== "premium_codes") {
          return {
            select: async () => ({
              data: table === "products" ? [productRow] : [],
              error: null,
            }),
          };
        }

        return {
          select: () => ({
            order: (column: string, options: { ascending: boolean }) => {
              expect(column).toBe("id");
              expect(options).toEqual({ ascending: true });
              return {
                gt: (cursorColumn: string, cursor: string) => {
                  expect(cursorColumn).toBe("id");
                  return {
                    limit: async (limit: number) => {
                      pageRequests.push({ cursor, limit });
                      const start = premiumCodes.findIndex((row) => row.id > cursor);
                      return {
                        data: start < 0 ? [] : premiumCodes.slice(start, start + limit),
                        error: null,
                      };
                    },
                  };
                },
                limit: async (limit: number) => {
                  pageRequests.push({ limit });
                  return { data: premiumCodes.slice(0, limit), error: null };
                },
              };
            },
          }),
        };
      },
    });

    const snapshot = await getContentSnapshotForRequest({ includePremiumCodes: true });

    expect(snapshot.products[0]?.premiumCodes).toHaveLength(1_001);
    expect(snapshot.products[0]?.premiumCodes[1_000]?.code).toBe("LL-1000");
    expect(pageRequests).toEqual([
      { limit: 1_000 },
      { cursor: premiumCodes[999]?.id, limit: 1_000 },
    ]);
  });

  it("loads every product for admin collection counts beyond the PostgREST row cap", async () => {
    const collectionId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    const products = Array.from({ length: 1_001 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      slug: `product-${index}`,
      status: "draft",
      audience: "kids",
      product_type: "coloring-book",
      cover_asset_id: "",
      video_asset_id: null,
      review_delay_days: 14,
      sort_order: index,
      created_at: "2026-10-11T00:00:00.000Z",
      updated_at: "2026-10-11T00:00:00.000Z",
    }));
    const productCollections = products.map((product, index) => ({
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      product_id: product.id,
      collection_id: collectionId,
    }));
    const pageRequests: Array<{ table: string; cursor?: string; limit: number }> = [];
    const collectionRow = {
      id: collectionId,
      name: "Forest stories",
      slug: "forest-stories",
      image_path: null,
      image_storage_provider: null,
      image_filename: null,
      image_content_type: null,
      image_size_bytes: null,
      sort_order: 100,
      created_at: "2026-10-11T00:00:00.000Z",
      updated_at: "2026-10-11T00:00:00.000Z",
    };

    mocks.createClient.mockResolvedValue({
      from: (table: string) => {
        if (table !== "products" && table !== "product_collections") {
          return {
            select: async () => ({
              data: table === "collections" ? [collectionRow] : [],
              error: null,
            }),
          };
        }

        const rows = table === "products" ? products : productCollections;
        return {
          select: () => ({
            order: (column: string, options: { ascending: boolean }) => {
              expect(column).toBe("id");
              expect(options).toEqual({ ascending: true });
              return {
                gt: (cursorColumn: string, cursor: string) => {
                  expect(cursorColumn).toBe("id");
                  return {
                    limit: async (limit: number) => {
                      pageRequests.push({ table, cursor, limit });
                      const start = rows.findIndex((row) => row.id > cursor);
                      return {
                        data: start < 0 ? [] : rows.slice(start, start + limit),
                        error: null,
                      };
                    },
                  };
                },
                limit: async (limit: number) => {
                  pageRequests.push({ table, limit });
                  return { data: rows.slice(0, limit), error: null };
                },
              };
            },
          }),
        };
      },
    });

    const snapshot = await getContentSnapshotForRequest({ includeCollections: true });

    expect(snapshot.products).toHaveLength(1_001);
    expect(snapshot.products.every((product) => product.collectionId === collectionId)).toBe(true);
    expect(pageRequests.filter((request) => request.table === "products")).toEqual([
      { table: "products", limit: 1_000 },
      { table: "products", cursor: products[999]?.id, limit: 1_000 },
    ]);
    expect(pageRequests.filter((request) => request.table === "product_collections")).toEqual([
      { table: "product_collections", limit: 1_000 },
      { table: "product_collections", cursor: productCollections[999]?.id, limit: 1_000 },
    ]);
  });
});
