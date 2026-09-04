import { describe, expect, it } from "vitest";

import {
  buildProductJsonLd,
  buildProductMetadata,
  getCatalogProducts,
  getLocalizedProductView,
  getLocalizedProductViewFromSnapshot,
  parseCatalogFilters,
} from "./products";
import type { ContentSnapshot } from "./types";

describe("product catalog behavior", () => {
  it("hides draft products from public product lookup", () => {
    expect(getLocalizedProductView("secret-draft-product", "en")).toBeNull();
  });

  it("falls back to English when Polish translation is missing", () => {
    const product = getLocalizedProductView("mindful-mandalas-for-adults", "pl");

    expect(product?.title).toBe("Mindful Mandalas for Adults");
    expect(product?.audienceLabel).toBe("Dorośli");
  });

  it("filters, searches, and sorts catalog results through public query params", () => {
    const filters = parseCatalogFilters({
      q: "mandala",
      audience: "adults",
      sort: "az",
    });
    const results = getCatalogProducts("en", filters);

    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe("mindful-mandalas-for-adults");
  });

  it("builds SEO metadata and structured data for a product", () => {
    const product = getLocalizedProductView("moon-garden-coloring-book", "en");

    expect(product).not.toBeNull();
    const metadata = buildProductMetadata(product!, "en", "https://lamilialomi.com");
    const jsonLd = buildProductJsonLd(product!, "en", "https://lamilialomi.com");

    expect(metadata.title).toBe("Moon Garden Coloring Book by LamiliaLomi");
    expect(jsonLd).toMatchObject({
      "@type": "Book",
      name: "Moon Garden Coloring Book",
    });
  });

  it("keeps a published product renderable while its cover asset is pending", () => {
    const snapshot: ContentSnapshot = {
      products: [
        {
          id: "product-without-cover",
          slug: "product-without-cover",
          status: "published",
          audience: "adults",
          productType: "coloring-book",
          coverAssetId: "missing-cover",
          reviewDelayDays: 14,
          sortOrder: 1,
          createdAt: "2026-09-04T00:00:00.000Z",
          updatedAt: "2026-09-04T00:00:00.000Z",
          translations: [
            {
              locale: "en",
              title: "Product without cover",
              shortDescription: "A product waiting for media.",
              longDescription: "A product waiting for media.",
            },
          ],
          categoryIds: [],
          tagIds: [],
          assets: [],
          amazonLinks: [],
          premiumCodes: [],
        },
      ],
      categories: [],
      tags: [],
      staticPages: [],
    };

    const product = getLocalizedProductViewFromSnapshot(
      snapshot,
      "product-without-cover",
      "en",
    );

    expect(product?.cover.path).toBe("/assets/covers/cover-placeholder.svg");
  });
});
