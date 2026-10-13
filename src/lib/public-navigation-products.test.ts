import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  getBackendMode: vi.fn(),
  rows: {} as Record<string, unknown[]>,
  singleRows: {} as Record<string, unknown>,
  queries: [] as Array<{
    table: string;
    columns: string;
    filters: Array<[string, unknown]>;
  }>,
  requestCaches: [] as Array<Map<string, unknown>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({
  cache: (fn: (...args: unknown[]) => unknown) => {
    const entries = new Map<string, unknown>();
    mocks.requestCaches.push(entries);

    return (...args: unknown[]) => {
      const key = JSON.stringify(args);

      if (!entries.has(key)) {
        entries.set(key, fn(...args));
      }

      return entries.get(key);
    };
  },
}));
vi.mock("@/lib/config", () => ({ getBackendMode: mocks.getBackendMode }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import {
  getPublicCatalogSnapshotForRequest,
} from "./content-repository";
import {
  getCatalogProductsForRequest,
  getFeaturedProductsForRequest,
} from "./products-request";

describe("targeted Home and Catalog product reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://media.example.com");
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.queries.length = 0;
    for (const requestCache of mocks.requestCaches) {
      requestCache.clear();
    }
    mocks.rows = {
      products: [
        productRow({
          id: "product-moon",
          slug: "moon-garden-coloring-book",
          audience: "adults",
          title: "Moon Garden",
          reviewDelayDays: 14,
          sortOrder: 2,
          createdAt: "2026-10-01T00:00:00.000Z",
          categoryId: "11111111-1111-4111-8111-111111111111",
          tagId: "tag-calm",
          coverId: "cover-moon",
        }),
        productRow({
          id: "product-forest",
          slug: "forest-story-coloring-book",
          audience: "kids",
          title: "Forest Story",
          reviewDelayDays: 10,
          sortOrder: 1,
          createdAt: "2026-10-02T00:00:00.000Z",
          categoryId: "33333333-3333-4333-8333-333333333333",
          tagId: "tag-forest",
          coverId: "cover-forest",
        }),
        productRow({
          id: "product-quiet",
          slug: "quiet-desk-coloring-book",
          audience: "adults",
          title: "Quiet Desk",
          reviewDelayDays: 7,
          sortOrder: 3,
          createdAt: "2026-09-15T00:00:00.000Z",
          categoryId: "11111111-1111-4111-8111-111111111111",
          tagId: "tag-calm",
          coverId: "cover-quiet",
        }),
      ],
      categories: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          slug: "mindfulness",
          sort_order: 1,
          image_asset_id: "22222222-2222-4222-8222-222222222222",
          image_storage_path:
            "categories/11111111-1111-4111-8111-111111111111/image/22222222-2222-4222-8222-222222222222-mindfulness.png",
          image_storage_provider: "r2_public",
          image_filename: "mindfulness.png",
          image_content_type: "image/png",
          image_size_bytes: 1024,
          category_translations: [{ locale: "en", name: "Mindfulness", description: null }],
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          slug: "kids",
          sort_order: 2,
          category_translations: [{ locale: "en", name: "Kids", description: null }],
        },
      ],
      tags: [
        {
          id: "tag-calm",
          slug: "calm",
          tag_translations: [{ locale: "en", name: "Calm" }],
        },
        {
          id: "tag-forest",
          slug: "forest",
          tag_translations: [{ locale: "en", name: "Forest" }],
        },
      ],
      catalog_settings: [{ desktop_columns: 5 }],
    };
    mocks.singleRows = { catalog_settings: { desktop_columns: 5 } };
    mocks.from.mockImplementation((table: string) => {
      const queryRecord = { table, columns: "", filters: [] as Array<[string, unknown]> };
      mocks.queries.push(queryRecord);
      const result = { data: mocks.rows[table] ?? [], error: null };
      const query = {
        select(columns: string) {
          queryRecord.columns = columns;
          return query;
        },
        eq(column: string, value: unknown) {
          queryRecord.filters.push([column, value]);
          return query;
        },
        maybeSingle: vi.fn().mockResolvedValue({
          data: mocks.singleRows[table] ?? null,
          error: null,
        }),
        then(
          onFulfilled: (value: typeof result) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      };

      return query;
    });
    mocks.createClient.mockResolvedValue({ from: mocks.from });
  });

  it("loads Home cards from one localized products-and-covers query", async () => {
    const [kids, adults, featured] = await Promise.all([
      getFeaturedProductsForRequest("en", "kids"),
      getFeaturedProductsForRequest("en", "adults"),
      getFeaturedProductsForRequest("en"),
    ]);

    expect(kids.map((product) => product.slug)).toEqual([
      "forest-story-coloring-book",
    ]);
    expect(adults.map((product) => product.slug)).toEqual([
      "quiet-desk-coloring-book",
      "moon-garden-coloring-book",
    ]);
    expect(featured.map((product) => product.slug)).toEqual([
      "quiet-desk-coloring-book",
      "forest-story-coloring-book",
      "moon-garden-coloring-book",
    ]);
    expect(mocks.queries.map((query) => query.table)).toEqual(["products"]);

    const [productQuery] = mocks.queries;
    expect(productQuery.columns).toContain(
      "product_translations!inner ( locale, title, short_description )",
    );
    expect(productQuery.columns).toContain("product_assets!product_assets_product_id_fkey");
    expect(productQuery.columns).not.toContain("product_categories");
    expect(productQuery.columns).not.toContain("product_tags");
    expect(productQuery.columns).not.toContain("amazon_links");
    expect(productQuery.columns).not.toContain("static_pages");
    expect(productQuery.columns).not.toContain("*");
    expect(productQuery.filters).toEqual([
      ["status", "published"],
      ["product_translations.locale", "en"],
      ["product_assets.is_active", true],
      ["product_assets.kind", "cover"],
    ]);
  });

  it("loads Catalog products and taxonomy with four explicit reads", async () => {
    const snapshot = await getPublicCatalogSnapshotForRequest("en");
    const products = await getCatalogProductsForRequest("en", {
      q: "Moon",
      audience: "adults",
      productType: "coloring-book",
      category: "mindfulness",
      tag: "calm",
      sort: "newest",
    });

    expect(snapshot.catalogSettings.desktopColumns).toBe(5);
    expect(
      snapshot.categories.map((category) => category.translations[0]?.name).sort(),
    ).toEqual([
      "Kids",
      "Mindfulness",
    ]);
    expect(
      snapshot.categories.find((category) => category.slug === "mindfulness")?.image
        ?.path,
    ).toBe(
      "https://media.example.com/categories/11111111-1111-4111-8111-111111111111/image/22222222-2222-4222-8222-222222222222-mindfulness.png",
    );
    expect(snapshot.tags.map((tag) => tag.translations[0]?.name).sort()).toEqual([
      "Calm",
      "Forest",
    ]);
    expect(products.map((product) => product.slug)).toEqual([
      "moon-garden-coloring-book",
    ]);
    expect(products[0]).toMatchObject({
      title: "Moon Garden",
      cover: {
        path: "https://media.example.com/products/product-moon/cover/cover-moon.png",
      },
      categories: [{ slug: "mindfulness", name: "Mindfulness" }],
      tags: [{ slug: "calm", name: "Calm" }],
    });
    expect(mocks.queries.map((query) => query.table).sort()).toEqual([
      "catalog_settings",
      "categories",
      "products",
      "tags",
    ]);

    const productQuery = mocks.queries.find((query) => query.table === "products");
    expect(productQuery?.columns).toContain("product_categories ( category_id )");
    expect(productQuery?.columns).toContain("product_tags ( tag_id )");
    expect(productQuery?.columns).toContain("product_translations!inner");
    expect(productQuery?.columns).toContain("long_description");
    expect(productQuery?.columns).not.toContain("amazon_links");
    expect(productQuery?.columns).not.toContain("premium_codes");
    expect(productQuery?.columns).not.toContain("static_pages");
    expect(productQuery?.columns).not.toContain("*");
    expect(productQuery?.filters).toContainEqual(["status", "published"]);
    expect(productQuery?.filters).toContainEqual([
      "product_assets.kind",
      "cover",
    ]);

    const settingsQuery = mocks.queries.find(
      (query) => query.table === "catalog_settings",
    );
    expect(settingsQuery?.columns).toBe("desktop_columns");
    expect(
      mocks.queries.find((query) => query.table === "categories")?.columns,
    ).toContain("category_translations!inner");
    expect(
      mocks.queries.find((query) => query.table === "tags")?.columns,
    ).toContain("tag_translations!inner");
  });
});

