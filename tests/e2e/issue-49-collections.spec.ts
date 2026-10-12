import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

const collectionName = (project: string) => `Issue 49 ${project} collection`;
const collectionSlug = (project: string) => `issue-49-${project}-collection`;
const productTitle = (project: string) => `Issue 49 ${project} product`;
const productSlug = (project: string) => `issue-49-${project}-product`;
const evidenceDirectory = path.resolve(process.cwd(), "docs", "verification", "issue-49");

let releaseContentStoreLock: (() => void) | undefined;
let originalContentStore: Buffer | undefined;
let contentStoreExisted = false;
const contentStorePath = path.resolve(process.cwd(), "data", "lamilialomi-content.local.json");

test.setTimeout(300_000);

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
    "Issue 49 browser verification requires the loopback local demo backend.",
  );
  releaseContentStoreLock = await acquireLocalContentStoreLock();
  contentStoreExisted = fs.existsSync(contentStorePath);
  originalContentStore = contentStoreExisted ? fs.readFileSync(contentStorePath) : undefined;
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ll_cookie_consent",
      JSON.stringify({ essential: true, analytics: false }),
    );
  });
});

test.afterEach(() => {
  try {
    if (contentStoreExisted && originalContentStore) {
      fs.writeFileSync(contentStorePath, originalContentStore);
    } else if (!contentStoreExisted && fs.existsSync(contentStorePath)) {
      fs.rmSync(contentStorePath);
    }
  } finally {
    originalContentStore = undefined;
    contentStoreExisted = false;
    releaseContentStoreLock?.();
    releaseContentStoreLock = undefined;
  }
});

