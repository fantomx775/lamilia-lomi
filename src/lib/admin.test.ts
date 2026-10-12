import { describe, expect, it } from "vitest";

import {
  buildStaticPagesFromFormData,
  buildCollectionFromFormData,
  buildProductFromFormData,
  buildCategoryFromFormData,
  buildTagFromFormData,
  validateProductAssetSubmission,
  validateAssetClassification,
  validateCollectionDraft,
} from "./admin-content";
import { exportUsersToCsv, validateProductForPublish } from "./admin";
import { ADMIN_ERROR_CODES } from "./admin-errors";
import { getSeedContentSnapshot } from "./content-store";
import { RICH_TEXT_FORMAT_PREFIX, parseRichTextValue, serializeRichTextDocument } from "./rich-text";
import { PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH, PRODUCT_TITLE_MAX_LENGTH } from "./product-text";
import { products } from "./seed-data";

describe("admin behavior", () => {
  it("assigns one validated collection while keeping product categories and tags", () => {
    const snapshot = getSeedContentSnapshot();
    const collectionId = "aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa";
    snapshot.collections = [{
      id: collectionId,
      name: "Forest stories",
      slug: "forest-stories",
      sortOrder: 100,
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:00:00.000Z",
    }];
    const existing = snapshot.products[0];
    const form = new FormData();
    form.set("status", "draft");
    form.set("collectionId", collectionId);
    form.set("title", existing.translations.find((translation) => translation.locale === "en")?.title ?? "Product");
    for (const id of existing.categoryIds) form.append("categoryIds", id);
    for (const id of existing.tagIds) form.append("tagIds", id);

    const result = buildProductFromFormData(form, { existing, snapshot });

    expect(result.errors).toEqual([]);
    expect(result.product.collectionId).toBe(collectionId);
    expect(result.product.categoryIds).toEqual(existing.categoryIds);
    expect(result.product.tagIds).toEqual(existing.tagIds);

    form.set("collectionId", "");
    expect(buildProductFromFormData(form, { existing, snapshot }).product.collectionId).toBeUndefined();
    form.set("collectionId", "unavailable-collection");
    expect(buildProductFromFormData(form, { existing, snapshot }).errors).toContain(ADMIN_ERROR_CODES.NOT_FOUND_COLLECTION);
  });

  it("generates a unique collection slug and validates private image metadata", () => {
    const snapshot = getSeedContentSnapshot();
    snapshot.collections = [{
      id: "aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa",
      name: "Forest stories",
      slug: "forest-stories",
      sortOrder: 100,
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:00:00.000Z",
    }];
    const form = new FormData();
    form.set("id", "bbbbbbbb-9999-4999-8999-bbbbbbbbbbbb");
    form.set("name", "Forest stories II");
    form.set("slug", "Forest stories");
    form.set("imagePath", "");

    const collection = buildCollectionFromFormData(form, snapshot);
    expect(collection.slug).toBe("forest-stories-2");
    expect(validateCollectionDraft(collection, snapshot.collections, collection.id)).toEqual([]);
  });

  it("requires collection names to be unique ignoring case and outer whitespace", () => {
    const snapshot = getSeedContentSnapshot();
    snapshot.collections = [{
      id: "aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa",
      name: "Forest stories",
      slug: "forest-stories",
      sortOrder: 100,
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt: "2026-10-11T00:00:00.000Z",
    }];
    const form = new FormData();
    form.set("id", "bbbbbbbb-9999-4999-8999-bbbbbbbbbbbb");
    form.set("name", "  FOREST STORIES  ");
    form.set("slug", "forest-stories-copy");

    const collection = buildCollectionFromFormData(form, snapshot);

    expect(validateCollectionDraft(collection, snapshot.collections, collection.id)).toContain(
      ADMIN_ERROR_CODES.CONFLICT_COLLECTION_NAME,
    );
  });

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

    form.set("title", "Ocean Calm Coloring Book");
    form.set("shortDescription", "A calm test book.");
    form.set("longDescription", "Long calm description.");
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
    form.append("assetTitle", "Ocean cover");
    form.append("assetSortOrder", "1");
    form.append("assetId", "asset-premium");
    form.append("assetKind", "premium_download");
    form.append("assetBucket", "premium-files");
    form.append("assetPath", "ocean-calm/bonus.pdf");
    form.append("assetFilename", "bonus.pdf");
    form.append("assetContentType", "application/pdf");
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
    expect(result.product.translations).toEqual([
      expect.objectContaining({ locale: "en", title: "Ocean Calm Coloring Book" }),
    ]);
    expect(result.product.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "cover", isPublic: true, locale: "en" }),
        expect.objectContaining({ kind: "premium_download", isPublic: false, locale: "en" }),
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

  it("accepts product text at the character limits and rejects longer values without truncating", () => {
    const atLimit = new FormData();
    atLimit.set("title", "T".repeat(PRODUCT_TITLE_MAX_LENGTH));
    atLimit.set("shortDescription", "S".repeat(PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH));

    const accepted = buildProductFromFormData(atLimit, { snapshot: getSeedContentSnapshot() });
    const acceptedEnglish = accepted.product.translations.find((translation) => translation.locale === "en");

    expect(accepted.errors).not.toContain(ADMIN_ERROR_CODES.VALIDATION_PRODUCT_TITLE_TOO_LONG);
    expect(accepted.errors).not.toContain(ADMIN_ERROR_CODES.VALIDATION_PRODUCT_SHORT_DESCRIPTION_TOO_LONG);
    expect(acceptedEnglish?.title).toHaveLength(PRODUCT_TITLE_MAX_LENGTH);
    expect(acceptedEnglish?.shortDescription).toHaveLength(PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH);

    const overlongTitle = new FormData();
    overlongTitle.set("title", "T".repeat(PRODUCT_TITLE_MAX_LENGTH + 1));
    overlongTitle.set("shortDescription", "A short description.");
    const rejectedTitle = buildProductFromFormData(overlongTitle, { snapshot: getSeedContentSnapshot() });

    expect(rejectedTitle.errors).toContain(ADMIN_ERROR_CODES.VALIDATION_PRODUCT_TITLE_TOO_LONG);
    expect(rejectedTitle.product.translations.find((translation) => translation.locale === "en")?.title)
      .toHaveLength(PRODUCT_TITLE_MAX_LENGTH + 1);

    const overlongShortDescription = new FormData();
    overlongShortDescription.set("title", "A valid title");
    overlongShortDescription.set("shortDescription", "S".repeat(PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH + 1));
    const rejectedShortDescription = buildProductFromFormData(overlongShortDescription, { snapshot: getSeedContentSnapshot() });

    expect(rejectedShortDescription.errors).toContain(ADMIN_ERROR_CODES.VALIDATION_PRODUCT_SHORT_DESCRIPTION_TOO_LONG);
    expect(rejectedShortDescription.product.translations.find((translation) => translation.locale === "en")?.shortDescription)
      .toHaveLength(PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH + 1);
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
    form.set("title", "Private bonus");
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
      ADMIN_ERROR_CODES.VALIDATION_ASSET_UPLOAD_INCOMPLETE,
    );
  });

  it("rejects more than twenty active gallery assets server-side", () => {
    const form = new FormData();
    form.set("title", "Gallery limit");
    for (let index = 0; index < 21; index += 1) {
      form.append("assetId", `asset-${index}`);
      form.append("assetKind", "gallery");
      form.append("assetPath", `/uploads/gallery/page-${index}.png`);
      form.append("assetFilename", `page-${index}.png`);
      form.append("assetContentType", "image/png");
      form.append("assetSortOrder", String(index + 1));
    }

    const result = buildProductFromFormData(form, { snapshot: getSeedContentSnapshot() });
    expect(result.errors).toContain(ADMIN_ERROR_CODES.VALIDATION_GALLERY_LIMIT);
  });

  it("rejects duplicate Amazon markets server-side", () => {
    const form = new FormData();
    form.set("title", "Duplicate market links");
    form.append("amazonId", "amazon-com-1");
    form.append("amazonMarket", "amazon.com");
    form.append("amazonUrl", "https://www.amazon.com/dp/FIRST");
    form.append("amazonId", "amazon-com-2");
    form.append("amazonMarket", "amazon.com");
    form.append("amazonUrl", "https://www.amazon.com/dp/SECOND");

    const result = buildProductFromFormData(form, { snapshot: getSeedContentSnapshot() });

    expect(result.errors).toContain(ADMIN_ERROR_CODES.CONFLICT_AMAZON_MARKET_DUPLICATE);
  });

  it("rejects blank premium rows instead of silently dropping them", () => {
    const form = new FormData();
    form.set("title", "Missing premium code");
    form.append("premiumCode", "   ");

    const result = buildProductFromFormData(form, { snapshot: getSeedContentSnapshot() });

    expect(result.errors).toContain(ADMIN_ERROR_CODES.VALIDATION_PREMIUM_CODE_REQUIRED);
    expect(result.product.premiumCodes).toEqual([]);
  });

  it("accepts a 128-character premium code and rejects the 129th character", () => {
    const atLimit = new FormData();
    atLimit.set("title", "Boundary premium code");
    atLimit.append("premiumCode", "x".repeat(128));

    const accepted = buildProductFromFormData(atLimit, { snapshot: getSeedContentSnapshot() });

    expect(accepted.errors).not.toContain(ADMIN_ERROR_CODES.VALIDATION_PREMIUM_CODE_TOO_LONG);
    expect(accepted.product.premiumCodes[0]?.code).toHaveLength(128);

    const overLimit = new FormData();
    overLimit.set("title", "Oversized premium code");
    overLimit.append("premiumCode", "x".repeat(129));

    const rejected = buildProductFromFormData(overLimit, { snapshot: getSeedContentSnapshot() });

    expect(rejected.errors).toContain(ADMIN_ERROR_CODES.VALIDATION_PREMIUM_CODE_TOO_LONG);
  });

  it("rejects a premium code already assigned to another product", () => {
    const snapshot = getSeedContentSnapshot();
    const form = new FormData();
    form.set("title", "Reused premium code");
    form.append("premiumCode", snapshot.products[0].premiumCodes[0].code);

    const result = buildProductFromFormData(form, { snapshot });

    expect(result.errors).toContain(ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_EXISTING);
  });

  it("preserves redeemed code identity and redemption metadata during product edits", () => {
    const snapshot = getSeedContentSnapshot();
    const source = snapshot.products[0];
    const redeemedCode = {
      id: "redeemed-premium-code",
      productId: source.id,
      code: "LOMI-REDEEMED-2026",
      active: true,
      redeemedAt: "2026-10-10T12:00:00.000Z",
      redeemedBy: "user-id",
    };
    const existing = { ...source, premiumCodes: [redeemedCode] };

    const editForm = new FormData();
    editForm.set("premiumCodeId", redeemedCode.id);
    editForm.set("premiumCode", "LOMI-CHANGED-2026");
    editForm.set("premiumCodeActive", redeemedCode.id);
    const edited = buildProductFromFormData(editForm, { existing, snapshot });

    expect(edited.errors).toContain(ADMIN_ERROR_CODES.VALIDATION_PREMIUM_CODE_REDEEMED);
    expect(edited.product.premiumCodes).toEqual([redeemedCode]);

    const removeForm = new FormData();
    removeForm.set("premiumCodeId", redeemedCode.id);
    removeForm.set("premiumCode", redeemedCode.code);
    removeForm.set("premiumCodeRemove", redeemedCode.id);
    const removed = buildProductFromFormData(removeForm, { existing, snapshot });

    expect(removed.errors).toContain(ADMIN_ERROR_CODES.VALIDATION_PREMIUM_CODE_REDEEMED);
    expect(removed.product.premiumCodes).toEqual([{ ...redeemedCode, active: false }]);

    const omitted = buildProductFromFormData(new FormData(), { existing, snapshot });
    expect(omitted.errors).toContain(ADMIN_ERROR_CODES.VALIDATION_PREMIUM_CODE_REDEEMED);
    expect(omitted.product.premiumCodes).toEqual([redeemedCode]);
  });

  it("allows disabling a redeemed code without changing its owner or timestamp", () => {
    const snapshot = getSeedContentSnapshot();
    const source = snapshot.products[0];
    const redeemedCode = {
      id: "redeemed-premium-code",
      productId: source.id,
      code: "LOMI-REDEEMED-2026",
      active: true,
      redeemedAt: "2026-10-10T12:00:00.000Z",
      redeemedBy: "user-id",
    };
    const form = new FormData();
    form.set("premiumCodeId", redeemedCode.id);
    form.set("premiumCode", redeemedCode.code);

    const result = buildProductFromFormData(form, {
      existing: { ...source, premiumCodes: [redeemedCode] },
      snapshot,
    });

    expect(result.errors).not.toContain(ADMIN_ERROR_CODES.VALIDATION_PREMIUM_CODE_REDEEMED);
    expect(result.product.premiumCodes).toEqual([{ ...redeemedCode, active: false }]);
  });

  it("updates one product language while preserving other content, assets, markets, and codes", () => {
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

    const english = existing.translations.find((translation) => translation.locale === "en")!;
    form.set("title", english.title);
    form.set("shortDescription", english.shortDescription);
    form.set("longDescription", english.longDescription);
    form.set("seoTitle", english.seoTitle ?? "");
    form.set("seoDescription", english.seoDescription ?? "");

    for (const categoryId of existing.categoryIds) form.append("categoryIds", categoryId);
    for (const tagId of existing.tagIds) form.append("tagIds", tagId);

    for (const asset of existing.assets) {
      form.append("assetId", asset.id);
      form.append("assetKind", asset.kind);
      form.append("assetBucket", asset.bucket);
      form.append("assetPath", asset.path);
      form.append("assetFilename", asset.filename);
      form.append("assetContentType", asset.contentType);
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
        locale: asset.locale,
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
    clearForm.set("seoTitle", "");
    clearForm.set("seoDescription", "");

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

  it("builds one page update and leaves existing public locale records intact", () => {
    const snapshot = getSeedContentSnapshot();
    snapshot.staticPages.push(
      {
        id: "legacy-privacy-pl",
        slug: "privacy",
        locale: "pl",
        title: "Regulamin prywatności",
        body: "Stored legacy Polish privacy content.",
        updatedAt: "2026-05-31T00:00:00.000Z",
      },
      {
        id: "legacy-terms-pl",
        slug: "terms",
        locale: "pl",
        title: "Regulamin",
        body: "Stored legacy Polish terms content.",
        updatedAt: "2026-05-31T00:00:00.000Z",
      },
    );
    const form = new FormData();
    form.set("slug", "privacy");
    form.set("title", "Updated Privacy Policy");
    form.set("body", "Updated privacy body");

    const result = buildStaticPagesFromFormData(form, snapshot, "privacy");

    expect(result.slug).toBe("privacy");
    expect(result.pages).toHaveLength(1);
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
    expect(snapshot.staticPages.find((page) => page.slug === "privacy" && page.locale === "pl")?.body).toBe(
      "Stored legacy Polish privacy content.",
    );

    form.set("slug", "terms");
    const protectedResult = buildStaticPagesFromFormData(form, snapshot, "privacy");
    expect(protectedResult.slug).toBe("privacy");
    expect(protectedResult.pages.every((page) => page.slug === "privacy")).toBe(true);
  });

  it("sanitizes serialized rich content for product and legal-page persistence", () => {
    const snapshot = getSeedContentSnapshot();
    const hostileRichText = `${RICH_TEXT_FORMAT_PREFIX}${JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Safe product copy", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
        },
        { type: "rawHTML", attrs: { html: "<script>alert(1)</script>" } },
      ],
    })}`;
    const expected = serializeRichTextDocument({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Safe product copy" }] }],
    });

    const productForm = new FormData();
    productForm.set("longDescription", hostileRichText);
    const product = buildProductFromFormData(productForm, { snapshot }).product;
    const productDescription = product.translations.find((translation) => translation.locale === "en")?.longDescription;

    const pageForm = new FormData();
    pageForm.set("slug", "terms");
    pageForm.set("body", hostileRichText);
    const pageBody = buildStaticPagesFromFormData(pageForm, snapshot, "terms").pages[0].body;

    expect(productDescription).toBe(expected);
    expect(pageBody).toBe(expected);
    expect(parseRichTextValue(productDescription ?? "")).toEqual({
      kind: "rich",
      document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Safe product copy" }] }] },
    });
    expect(productDescription).not.toContain("javascript:");
    expect(productDescription).not.toContain("script");
  });

  it("updates English taxonomy content without dropping stored translations", () => {
    const snapshot = getSeedContentSnapshot();
    const category = snapshot.categories[0];
    category.translations.push({ locale: "pl", name: "Kolorowanki" });
    const categoryForm = new FormData();
    categoryForm.set("id", category.id);
    categoryForm.set("name", "Updated books");
    categoryForm.set("description", "English description");
    const nextCategory = buildCategoryFromFormData(categoryForm, snapshot, category);

    expect(nextCategory.translations.find((translation) => translation.locale === "en")).toMatchObject({
      name: "Updated books",
      description: "English description",
    });
    expect(nextCategory.translations.find((translation) => translation.locale === "pl")).toEqual(
      category.translations.find((translation) => translation.locale === "pl"),
    );

    const tag = snapshot.tags[0];
    tag.translations.push({ locale: "pl", name: "Bonus do druku" });
    const tagForm = new FormData();
    tagForm.set("id", tag.id);
    tagForm.set("name", "Updated tag");
    const nextTag = buildTagFromFormData(tagForm, snapshot, tag);
    expect(nextTag.translations.find((translation) => translation.locale === "en")?.name).toBe("Updated tag");
    expect(nextTag.translations.find((translation) => translation.locale === "pl")).toEqual(
      tag.translations.find((translation) => translation.locale === "pl"),
    );
  });
});
