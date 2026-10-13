import { describe, expect, it } from "vitest";

import {
  buildProductJsonLd,
  buildProductMetadata,
  getCatalogProducts,
  getCatalogProductsFromSnapshot,
  getAllProductTypesFromSnapshot,
  getLocalizedProductView,
  getLocalizedProductViewFromSnapshot,
  parseCatalogFilters,
} from "./products";
import { serializeRichTextDocument } from "./rich-text";
import type { ContentSnapshot, ProductAsset } from "./types";
import { getSeedContentSnapshot } from "./local-content";

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

function createCoverAsset(
  id: string,
  locale: ProductAsset["locale"],
  sortOrder: number,
  isActive = true,
): ProductAsset {
  return {
    id,
    productId: "cover-selection-product",
    kind: "cover",
    bucket: "public-media",
    path: `/assets/covers/${id}.jpg`,
    filename: `${id}.jpg`,
    contentType: "image/jpeg",
    locale,
    sortOrder,
    isPublic: true,
    isActive,
  };
}

function createCoverSelectionSnapshot(
  coverAssetId: string,
  assets: ProductAsset[],
): ContentSnapshot {
  return {
    products: [
      {
        id: "cover-selection-product",
        slug: "cover-selection-product",
        status: "published",
        audience: "adults",
        productType: "coloring-book",
        coverAssetId,
        reviewDelayDays: 14,
        sortOrder: 1,
        createdAt: "2026-09-04T00:00:00.000Z",
        updatedAt: "2026-09-04T00:00:00.000Z",
        translations: [
          {
            locale: "en",
            title: "Cover selection product",
            shortDescription: "A product for cover selection tests.",
            longDescription: "A product for cover selection tests.",
          },
        ],
        categoryIds: [],
        tagIds: [],
        assets,
        amazonLinks: [],
        premiumCodes: [],
      },
    ],
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

describe("product catalog behavior", () => {
  it("omits product types from published products without English content", () => {
    const snapshot = catalogSnapshotWithLongDescription("Visible English product.");
    const nonEnglishOnlyProduct = {
      ...snapshot.products[0],
      id: "non-english-only-product",
      slug: "non-english-only-product",
      productType: "legacy-polish-only-type",
      translations: [
        {
          locale: "pl" as const,
          title: "Produkt tylko po polsku",
          shortDescription: "Polski opis.",
          longDescription: "Polski opis.",
        },
      ],
    };
    snapshot.products.push(nonEnglishOnlyProduct);

    expect(getAllProductTypesFromSnapshot(snapshot)).toEqual(["coloring-book"]);
  });

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

    const product = getLocalizedProductViewFromSnapshot(
      snapshot,
      "product-without-cover",
      "en",
    );

    expect(product?.cover.path).toBe("/assets/covers/cover-placeholder.svg");
  });

  it("prefers the selected English cover over other eligible covers", () => {
    const snapshot = createCoverSelectionSnapshot("selected-english-cover", [
      createCoverAsset("global-cover", undefined, 1),
      createCoverAsset("selected-english-cover", "en", 2),
    ]);

    const product = getLocalizedProductViewFromSnapshot(
      snapshot,
      "cover-selection-product",
      "en",
    );

    expect(product?.cover.id).toBe("selected-english-cover");
  });

  it("prefers the selected global cover over other eligible covers", () => {
    const snapshot = createCoverSelectionSnapshot("selected-global-cover", [
      createCoverAsset("selected-global-cover", undefined, 2),
      createCoverAsset("english-cover", "en", 1),
    ]);

    const product = getLocalizedProductViewFromSnapshot(
      snapshot,
      "cover-selection-product",
      "en",
    );

    expect(product?.cover.id).toBe("selected-global-cover");
  });

  it("falls back from a selected retired Polish cover to the first eligible cover", () => {
    const snapshot = createCoverSelectionSnapshot("retired-polish-cover", [
      createCoverAsset("retired-polish-cover", "pl", 0),
      createCoverAsset("english-cover", "en", 2),
      createCoverAsset("global-cover", undefined, 1),
      createCoverAsset("inactive-english-cover", "en", 0, false),
    ]);

    const product = getLocalizedProductViewFromSnapshot(
      snapshot,
      "cover-selection-product",
      "en",
    );

    expect(product?.cover.id).toBe("global-cover");
  });

  it("uses the placeholder when no eligible cover exists", () => {
    const snapshot = createCoverSelectionSnapshot("retired-polish-cover", [
      createCoverAsset("retired-polish-cover", "pl", 0),
      createCoverAsset("inactive-english-cover", "en", 1, false),
    ]);

    const product = getLocalizedProductViewFromSnapshot(
      snapshot,
      "cover-selection-product",
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