function productRow({
  id,
  slug,
  audience,
  title,
  reviewDelayDays,
  sortOrder,
  createdAt,
  categoryId,
  tagId,
  coverId,
}: {
  id: string;
  slug: string;
  audience: "kids" | "adults";
  title: string;
  reviewDelayDays: number;
  sortOrder: number;
  createdAt: string;
  categoryId: string;
  tagId: string;
  coverId: string;
}) {
  return {
    id,
    slug,
    status: "published",
    audience,
    product_type: "coloring-book",
    cover_asset_id: coverId,
    review_delay_days: reviewDelayDays,
    sort_order: sortOrder,
    created_at: createdAt,
    product_translations: [
      {
        locale: "en",
        title,
        short_description: `${title} is a calm book`,
        long_description: "A coloring book with mindfulness themes.",
        seo_title: null,
        seo_description: null,
      },
    ],
    product_categories: [{ category_id: categoryId }],
    product_tags: [{ tag_id: tagId }],
    product_assets: [
      {
        id: coverId,
        product_id: id,
        kind: "cover",
        bucket: "public-assets",
        path: `products/${id}/cover/${coverId}.png`,
        storage_provider: "r2_public",
        filename: `${coverId}.png`,
        content_type: "image/png",
        size_bytes: 1024,
        locale: null,
        title: `${title} cover`,
        sort_order: 1,
        is_public: true,
        is_active: true,
      },
    ],
  };
}
