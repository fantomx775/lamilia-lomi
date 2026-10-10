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
import { getSeedContentSnapshot } from "./local-content";

describe("product catalog behavior", () => {
  it("hides draft products from public product lookup", () => {
    expect(getLocalizedProductView("secret-draft-product", "en")).toBeNull();
  });

  it("serves English content for retired locale requests", () => {
    const product = getLocalizedProductView("mindful-mandalas-for-adults", "pl");

    expect(product?.title).toBe("Mindful Mandalas for Adults");
    expect(product?.audienceLabel).toBe("Adults");
  });

  it("does not fall back to a stored non-English translation when English is missing", () => {
    const snapshot = getSeedContentSnapshot();
    const product = snapshot.products.find(
      (item) => item.slug === "moon-garden-coloring-book",
    );

    expect(product).toBeDefined();
    product!.translations = [
      {
        locale: "pl",
        title: "Nie powinien wyświetlić się polski tytuł",
        shortDescription: "Polish legacy description",
        longDescription: "Polish legacy description",
      },
    ];

    expect(
      getLocalizedProductViewFromSnapshot(
        snapshot,
        "moon-garden-coloring-book",
        "pl",
      ),
    ).toBeNull();
  });

  it("does not expose legacy non-English media on English product pages", () => {
    const snapshot = getSeedContentSnapshot();
    const product = snapshot.products.find(
      (item) => item.slug === "moon-garden-coloring-book",
    );

    expect(product).toBeDefined();
    product!.coverAssetId = "legacy-polish-cover";
    product!.assets.push({
      ...product!.assets[0],
      id: "legacy-polish-cover",
      locale: "pl",
      title: "Polish cover",
    });
    product!.assets.push({
      ...product!.assets[1],
      id: "legacy-polish-gallery",
      locale: "pl",
      title: "Polish gallery image",
    });

    const view = getLocalizedProductViewFromSnapshot(
      snapshot,
      "moon-garden-coloring-book",
      "en",
    );

    expect(view?.cover.id).not.toBe("legacy-polish-cover");
    expect(view?.gallery.some((asset) => asset.id === "legacy-polish-gallery")).toBe(false);
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
      catalogSettings: { desktopColumns: 4 },
    };

    const product = getLocalizedProductViewFromSnapshot(
      snapshot,
      "product-without-cover",
      "en",
    );

    expect(product?.cover.path).toBe("/assets/covers/cover-placeholder.svg");
  });

  it("surfaces English public downloads for retired locale requests", () => {
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
