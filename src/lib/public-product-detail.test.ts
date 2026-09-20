import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  getBackendMode: vi.fn(),
  selectedColumns: "",
  filters: [] as Array<[string, unknown]>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config", () => ({ getBackendMode: mocks.getBackendMode }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { getLocalizedProductDetailViewForRequest } from "./products-request";

describe("targeted public product detail read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.selectedColumns = "";
    mocks.filters = [];

    const query = {
      select: vi.fn((columns: string) => {
        mocks.selectedColumns = columns;
        return query;
      }),
      eq: vi.fn((column: string, value: unknown) => {
        mocks.filters.push([column, value]);
        return query;
      }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "product-1",
          slug: "moon-garden-coloring-book",
          status: "published",
          audience: "adults",
          product_type: "coloring-book",
          cover_asset_id: "cover-1",
          video_asset_id: null,
          review_delay_days: 14,
          sort_order: 1,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
          product_translations: [
            {
              locale: "en",
              title: "Moon Garden",
              short_description: "A short description",
              long_description: "A longer description",
              seo_title: null,
              seo_description: null,
            },
          ],
          product_categories: [
            {
              category_id: "category-1",
              category: {
                id: "category-1",
                slug: "mindfulness",
                sort_order: 1,
                category_translations: [{ locale: "en", name: "Mindfulness" }],
              },
            },
          ],
          product_tags: [
            {
              tag_id: "tag-1",
              tag: {
                id: "tag-1",
                slug: "quiet-time",
                tag_translations: [{ locale: "en", name: "Quiet time" }],
              },
            },
          ],
          product_assets: [
            {
              id: "cover-1",
              product_id: "product-1",
              kind: "cover",
              bucket: "public-assets",
              path: "/assets/cover.png",
              filename: "cover.png",
              content_type: "image/png",
              size_bytes: 2048,
              locale: null,
              title: "Moon Garden cover",
              sort_order: 1,
              is_public: true,
              is_active: true,
            },
          ],
          amazon_links: [
            {
              id: "amazon-1",
              product_id: "product-1",
              market: "amazon.com",
              url: "https://www.amazon.com/dp/example",
              is_primary: true,
            },
          ],
        },
        error: null,
      }),
    };
    mocks.from.mockReturnValue(query);
    mocks.createClient.mockResolvedValue({ from: mocks.from });
  });

  it("loads one published product with only the fields and relations used by its page", async () => {
    const product = await getLocalizedProductDetailViewForRequest(
      "moon-garden-coloring-book",
      "en",
    );

    expect(product).toMatchObject({
      id: "product-1",
      title: "Moon Garden",
      cover: { id: "cover-1", path: "/assets/cover.png" },
      categories: [{ id: "category-1", name: "Mindfulness" }],
      tags: [{ id: "tag-1", name: "Quiet time" }],
      primaryAmazonLink: { id: "amazon-1", market: "amazon.com" },
    });
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith("products");
    expect(mocks.selectedColumns).toContain("product_translations");
    expect(mocks.selectedColumns).toContain("product_assets!product_assets_product_id_fkey");
    expect(mocks.selectedColumns).not.toContain("*");
    expect(mocks.selectedColumns).not.toContain("premium_codes");
    expect(mocks.selectedColumns).not.toContain("static_pages");
    expect(mocks.filters).toEqual([
      ["slug", "moon-garden-coloring-book"],
      ["status", "published"],
      ["product_assets.is_active", true],
    ]);
  });
});