test("manages collections, assigns products, and preserves products when a collection is deleted", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const initialCollection = collectionName(project);
  const initialSlug = collectionSlug(project);
  const editedCollection = `${initialCollection} edited`;
  const editedSlug = `${initialSlug}-edited`;
  let collection = initialCollection;
  let slug = initialSlug;
  const collectionNamesForCleanup = new Set([initialCollection, editedCollection]);
  const product = productTitle(project);
  const productAddress = productSlug(project);
  const overflowProduct = `${product} 50 tags`;
  const overflowProductAddress = `${productAddress}-50-tags`;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: Array<{
    method: string;
    url: string;
    error: string;
    disposition: "expected" | "unresolved";
    reason?: string;
  }> = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      const error = request.failure()?.errorText ?? "failed";
      const expectedNavigationAbort = error === "net::ERR_ABORTED";
      failedRequests.push({
        method: request.method(),
        url: url.pathname,
        error,
        disposition: expectedNavigationAbort ? "expected" : "unresolved",
        ...(expectedNavigationAbort ? {
          reason: url.pathname.startsWith("/__nextjs_font/")
            ? "The browser canceled an in-flight font request while replacing the page during a verified admin navigation."
            : "The browser canceled an in-flight admin page or Server Action request while replacing the page; the next route and persisted product/collection state were verified.",
        } : {}),
      });
    }
  });

  let collectionCreated = false;
  let productCreated = false;
  let collectionDeleted = false;
  let productDeleted = false;
  let overflowProductCreated = false;
  let overflowProductDeleted = false;
  let createdCollectionId = "";
  const replacementJpeg = await sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 40, g: 70, b: 90 } },
  }).jpeg().toBuffer();

  try {
    await signInAsAdmin(page);
    await page.setViewportSize(project === "chromium"
      ? { width: 1600, height: 1000 }
      : { width: 412, height: 1200 });
    await cleanupProduct(page, product).catch(() => undefined);
    await cleanupProduct(page, overflowProduct).catch(() => undefined);
    for (const staleCollectionName of collectionNamesForCleanup) {
      await cleanupCollection(page, staleCollectionName).catch(() => undefined);
    }

    await page.goto("/admin/collections");
    await page.getByRole("button", { name: "Dodaj kolekcję" }).click();
    createdCollectionId = await page.locator('input[name="id"]').inputValue();
    await page.getByLabel("Nazwa").fill(collection);
    await page.getByLabel("Slug").fill(slug);
    await saveScreenshot(page, `collection-editor-empty-${project}.png`, page.getByLabel("Nazwa"));
    await page.getByRole("button", { name: "Zapisz", exact: true }).click();
    await expect(page.getByRole("button", { name: `Edytuj kolekcję ${collection}` }).first()).toBeVisible({ timeout: 45_000 });
    collectionCreated = true;

    await page.getByRole("button", { name: `Edytuj kolekcję ${collection}` }).first().click();
    await page.getByLabel("Nazwa").fill(editedCollection);
    await page.getByLabel("Slug").fill(editedSlug);
    collection = editedCollection;
    slug = editedSlug;
    collectionNamesForCleanup.add(collection);
    const collectionImageUpload = page.waitForResponse(
      (response) => response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/admin/collection-image",
      { timeout: 60_000 },
    );
    await page.locator('input[type="file"][aria-label="Wybierz obraz kolekcji"]').setInputFiles({
      name: "collection.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
        "base64",
      ),
    });
    expect((await collectionImageUpload).ok()).toBe(true);
    const imagePreview = page.getByAltText(`Podgląd obrazu kolekcji ${collection}`);
    await expect(imagePreview).toBeVisible({ timeout: 30_000 });
    await expect(imagePreview).toHaveJSProperty("naturalWidth", 1, { timeout: 30_000 });
    await saveScreenshot(page, `collection-editor-image-${project}.png`, imagePreview);
    await page.getByRole("button", { name: "Zapisz", exact: true }).click();
    await expect(page.getByRole("button", { name: `Edytuj kolekcję ${collection}` }).first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("dialog", { name: "Edytuj kolekcję" })).toHaveCount(0);

    await page.reload();
    await page.getByRole("button", { name: `Edytuj kolekcję ${collection}` }).first().click();
    await expect(page.getByLabel("Nazwa")).toHaveValue(collection);
    await expect(page.getByLabel("Slug")).toHaveValue(slug);
    const persistedImage = page.getByAltText(`Podgląd obrazu kolekcji ${collection}`);
    await expect(persistedImage).toBeVisible();
    await expect(persistedImage).toHaveJSProperty("naturalWidth", 1);
    await page.getByRole("button", { name: "Anuluj" }).click();

    await page.goto("/admin/products/new");
    await page.getByLabel("Tytuł").fill(product);
    await page.getByLabel("Krótki opis").fill("Temporary product used to verify Issue 49 collection administration.");
    await page.getByLabel("Adres produktu").fill(productAddress);
    await page.getByLabel("Pozycja w katalogu").fill("1");
    await page.getByLabel("Kolekcja").selectOption({ label: collection });
    for (const category of ["Coloring books", "Picture books", "Mindfulness"]) {
      await page.getByLabel(category).check();
    }
    for (const tag of ["Printable bonus", "Amazon KDP", "Calm evening"]) {
      await page.getByLabel(tag).check();
    }
    await saveScreenshot(page, `product-editor-collection-${project}.png`, page.getByLabel("Kolekcja"));
    const productId = await page.locator('#product-editor-form input[name="id"]').inputValue();
    await page.getByTestId("product-save-bar").getByRole("button", { name: /Zapisz/ }).click();
    await expectProductSaveConfirmation(page);
    productCreated = true;
    const productPath = `/admin/products/${productId}`;
    await page.goto(productPath);
    await expect(page.getByLabel("Kolekcja")).toHaveValue(createdCollectionId);
    await page.getByLabel("Kolekcja").selectOption("");
    await page.getByTestId("product-save-bar").getByRole("button", { name: /Zapisz/ }).click();
    await expectProductSaveConfirmation(page);
    await page.reload();
    await expect(page.getByLabel("Kolekcja")).toHaveValue("");
    await page.getByLabel("Kolekcja").selectOption({ label: collection });
    await page.getByTestId("product-save-bar").getByRole("button", { name: /Zapisz/ }).click();
    await expectProductSaveConfirmation(page);
    await page.reload();
    await expect(page.getByLabel("Kolekcja")).toHaveValue(createdCollectionId);

    const overflowTags = project === "chromium" ? appendOverflowTags(project) : [];
    let overflowProductPath = "";
    if (project === "chromium") {
      await page.goto("/admin/products/new");
      await page.getByLabel("Tytuł").fill(overflowProduct);
      await page.getByLabel("Krótki opis").fill("Temporary product used to verify 50-tag overflow rendering.");
      await page.getByLabel("Adres produktu").fill(overflowProductAddress);
      await page.getByLabel("Pozycja w katalogu").fill("2");
      for (const tag of overflowTags) {
        const checkbox = page.locator(`#product-editor-form input[name="tagIds"][value="${tag.id}"]:visible`);
        await expect(checkbox).toHaveCount(1);
        await checkbox.check();
      }
      const overflowProductId = await page.locator('#product-editor-form input[name="id"]').inputValue();
      await page.getByTestId("product-save-bar").getByRole("button", { name: /Zapisz/ }).click();
      await expectProductSaveConfirmation(page);
      overflowProductCreated = true;
      overflowProductPath = `/admin/products/${overflowProductId}`;
      await page.goto(overflowProductPath);
      await expect(page.getByLabel(overflowTags[49].name, { exact: true })).toBeChecked();
    }

    await page.goto("/admin/collections");
    if (project === "chromium") {
      await expect(page.getByRole("row").filter({ hasText: collection }).locator("td").last()).toHaveText("1");
    } else {
      await expect(page.getByText("1 produkt", { exact: true })).toBeVisible();
    }
    await saveScreenshot(
      page,
      `collections-${project}.png`,
      page.getByRole("button", { name: `Edytuj kolekcję ${collection}` }).first(),
    );

    await page.goto("/admin/products");
    const visibleProductLink = page.locator('a[href^="/admin/products/"]:visible').filter({ hasText: product }).first();
    await expect(visibleProductLink).toBeVisible();
    const threeTagRow = page.getByRole("row").filter({ has: page.locator(`a[href="${productPath}"]`) });
    const categoryToggle = page.locator(`button[aria-controls^="product-${productId}"][aria-controls*="-category-"]:visible`).first();
    const tagToggle = page.locator(`button[aria-controls^="product-${productId}"][aria-controls*="-tag-"]:visible`).first();
    await expect(categoryToggle).toBeVisible();
    await expect(tagToggle).toBeVisible();
    if (project === "chromium") {
      await expect(page.getByRole("columnheader", { name: "Kolekcja" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Kategorie" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Tagi" })).toBeVisible();
    } else {
      await expect(page.locator("dt").filter({ hasText: "Kolekcja" }).first()).toBeVisible();
    }
    await categoryToggle.click();
    await expect(categoryToggle).toHaveAttribute("aria-expanded", "true");
    const categoryPopoverId = await categoryToggle.getAttribute("aria-controls");
    const categoryPopover = page.locator(`[id="${categoryPopoverId}"]`);
    await expect(categoryPopover).toBeVisible();
    await expect(categoryPopover.getByText("Mindfulness", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(categoryToggle).toHaveAttribute("aria-expanded", "false");

    await tagToggle.click();
    await expect(tagToggle).toHaveAttribute("aria-expanded", "true");
    const tagPopoverId = await tagToggle.getAttribute("aria-controls");
    const tagPopover = page.locator(`[id="${tagPopoverId}"]`);
    await expect(tagPopover).toBeVisible();
    await expect(tagPopover.getByText("Calm evening", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tagToggle).toHaveAttribute("aria-expanded", "false");
    await saveScreenshot(page, `products-${project}.png`, visibleProductLink);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(project === "chromium" ? 1600 : 412);

    if (project === "chromium") {
      const zeroTagRow = page.getByRole("row").filter({ hasText: "Secret Draft Product" });
      const oneTagRow = page.getByRole("row").filter({ hasText: "Bedtime Forest Picture Book" });
      const twoTagRow = page.getByRole("row").filter({ hasText: "Moon Garden Coloring Book" });
      await expect(zeroTagRow.locator("td").last()).toHaveText("—");
      await expect(oneTagRow.locator("td").last()).toContainText("Amazon KDP");
      await expect(oneTagRow.locator("td").last().getByRole("button")).toHaveCount(0);
      await expect(twoTagRow.locator("td").last().getByText("Printable bonus")).toBeVisible();
      await expect(twoTagRow.locator("td").last().getByText("Amazon KDP")).toBeVisible();
      await expect(twoTagRow.locator("td").last().getByRole("button")).toHaveCount(0);
      await expect(threeTagRow.locator("td").last().getByRole("button", { name: "Pokaż 1 kolejny tag" })).toBeVisible();

      const overflowProductLink = page.locator('a[href^="/admin/products/"]:visible').filter({ hasText: overflowProduct }).first();
      await expect(overflowProductLink).toBeVisible();
      const overflowTagButton = page.locator('button[aria-label="Pokaż 48 kolejnych tagów"]:visible').first();
      await expect(overflowTagButton).toBeVisible();
      const overflowPopoverId = await overflowTagButton.getAttribute("aria-controls");
      await overflowTagButton.click();
      const overflowPopover = page.locator(`[id="${overflowPopoverId}"]`);
      await expect(overflowPopover).toBeVisible();
      const lastOverflowTag = overflowPopover.getByText(overflowTags[49].name, { exact: true });
      await lastOverflowTag.scrollIntoViewIfNeeded();
      await expect(lastOverflowTag).toBeVisible();
      await expect.poll(() => overflowPopover.evaluate((popover) => popover.scrollTop)).toBeGreaterThan(0);
      await saveScreenshot(page, `products-overflow-${project}.png`, overflowProductLink);
    }

    await page.goto("/admin/collections");
    await page.getByRole("button", { name: `Edytuj kolekcję ${collection}` }).first().click();
    await expect(page.getByAltText(`Podgląd obrazu kolekcji ${collection}`)).toBeVisible();
    await page.getByRole("button", { name: "Usuń obraz kolekcji" }).click();
    await expect(page.getByText("Nie dodano obrazu.", { exact: true })).toBeVisible();
    await saveScreenshot(page, `collection-editor-no-image-${project}.png`, page.getByText("Nie dodano obrazu.", { exact: true }));
    await page.getByRole("button", { name: "Zapisz", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Edytuj kolekcję" })).toHaveCount(0);

    await page.reload();
    await page.getByRole("button", { name: `Edytuj kolekcję ${collection}` }).first().click();
    await expect(page.getByText("Nie dodano obrazu.", { exact: true })).toBeVisible();
    await expect(page.getByAltText(`Podgląd obrazu kolekcji ${collection}`)).toHaveCount(0);

    const restoredImageUpload = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/collection-image",
    );
    await page.locator('input[type="file"][aria-label="Wybierz obraz kolekcji"]').setInputFiles({
      name: "restored.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
        "base64",
      ),
    });
    expect((await restoredImageUpload).ok()).toBe(true);
    await expect(page.getByAltText(`Podgląd obrazu kolekcji ${collection}`)).toBeVisible();
    await page.getByRole("button", { name: "Zapisz", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Edytuj kolekcję" })).toHaveCount(0);

    await page.getByRole("button", { name: `Edytuj kolekcję ${collection}` }).first().click();
    await expect(page.getByRole("dialog", { name: "Edytuj kolekcję" })).toBeVisible();
    const replacementUploadResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/collection-image",
    );
    await page.locator('input[type="file"][aria-label="Wybierz obraz kolekcji"]').setInputFiles({
      name: "unsaved-replacement.jfif",
      mimeType: "image/jpeg",
      buffer: replacementJpeg,
    });
    const replacementUploadResponseValue = await replacementUploadResponse;
    expect(replacementUploadResponseValue.ok()).toBe(true);
    const replacementImage = (await replacementUploadResponseValue.json()).image as { path: string };
    const pendingImageCleanup = page.waitForResponse((response) =>
      response.request().method() === "DELETE" &&
      new URL(response.url()).pathname === "/api/admin/collection-image" &&
      response.request().postData()?.includes(replacementImage.path) === true,
    );
    await withAcceptedConfirmation(page, () => page.getByRole("button", { name: "Usuń kolekcję" }).click());
    const pendingImageCleanupResponse = await pendingImageCleanup;
    expect(pendingImageCleanupResponse.status()).toBe(200);
    await expect(page.getByRole("dialog", { name: "Edytuj kolekcję" })).toHaveCount(0);
    collectionDeleted = true;
    await expect(page.getByRole("button", { name: `Edytuj kolekcję ${collection}` })).toHaveCount(0);
    await page.goto(productPath);
    await expect(page.getByLabel("Kolekcja")).toHaveValue("");
    await expect(page.getByLabel("Adres produktu")).toHaveValue(productAddress);

    await deleteProduct(page, product);
    productDeleted = true;
    if (overflowProductPath) {
      await page.goto(overflowProductPath);
      await deleteProduct(page, overflowProduct);
      overflowProductDeleted = true;
    }
  } finally {
    if (collectionCreated && !collectionDeleted) {
      for (const collectionNameForCleanup of collectionNamesForCleanup) {
        await cleanupCollection(page, collectionNameForCleanup).catch(() => undefined);
      }
    }
    if (productCreated && !productDeleted) await cleanupProduct(page, product).catch(() => undefined);
    if (overflowProductCreated && !overflowProductDeleted) await cleanupProduct(page, overflowProduct).catch(() => undefined);
    await testInfo.attach("issue-49-browser-diagnostics.json", {
      body: Buffer.from(JSON.stringify({ consoleErrors, pageErrors, failedRequests }, null, 2)),
      contentType: "application/json",
    });
  }

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests.filter((request) => request.disposition === "unresolved")).toEqual([]);
});

