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
    gtFilters: Array<[string, unknown]>;
    inFilters: Array<[string, unknown[]]>;
    orders: Array<{ column: string; ascending: boolean }>;
    limit?: number;
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
  getPublicHomeProductSnapshotForRequest,
} from "./content-repository";
import {
  getCatalogProductsForRequest,
  getFeaturedProductsForRequest,
} from "./products-request";
import {
  getFeaturedProductsFromSnapshot,
  getPublishedProductViewsFromSnapshot,
} from "./products";
import { sortFeaturedProductCandidates } from "./featured-product-ranking";
import type { ContentSnapshot, Product } from "./types";

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
      const queryRecord = {
        table,
        columns: "",
        filters: [] as Array<[string, unknown]>,
        gtFilters: [] as Array<[string, unknown]>,
        inFilters: [] as Array<[string, unknown[]]>,
        orders: [] as Array<{ column: string; ascending: boolean }>,
        limit: undefined as number | undefined,
      };
      mocks.queries.push(queryRecord);

      const readRows = () => {
        let result = (mocks.rows[table] ?? [])
          .filter(isRecord)
          .map((row) => ({ ...row }));
        const relationNames = new Set(
          queryRecord.filters
            .filter(([column]) => column.includes("."))
            .map(([column]) => column.split(".")[0])
            .filter((name) => name !== undefined && name !== ""),
        );

        for (const relation of relationNames) {
          const relationFilters = queryRecord.filters.filter(([column]) =>
            column.startsWith(relation + "."),
          );
          result = result.map((row) => {
            const children = Array.isArray(row[relation])
              ? row[relation].filter(isRecord)
              : [];
            return {
              ...row,
              [relation]: children.filter((child) =>
                relationFilters.every(([column, value]) =>
                  child[column.slice(relation.length + 1)] === value,
                ),
              ),
            };
          });

          if (relation === "product_translations") {
            result = result.filter(
              (row) => (row[relation] as unknown[]).length > 0,
            );
          }
        }

        result = result.filter((row) =>
          queryRecord.filters
            .filter(([column]) => !column.includes("."))
            .every(([column, value]) => row[column] === value),
        );
        result = result.filter((row) =>
          queryRecord.gtFilters.every(([column, value]) =>
            typeof row[column] === "string" &&
            typeof value === "string" &&
            row[column] > value,
          ),
        );
        result = result.filter((row) =>
          queryRecord.inFilters.every(([column, values]) =>
            values.includes(row[column]),
          ),
        );

        // PostgREST does not guarantee the order of rows selected by `in`.
        if (queryRecord.inFilters.length > 0) {
          result.reverse();
        }

        for (const { column, ascending } of queryRecord.orders) {
          result.sort((left, right) => {
            const leftValue = left[column];
            const rightValue = right[column];
            const comparison =
              typeof leftValue === "number" && typeof rightValue === "number"
                ? leftValue - rightValue
                : String(leftValue ?? "") < String(rightValue ?? "")
                  ? -1
                  : String(leftValue ?? "") > String(rightValue ?? "")
                    ? 1
                    : 0;
            return ascending ? comparison : -comparison;
          });
        }

        return queryRecord.limit === undefined
          ? result
          : result.slice(0, queryRecord.limit);
      };
      const query = {
        select(columns: string) {
          queryRecord.columns = columns;
          return query;
        },
        eq(column: string, value: unknown) {
          queryRecord.filters.push([column, value]);
          return query;
        },
        gt(column: string, value: unknown) {
          queryRecord.gtFilters.push([column, value]);
          return query;
        },
        in(column: string, values: unknown[]) {
          queryRecord.inFilters.push([column, values]);
          return query;
        },
        order(column: string, options?: { ascending?: boolean }) {
          queryRecord.orders.push({
            column,
            ascending: options?.ascending ?? true,
          });
          return query;
        },
        limit(value: number) {
          queryRecord.limit = value;
          return query;
        },
        maybeSingle: vi.fn().mockResolvedValue({
          data: mocks.singleRows[table] ?? null,
          error: null,
        }),
        then(
          onFulfilled: (value: { data: unknown[]; error: null }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve({ data: readRows(), error: null }).then(
            onFulfilled,
            onRejected,
          );
        },
      };

      return query;
    });
    mocks.createClient.mockResolvedValue({ from: mocks.from });
  });

  it("loads bounded ranking rows then localized product details for Home cards", async () => {
    const snapshot = await getPublicHomeProductSnapshotForRequest("en");
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
    expect(snapshot.collections).toEqual([]);
    const productQueries = mocks.queries.filter((query) => query.table === "products");
    expect(productQueries).toHaveLength(4);
    const rankingQueries = productQueries.filter(
      (query) => !query.columns.includes("product_assets"),
    );
    const detailQueries = productQueries.filter((query) =>
      query.columns.includes("product_assets"),
    );
    expect(rankingQueries).toHaveLength(2);
    expect(detailQueries).toHaveLength(2);
    expect(
      rankingQueries.map(
        (query) => query.filters.find(([column]) => column === "audience")?.[1],
      ),
    ).toEqual(["kids", "adults"]);

    for (const rankingQuery of rankingQueries) {
      expect(rankingQuery.columns).toContain("id");
      expect(rankingQuery.columns).toContain("audience");
      expect(rankingQuery.columns).toContain("review_delay_days");
      expect(rankingQuery.columns).toContain(
        "product_translations!inner ( locale, title )",
      );
      expect(rankingQuery.columns).not.toContain("product_assets");
      expect(rankingQuery.columns).not.toContain("product_categories");
      expect(rankingQuery.columns).not.toContain("*");
      expect(rankingQuery.filters).toEqual([
        ["status", "published"],
        ["product_translations.locale", "en"],
        ["audience", rankingQuery.filters[2]?.[1]],
      ]);
      expect(["kids", "adults"]).toContain(rankingQuery.filters[2]?.[1]);
      expect(rankingQuery.orders).toEqual([
        { column: "review_delay_days", ascending: true },
      ]);
      expect(rankingQuery.limit).toBe(5);
      expect(rankingQuery.inFilters).toEqual([]);
    }

    for (const detailQuery of detailQueries) {
      expect(detailQuery.columns).toContain(
        "product_translations!inner ( locale, title, short_description )",
      );
      expect(detailQuery.columns).toContain(
        "product_assets!product_assets_product_id_fkey",
      );
      expect(detailQuery.columns).not.toContain("product_categories");
      expect(detailQuery.columns).not.toContain("product_tags");
      expect(detailQuery.columns).not.toContain("amazon_links");
      expect(detailQuery.columns).not.toContain("static_pages");
      expect(detailQuery.columns).not.toContain("*");
      expect(detailQuery.filters.slice(0, 4)).toEqual([
        ["status", "published"],
        ["product_translations.locale", "en"],
        ["product_assets.is_active", true],
        ["product_assets.kind", "cover"],
      ]);
      const audience = detailQuery.filters.find(
        ([column]) => column === "audience",
      )?.[1];
      expect(["kids", "adults"]).toContain(audience);
      expect(detailQuery.filters[4]).toEqual(["audience", audience]);
      expect(detailQuery.inFilters).toHaveLength(1);
      expect(detailQuery.inFilters[0]?.[0]).toBe("id");
      expect(detailQuery.inFilters[0]?.[1].sort()).toEqual(
        audience === "kids"
          ? ["product-forest"]
          : ["product-moon", "product-quiet"].sort(),
      );
      expect(detailQuery.limit).toBeUndefined();
      expect(detailQuery.orders).toEqual([]);
    }
  });

  it("matches full Home selections and pages every row in a tied cutoff group", async () => {
    const noCover = productRow({
      id: "kid-no-cover",
      slug: "kid-no-cover",
      audience: "kids",
      title: "No Cover",
      reviewDelayDays: 1,
      sortOrder: 1,
      createdAt: "2026-10-01T00:00:00.000Z",
      categoryId: "category-kids",
      tagId: "tag-kids",
      coverId: "cover-kid-no-cover",
    });
    noCover.product_assets = [];
    const kids = [
      noCover,
      ...[2].map((reviewDelayDays, index) =>
        productRow({
          id: "kid-earlier-" + index,
          slug: "kid-earlier-" + index,
          audience: "kids",
          title: "Earlier " + index,
          reviewDelayDays,
          sortOrder: index,
          createdAt: "2026-10-01T00:00:00.000Z",
          categoryId: "category-kids",
          tagId: "tag-kids",
          coverId: "cover-kid-earlier-" + index,
        }),
      ),
      ...Array.from({ length: 1_001 }, (_, index) =>
        productRow({
          id: "kid-boundary-" + String(index).padStart(4, "0"),
          slug: "kid-boundary-" + index,
          audience: "kids",
          title: "Boundary Product",
          reviewDelayDays: 4,
          sortOrder: index,
          createdAt: "2026-10-01T00:00:00.000Z",
          categoryId: "category-kids",
          tagId: "tag-kids",
          coverId: "cover-kid-boundary-" + index,
        }),
      ),
    ];
    const adults = Array.from({ length: 6 }, (_, index) =>
      productRow({
        id: "adult-" + index,
        slug: "adult-" + index,
        audience: "adults",
        title: "Adult " + index,
        reviewDelayDays: index + 20,
        sortOrder: index,
        createdAt: "2026-10-01T00:00:00.000Z",
        categoryId: "category-adults",
        tagId: "tag-adults",
        coverId: "cover-adult-" + index,
      }),
    );
    const wrongLocale = productRow({
      id: "wrong-locale",
      slug: "wrong-locale",
      audience: "kids",
      title: "Wrong locale",
      reviewDelayDays: 1,
      sortOrder: 1,
      createdAt: "2026-10-01T00:00:00.000Z",
      categoryId: "category-kids",
      tagId: "tag-kids",
      coverId: "cover-wrong-locale",
    });
    wrongLocale.product_translations = wrongLocale.product_translations.map(
      (translation) => ({ ...translation, locale: "pl" }),
    );
    const draft = productRow({
      id: "draft",
      slug: "draft",
      audience: "kids",
      title: "Draft",
      reviewDelayDays: 1,
      sortOrder: 1,
      createdAt: "2026-10-01T00:00:00.000Z",
      categoryId: "category-kids",
      tagId: "tag-kids",
      coverId: "cover-draft",
    });
    draft.status = "draft";
    const allRows = [...kids, ...adults, wrongLocale, draft];
    mocks.rows.products = allRows;

    const expectedSnapshot = fullHomeSnapshot(allRows, "en");
    const actualSnapshot = await getPublicHomeProductSnapshotForRequest("en");

    for (const audience of ["kids", "adults"] as const) {
      expect(
        getFeaturedProductsFromSnapshot(actualSnapshot, "en", audience).map(
          (product) => product.slug,
        ),
      ).toEqual(
        getFeaturedProductsFromSnapshot(expectedSnapshot, "en", audience).map(
          (product) => product.slug,
        ),
      );
    }
    expect(
      getFeaturedProductsFromSnapshot(actualSnapshot, "en").map(
        (product) => product.slug,
      ),
    ).toEqual(
      getFeaturedProductsFromSnapshot(expectedSnapshot, "en").map(
        (product) => product.slug,
      ),
    );
    expect(actualSnapshot.products).toHaveLength(8);
    expect(
      actualSnapshot.products.find((product) => product.slug === "kid-no-cover")?.assets,
    ).toEqual([]);
    expect(actualSnapshot.products.some((product) => product.slug === "wrong-locale")).toBe(
      false,
    );
    expect(actualSnapshot.products.some((product) => product.slug === "draft")).toBe(false);
    const productQueries = mocks.queries.filter((query) => query.table === "products");
    expect(productQueries).toHaveLength(6);
    const tieQueries = productQueries.filter((query) =>
      query.filters.some(
        ([column, value]) => column === "review_delay_days" && value === 4,
      ),
    );
    expect(tieQueries).toHaveLength(2);
    expect(tieQueries.map((query) => query.limit)).toEqual([1_000, 1_000]);
    for (const tieQuery of tieQueries) {
      expect(tieQuery.columns).toContain("id");
      expect(tieQuery.columns).toContain("audience");
      expect(tieQuery.columns).toContain("review_delay_days");
      expect(tieQuery.columns).toContain("product_translations!inner ( locale, title )");
      expect(tieQuery.columns).not.toContain("product_assets");
      expect(tieQuery.columns).not.toContain("short_description");
      expect(tieQuery.inFilters).toEqual([]);
    }
    expect(
      tieQueries.some((query) =>
        query.gtFilters.some(
          ([column, value]) => column === "id" && value === "kid-boundary-0999",
        ),
      ),
    ).toBe(true);
    const adultQuery = productQueries.find((query) =>
      query.filters.some(([column, value]) => column === "audience" && value === "adults"),
    );
    expect(adultQuery?.limit).toBe(5);
    expect(adultQuery?.orders).toEqual([
      { column: "review_delay_days", ascending: true },
    ]);
    expect(adultQuery?.gtFilters).toEqual([]);

    const detailQueries = productQueries.filter((query) =>
      query.columns.includes("product_assets"),
    );
    expect(detailQueries).toHaveLength(2);
    const fullViews = getPublishedProductViewsFromSnapshot(expectedSnapshot, "en");
    for (const audience of ["kids", "adults"] as const) {
      const selectedIds = sortFeaturedProductCandidates(
        fullViews.filter((product) => product.audience === audience),
      )
        .slice(0, 4)
        .map((product) => product.id);
      const detailQuery = detailQueries.find((query) =>
        query.filters.some(
          ([column, value]) => column === "audience" && value === audience,
        ),
      );
      expect(detailQuery?.inFilters).toEqual([["id", selectedIds]]);
      expect(selectedIds).toHaveLength(4);
    }
    expect(
      detailQueries
        .find((query) =>
          query.filters.some(
            ([column, value]) => column === "audience" && value === "kids",
          ),
        )
        ?.inFilters[0]?.[1],
    ).toContain("kid-no-cover");
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
    expect(snapshot.collections).toEqual([]);
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

function fullHomeSnapshot(
  rows: Array<Record<string, unknown>>,
  locale: string,
): ContentSnapshot {
  const products = rows.flatMap((row): Product[] => {
    if (row.status !== "published") {
      return [];
    }

    const translations = Array.isArray(row.product_translations)
      ? row.product_translations.filter(isRecord)
      : [];
    const translation = translations.find((item) => item.locale === locale);
    if (!translation) {
      return [];
    }

    return [
      {
        id: String(row.id ?? ""),
        slug: String(row.slug ?? ""),
        status: "published",
        audience: row.audience as Product["audience"],
        productType: String(row.product_type ?? ""),
        coverAssetId: String(row.cover_asset_id ?? ""),
        reviewDelayDays:
          typeof row.review_delay_days === "number" ? row.review_delay_days : 14,
        sortOrder: typeof row.sort_order === "number" ? row.sort_order : 100,
        createdAt: String(row.created_at ?? ""),
        updatedAt: String(row.updated_at ?? ""),
        translations: [
          {
            locale: translation.locale as Product["translations"][number]["locale"],
            title: String(translation.title ?? ""),
            shortDescription: String(translation.short_description ?? ""),
            longDescription: "",
          },
        ],
        categoryIds: [],
        tagIds: [],
        assets: [],
        amazonLinks: [],
        premiumCodes: [],
      },
    ];
  });

  return {
    products,
    collections: [],
    categories: [],
    tags: [],
    staticPages: [],
    catalogSettings: { desktopColumns: 4 },
    aboutPageSettings: {
      intro: "",
      favoriteColoringBookIds: ["", "", ""],
      favoritePictureBookIds: ["", "", ""],
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
