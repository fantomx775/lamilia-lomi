import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getBackendMode: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  getBackendMode: mocks.getBackendMode,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { getContentSnapshotForRequest } from "./content-repository";

describe("admin content premium code pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBackendMode.mockReturnValue("supabase");
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
});