async function signInAsAdmin(page: Page) {
  await page.goto("/en/login?redirectTo=/admin");
  await page.getByLabel("Email").fill("admin@lamilialomi.test");
  await page.getByLabel("Password").fill("demo-password");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.getByRole("button", { name: "Continue" }).click(),
  ]);
}

async function saveScreenshot(page: Page, filename: string, target: import("@playwright/test").Locator) {
  await mkdir(evidenceDirectory, { recursive: true });
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const viewport = page.viewportSize();
  if (viewport) await page.mouse.move(viewport.width - 1, viewport.height - 1);
  await page.screenshot({ path: path.join(evidenceDirectory, filename), animations: "disabled" });
}

function appendOverflowTags(project: string) {
  if (!fs.existsSync(contentStorePath)) {
    throw new Error("The local content store was not created before the 50-tag browser fixture was added.");
  }

  const snapshot = JSON.parse(fs.readFileSync(contentStorePath, "utf8")) as {
    tags?: Array<{
      id: string;
      slug: string;
      translations: Array<{ locale: "en"; name: string }>;
    }>;
    [key: string]: unknown;
  };
  const tagNames = Array.from({ length: 50 }, (_, index) => `Issue 49 ${project} overflow tag ${index + 1}`);
  const tags = tagNames.map((name, index) => ({
    id: randomUUID(),
    slug: `issue-49-${project}-overflow-tag-${index + 1}`,
    translations: [{ locale: "en" as const, name }],
  }));
  snapshot.tags = [...(snapshot.tags ?? []), ...tags];
  fs.writeFileSync(contentStorePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return tags.map((tag) => ({ id: tag.id, name: tag.translations[0].name }));
}

async function cleanupCollection(page: Page, name: string) {
  await page.goto("/admin/collections");
  const editButton = page.getByRole("button", { name: `Edytuj kolekcję ${name}` }).first();
  if (!(await editButton.count())) return;
  await editButton.click();
  await withAcceptedConfirmation(page, () => page.getByRole("button", { name: "Usuń kolekcję" }).click());
  await expect(page.getByRole("dialog", { name: /kolekcję/ })).toHaveCount(0);
}

async function cleanupProduct(page: Page, name: string) {
  await page.goto("/admin/products");
  const productLink = page.locator('a[href^="/admin/products/"]:visible').filter({ hasText: name }).first();
  if (!(await productLink.count())) return;
  await productLink.click();
  await deleteProduct(page, name);
}

async function deleteProduct(page: Page, name: string) {
  await expect(page.getByLabel("Tytuł")).toHaveValue(name);
  await withAcceptedConfirmation(page, () => page.getByRole("button", { name: "Usuń produkt" }).click());
  await expect(page).toHaveURL(/\/admin\/products(?:\?.*)?$/);
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
}

async function withAcceptedConfirmation(page: Page, action: () => Promise<void>) {
  let dialogCount = 0;
  let dialogOutcome: Promise<void> | undefined;
  const handleDialog = (dialog: import("@playwright/test").Dialog) => {
    dialogCount += 1;
    dialogOutcome = dialogCount === 1 ? dialog.accept() : dialog.dismiss();
  };

  page.on("dialog", handleDialog);
  try {
    await action();
    expect(dialogCount).toBe(1);
    if (!dialogOutcome) throw new Error("The confirmation dialog was not handled.");
    await dialogOutcome;
  } finally {
    page.off("dialog", handleDialog);
  }
}

async function expectProductSaveConfirmation(page: Page) {
  await expect(page.getByText(/^(?:Zapisano\. Zmiany są aktualne\.|Zapisano zmiany\.)$/)).toBeVisible();
}
