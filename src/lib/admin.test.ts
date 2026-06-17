import { describe, expect, it } from "vitest";

import {
  buildProductFromFormData,
  validateAssetClassification,
} from "./admin-content";
import { exportUsersToCsv, validateProductForPublish } from "./admin";
import { getSeedContentSnapshot } from "./content-store";
import { products } from "./seed-data";

describe("admin behavior", () => {
  it("requires English title and Amazon link before publishing", () => {
    expect(validateProductForPublish(products[0])).toMatchObject({ ok: true });
    expect(
      validateProductForPublish({
        translations: [],
        amazonLinks: [],
      }),
    ).toMatchObject({
      ok: false,
      missing: [
        "English title",
        "English short description",
        "Amazon link",
        "Cover asset",
      ],
    });
  });

  it("exports marketing email CSV without non-consenting users", () => {
    const csv = exportUsersToCsv({ marketingOnly: true });

    expect(csv).toContain("admin@lamilialomi.test");
    expect(csv).not.toContain("unverified@lamilialomi.test");
  });

  it("builds a product draft with taxonomy, public media, premium files, Amazon links, and codes", () => {
    const snapshot = getSeedContentSnapshot();
    const form = new FormData();

    form.set("title_en", "Ocean Calm Coloring Book");
    form.set("shortDescription_en", "A calm test book.");
    form.set("longDescription_en", "Long calm description.");
    form.set("status", "published");
    form.set("audience", "adults");
    form.set("productType", "coloring-book");
    form.append("categoryIds", snapshot.categories[0].id);
    form.append("tagIds", snapshot.tags[0].id);
    form.append("assetId", "asset-cover");
    form.append("assetKind", "cover");
    form.append("assetBucket", "public-media");
    form.append("assetPath", "/assets/covers/ocean-calm.png");
    form.append("assetFilename", "ocean-calm.png");
    form.append("assetContentType", "image/png");
    form.append("assetLocale", "");
    form.append("assetTitle", "Ocean cover");
    form.append("assetSortOrder", "1");
    form.append("assetId", "asset-premium");
    form.append("assetKind", "premium_download");
    form.append("assetBucket", "premium-files");
    form.append("assetPath", "ocean-calm/bonus.pdf");
    form.append("assetFilename", "bonus.pdf");
    form.append("assetContentType", "application/pdf");
    form.append("assetLocale", "");
    form.append("assetTitle", "Premium PDF");
    form.append("assetSortOrder", "1");
    form.append("amazonId", "amazon-ocean-us");
    form.append("amazonMarket", "amazon.com");
    form.append("amazonUrl", "https://www.amazon.com/dp/TEST");
    form.append("amazonPrimary", "amazon-ocean-us");
    form.append("premiumCodeId", "code-ocean");
    form.append("premiumCode", "lomi-ocean-2026");
    form.append("premiumCodeActive", "code-ocean");

    const result = buildProductFromFormData(form, { snapshot });

    expect(result.errors).toEqual([]);
    expect(result.product.slug).toBe("ocean-calm-coloring-book");
    expect(result.product.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "cover", isPublic: true }),
        expect.objectContaining({ kind: "premium_download", isPublic: false }),
      ]),
    );
    expect(result.product.categoryIds).toEqual([snapshot.categories[0].id]);
    expect(result.product.tagIds).toEqual([snapshot.tags[0].id]);
    expect(result.product.amazonLinks[0]).toMatchObject({ isPrimary: true });
    expect(result.product.premiumCodes[0]).toMatchObject({
      code: "LOMI-OCEAN-2026",
      active: true,
    });
  });

  it("keeps public media and premium files in separate visibility classes", () => {
    expect(
      validateAssetClassification({ kind: "premium_download", isPublic: true }),
    ).toMatchObject({ ok: false });
    expect(
      validateAssetClassification({ kind: "gallery", isPublic: false }),
    ).toMatchObject({ ok: false });
    expect(
      validateAssetClassification({ kind: "video", isPublic: true }),
    ).toMatchObject({ ok: true });
  });
});
