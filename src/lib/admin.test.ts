import { describe, expect, it } from "vitest";

import {
  buildStaticPagesFromFormData,
  buildProductFromFormData,
  validateProductAssetSubmission,
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

  it("normalizes premium assets to the private storage bucket", () => {
    const form = new FormData();
    form.set("title_en", "Private bonus");
    form.set("assetKind", "premium_download");
    form.set("assetBucket", "public-media");
    form.set("assetPath", "private/bonus.pdf");

    const result = buildProductFromFormData(form, { snapshot: getSeedContentSnapshot() });

    expect(result.product.assets[0]).toMatchObject({
      kind: "premium_download",
      bucket: "premium-files",
      isPublic: false,
    });
  });

  it("keeps persisted media metadata canonical and rejects unconfirmed new assets", () => {
    const product = getSeedContentSnapshot().products[0];
    const cover = product.assets.find((asset) => asset.kind === "cover")!;
    const form = new FormData();
    form.set("id", product.id);
    form.append("assetId", cover.id);
    form.append("assetKind", "video");
    form.append("assetBucket", "premium-files");
    form.append("assetPath", "products/attacker/video/cover.svg");
    form.append("assetFilename", "attacker.svg");
    form.append("assetContentType", "text/html");
    form.append("assetSortOrder", "1");
    form.append("assetUploaded", "0");

    const rebuilt = buildProductFromFormData(form, {
      existing: product,
      snapshot: getSeedContentSnapshot(),
    }).product;
    const rebuiltCover = rebuilt.assets.find((asset) => asset.id === cover.id)!;

    expect(rebuiltCover.kind).toBe("cover");
    expect(rebuiltCover.bucket).toBe("public-media");
    expect(rebuiltCover.path).toBe(cover.path);
    expect(rebuiltCover.filename).toBe(cover.filename);

    const unconfirmedId = "33333333-3333-4333-8333-333333333399";
    const unconfirmed = {
      ...rebuilt,
      assets: [{
        ...rebuiltCover,
        id: unconfirmedId,
        kind: "gallery" as const,
        path: `products/${product.id}/gallery/${unconfirmedId}-page.png`,
        filename: "page.png",
      }],
    };
    expect(validateProductAssetSubmission(form, unconfirmed, product)).toContain(
      "page.png: potwierdź zakończenie przesyłania przed zapisaniem.",
    );
  });

  it("rejects more than twenty active gallery assets server-side", () => {
    const form = new FormData();
    form.set("title_en", "Gallery limit");
    for (let index = 0; index < 21; index += 1) {
      form.append("assetId", `asset-${index}`);
      form.append("assetKind", "gallery");
      form.append("assetPath", `/uploads/gallery/page-${index}.png`);
      form.append("assetFilename", `page-${index}.png`);
      form.append("assetContentType", "image/png");
      form.append("assetSortOrder", String(index + 1));
    }

    const result = buildProductFromFormData(form, { snapshot: getSeedContentSnapshot() });
    expect(result.errors).toContain("Galeria może zawierać maksymalnie 20 obrazów.");
  });

  it("rejects duplicate Amazon markets server-side", () => {
    const form = new FormData();
    form.set("title_en", "Duplicate market links");
    form.append("amazonId", "amazon-com-1");
    form.append("amazonMarket", "amazon.com");
    form.append("amazonUrl", "https://www.amazon.com/dp/FIRST");
    form.append("amazonId", "amazon-com-2");
    form.append("amazonMarket", "amazon.com");
    form.append("amazonUrl", "https://www.amazon.com/dp/SECOND");

    const result = buildProductFromFormData(form, { snapshot: getSeedContentSnapshot() });

    expect(result.errors).toContain("Każdy rynek Amazon może wystąpić tylko raz.");
  });

  it("preserves existing product locales, taxonomy, assets, markets, and premium codes on edit", () => {
    const snapshot = getSeedContentSnapshot();
    const existing = snapshot.products[0];
    const form = new FormData();

    form.set("id", existing.id);
    form.set("status", existing.status);
    form.set("audience", existing.audience);
    form.set("productType", existing.productType);
    form.set("slug", existing.slug);
    form.set("coverAssetId", existing.coverAssetId);
    form.set("videoAssetId", existing.videoAssetId ?? "");
    form.set("reviewDelayDays", String(existing.reviewDelayDays));
    form.set("sortOrder", String(existing.sortOrder));

    for (const translation of existing.translations) {
      form.set(`title_${translation.locale}`, translation.title);
      form.set(`shortDescription_${translation.locale}`, translation.shortDescription);
      form.set(`longDescription_${translation.locale}`, translation.longDescription);
      form.set(`seoTitle_${translation.locale}`, translation.seoTitle ?? "");
      form.set(`seoDescription_${translation.locale}`, translation.seoDescription ?? "");
    }

    for (const categoryId of existing.categoryIds) form.append("categoryIds", categoryId);
    for (const tagId of existing.tagIds) form.append("tagIds", tagId);

    for (const asset of existing.assets) {
      form.append("assetId", asset.id);
      form.append("assetKind", asset.kind);
      form.append("assetBucket", asset.bucket);
      form.append("assetPath", asset.path);
      form.append("assetFilename", asset.filename);
      form.append("assetContentType", asset.contentType);
      form.append("assetLocale", asset.locale ?? "");
      form.append("assetTitle", asset.title ?? "");
      form.append("assetSortOrder", String(asset.sortOrder));
    }

    for (const link of existing.amazonLinks) {
      form.append("amazonId", link.id);
      form.append("amazonMarket", link.market);
      form.append("amazonUrl", link.url);
      if (link.isPrimary) form.append("amazonPrimary", link.id);
    }

    for (const code of existing.premiumCodes) {
      form.append("premiumCodeId", code.id);
      form.append("premiumCode", code.code);
      if (code.active) form.append("premiumCodeActive", code.id);
    }

    const result = buildProductFromFormData(form, { existing, snapshot });

    expect(result.errors).toEqual([]);
    expect(result.product.translations).toEqual(existing.translations);
    expect(result.product.categoryIds).toEqual(existing.categoryIds);
    expect(result.product.tagIds).toEqual(existing.tagIds);
    expect(result.product.assets).toHaveLength(existing.assets.length);
    for (const asset of existing.assets) {
      expect(result.product.assets).toContainEqual(expect.objectContaining({
        id: asset.id,
        kind: asset.kind,
        path: asset.path,
        filename: asset.filename,
        title: asset.title,
      }));
    }
    expect(result.product.amazonLinks).toEqual(existing.amazonLinks);
    expect(result.product.premiumCodes).toEqual(existing.premiumCodes);
  });

  it("clears submitted SEO overrides while preserving omitted overrides", () => {
    const snapshot = getSeedContentSnapshot();
    const existing = {
      ...snapshot.products[0],
      translations: snapshot.products[0].translations.map((translation) => translation.locale === "en"
        ? { ...translation, seoTitle: "Custom SEO", seoDescription: "Custom description" }
        : translation),
    };
    const existingEnglish = existing.translations.find((translation) => translation.locale === "en");

    const clearForm = new FormData();
    clearForm.set("id", existing.id);
    clearForm.set("seoTitle_en", "");
    clearForm.set("seoDescription_en", "");

    const cleared = buildProductFromFormData(clearForm, { existing, snapshot }).product.translations.find(
      (translation) => translation.locale === "en",
    );

    expect(cleared).toMatchObject({
      title: existingEnglish?.title,
      shortDescription: existingEnglish?.shortDescription,
      seoTitle: undefined,
      seoDescription: undefined,
    });
    expect(cleared?.seoTitle ?? cleared?.title).toBe(cleared?.title);
    expect(cleared?.seoDescription ?? cleared?.shortDescription).toBe(cleared?.shortDescription);

    const omitted = buildProductFromFormData(new FormData(), { existing, snapshot }).product.translations.find(
      (translation) => translation.locale === "en",
    );

    expect(omitted).toMatchObject({
      seoTitle: existingEnglish?.seoTitle,
      seoDescription: existingEnglish?.seoDescription,
    });
  });

  it("builds all locale page updates for one immutable page key", () => {
    const snapshot = getSeedContentSnapshot();
    const form = new FormData();
    form.set("slug", "privacy");
    form.set("title_en", "Updated Privacy Policy");
    form.set("body_en", "Updated privacy body");

    const result = buildStaticPagesFromFormData(form, snapshot, "privacy");

    expect(result.slug).toBe("privacy");
    expect(result.pages).toHaveLength(4);
    expect(result.pages.every((page) => page.slug === "privacy")).toBe(true);
    expect(result.pages.find((page) => page.locale === "en")).toMatchObject({
      title: "Updated Privacy Policy",
      body: "Updated privacy body",
    });
    expect(snapshot.staticPages.filter((page) => page.slug === "terms")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "terms", locale: "en", title: "Terms" }),
        expect.objectContaining({ slug: "terms", locale: "pl", title: "Regulamin" }),
      ]),
    );

    form.set("slug", "terms");
    const protectedResult = buildStaticPagesFromFormData(form, snapshot, "privacy");
    expect(protectedResult.slug).toBe("privacy");
    expect(protectedResult.pages.every((page) => page.slug === "privacy")).toBe(true);
  });
});
