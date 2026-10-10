import { describe, expect, it } from "vitest";

import {
  buildProductJsonLd,
  buildProductMetadata,
  getCatalogProducts,
  getCatalogProductsFromSnapshot,
  getLocalizedProductView,
  getLocalizedProductViewFromSnapshot,
  parseCatalogFilters,
} from "./products";
import { serializeRichTextDocument } from "./rich-text";
import type { ContentSnapshot } from "./types";

function catalogSnapshotWithLongDescription(longDescription: string): ContentSnapshot {
  return {
    products: [
      {
        id: "search-product",
        slug: "search-product",
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
            title: "Search product",
            shortDescription: "Search fixture.",
            longDescription,
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
    catalogSettings: { desktopColumns: 4 },
  };
}

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

  it("searches rich descriptions by readable text without matching formatting metadata", () => {
    const longDescription = serializeRichTextDocument({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "A phrase with " },
            { type: "text", text: "formatting", marks: [{ type: "bold" }] },
            { type: "text", text: " boundaries." },
            {
              type: "text",
              text: " A linked detail.",
              marks: [{ type: "link", attrs: { href: "https://metadata-only.example/bold" } }],
            },
          ],
        },
      ],
    });
    const snapshot = catalogSnapshotWithLongDescription(longDescription);

    expect(
      getCatalogProductsFromSnapshot(snapshot, "en", {
        q: "with formatting boundaries",
        sort: "manual",
      }),
    ).toHaveLength(1);
    expect(
      getCatalogProductsFromSnapshot(snapshot, "en", { q: "bold", sort: "manual" }),
    ).toHaveLength(0);
    expect(
      getCatalogProductsFromSnapshot(snapshot, "en", {
        q: "metadata-only",
        sort: "manual",
      }),
    ).toHaveLength(0);
  });

  it("keeps legacy plain-text long descriptions searchable", () => {
    const snapshot = catalogSnapshotWithLongDescription(
      "A legacy phrase is still readable.",
    );

    expect(
      getCatalogProductsFromSnapshot(snapshot, "en", {
        q: "legacy phrase",
        sort: "manual",
      }),
    ).toHaveLength(1);
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
      catalogSettings: { desktopColumns: 4 },
    };

    const product = getLocalizedProductViewFromSnapshot(
      snapshot,
      "product-without-cover",
      "en",
    );

    expect(product?.cover.path).toBe("/assets/covers/cover-placeholder.svg");
  });

  it("surfaces active public downloads and respects locale fallback", () => {
    const product = getLocalizedProductView("moon-garden-coloring-book", "de");

    expect(product?.publicDownloads).toEqual([
      expect.objectContaining({ id: "asset-moon-public-guide", isPublic: true }),
    ]);
  });

  it("does not surface inactive public downloads or premium files in the public list", () => {
    const snapshot = getLocalizedProductView("moon-garden-coloring-book", "en");
    expect(snapshot?.publicDownloads.every((asset) => asset.kind === "public_download" && asset.isActive !== false)).toBe(true);
    expect(snapshot?.publicDownloads.some((asset) => asset.kind === "premium_download")).toBe(false);
  });
});
