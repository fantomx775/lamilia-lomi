import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test.setTimeout(600_000);

let releaseContentStoreLock: (() => void) | undefined;

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
    "Issue 24 image management E2E requires the loopback app running the local demo backend.",
  );
  releaseContentStoreLock = await acquireLocalContentStoreLock();
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ll_cookie_consent",
      JSON.stringify({ essential: true, analytics: false }),
    );
  });
});

test.afterEach(() => {
  releaseContentStoreLock?.();
  releaseContentStoreLock = undefined;
});

test("category image upload, replace, storefront display, and removal work on desktop and mobile", async ({ page }, testInfo) => {
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);
  const project = testInfo.project.name;
  const suffix = `${Date.now()}-${project}`;
  const categoryName = `Issue 24 category ${suffix}`;
  const categorySlug = `issue-24-category-${suffix.toLowerCase()}`;
  const errors: string[] = [];
  let categoryCreated = false;

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => void dialog.accept());

  try {
    await signInAsAdmin(page);
    await page.goto("/admin/categories");
    await page.getByRole("button", { name: "Dodaj kategorię" }).click();

    const createDialog = page.getByRole("dialog", { name: "Nowa kategoria" });
    await createDialog.getByLabel("Nazwa").fill(categoryName);
    await createDialog.getByLabel("Opis").fill("Temporary image management verification category.");
    await createDialog.locator('input[name="slug"]').fill(categorySlug);
    await createDialog.getByRole("button", { name: "Zapisz" }).click();
    await expect(createDialog).not.toBeVisible();
    categoryCreated = true;

    const editTrigger = page.getByRole("button", { name: `Edytuj kategorię ${categoryName}` });
    await expect(editTrigger).toBeVisible();
    await editTrigger.click();
    const editDialog = page.getByRole("dialog", { name: "Edytuj kategorię" });
    await expect(editDialog.getByText(/Kwadrat 1:1/)).toBeVisible();
    await expect(editDialog.getByText("Dodaj obraz")).toBeVisible();

    const imageInput = editDialog.locator("#category-image-file");
    await imageInput.setInputFiles({
      name: "issue-24-category-invalid-ratio.png",
      mimeType: "image/png",
      buffer: makePng(640, 480, [220, 60, 70]),
    });
    await expect(editDialog.getByRole("alert")).toContainText("kwadrat 1:1");

    await imageInput.setInputFiles({
      name: "issue-24-category-first.png",
      mimeType: "image/png",
      buffer: makePng(640, 640, [220, 60, 70]),
    });
    await expect(editDialog.getByText("Obraz kategorii został zapisany.")).toBeVisible();
    const firstPreview = editDialog.getByRole("img", { name: "Obraz kategorii issue-24-category-first.png" });
    await expect(firstPreview).toBeVisible();
    await expect.poll(() => firstPreview.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await firstPreview.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeLessThanOrEqual(640);
    await firstPreview.scrollIntoViewIfNeeded();
    await capture(page, "category-admin-uploaded", testInfo);

    await imageInput.setInputFiles({
      name: "issue-24-category-replacement.png",
      mimeType: "image/png",
      buffer: makePng(640, 640, [40, 120, 210]),
    });
    await expect(editDialog.getByText("Obraz kategorii został zapisany.")).toBeVisible();
    const replacementPreview = editDialog.getByRole("img", { name: "Obraz kategorii issue-24-category-replacement.png" });
    await expect(replacementPreview).toBeVisible();
    await expect.poll(() => replacementPreview.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await replacementPreview.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeLessThanOrEqual(640);

    await page.goto("/en/products");
    const categoryCard = page.getByRole("link", { name: new RegExp(categoryName) });
    await expect(categoryCard).toBeVisible();
    const storefrontImage = categoryCard.getByRole("img", { name: categoryName });
    await expect(storefrontImage).toBeVisible();
    await expect.poll(() => storefrontImage.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await storefrontImage.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeLessThanOrEqual(640);
    await expect(categoryCard.locator("span.relative")).toHaveCSS("aspect-ratio", "1 / 1");
    await capture(page, "category-storefront", testInfo);

    await page.goto("/admin/products");
    const firstProductLink = page
      .locator('a[href^="/admin/products/"]:not([href$="/new"])')
      .filter({ visible: true })
      .first();
    await expect(firstProductLink).toBeVisible();
    const productThumbnail = firstProductLink.getByRole("img").first();
    await expect(productThumbnail).toBeVisible();
    await expect.poll(() => productThumbnail.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(firstProductLink).toBeInViewport();
    await capture(page, "admin-product-thumbnails", testInfo);

    await page.goto("/admin/categories");
    await page.getByRole("button", { name: `Edytuj kategorię ${categoryName}` }).click();
    const cleanupDialog = page.getByRole("dialog", { name: "Edytuj kategorię" });
    await cleanupDialog.getByRole("button", { name: "Usuń obraz" }).click();
    await expect(cleanupDialog.getByText("Obraz kategorii został usunięty.")).toBeVisible();
    await page.goto("/en/products");
    const emptyCategoryCard = page.getByRole("link", { name: new RegExp(categoryName) });
    await expect(emptyCategoryCard.getByRole("img", { name: `${categoryName} — brak obrazu` })).toBeVisible();

    await page.goto("/admin/categories");
    await page.getByRole("button", { name: `Edytuj kategorię ${categoryName}` }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Edytuj kategorię" });
    await deleteDialog.getByRole("button", { name: "Usuń kategorię" }).click();
    await expect(page.getByRole("button", { name: `Edytuj kategorię ${categoryName}` })).toHaveCount(0);
    categoryCreated = false;
  } finally {
    if (categoryCreated) {
      await cleanupCategory(page, categoryName).catch(() => undefined);
    }
  }

  expect(errors).toEqual([]);
});

test("shows an actionable warning when category image cleanup is deferred", async ({ page }, testInfo) => {
  const errors: string[] = [];
  const categoryId = "11111111-1111-4111-8111-111111111111";
  page.on("pageerror", (error) => errors.push(error.message));

  await signInAsAdmin(page);
  await page.goto(`/admin/categories?cleanupDeferred=1&categoryId=${categoryId}`);

  const warning = page.getByRole("alert");
  await expect(warning).toContainText("Kategorię usunięto, ale jej plik obrazu nie został usunięty");
  await expect(warning).toContainText(categoryId);
  await expect(page.getByRole("button", { name: "Zamknij komunikat" })).toBeVisible();
  await capture(page, "category-cleanup-warning", testInfo);
  expect(errors).toEqual([]);
});

async function signInAsAdmin(page: Page) {
  await page.goto("/pl/login?redirectTo=/admin/categories");
  await page.getByLabel("E-mail").fill("admin@lamilialomi.test");
  await page.getByLabel("Hasło").fill("demo-password");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin/categories"),
    page.getByRole("button", { name: "Kontynuuj" }).click(),
  ]);
}

async function cleanupCategory(page: Page, categoryName: string) {
  await page.goto("/admin/categories");
  const trigger = page.getByRole("button", { name: `Edytuj kategorię ${categoryName}` });
  if (!(await trigger.count())) return;
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Edytuj kategorię" });
  const removeImage = dialog.getByRole("button", { name: "Usuń obraz" });
  if (await removeImage.count()) {
    await removeImage.click();
    await expect(dialog.getByText("Obraz kategorii został usunięty.")).toBeVisible();
  }
  await dialog.getByRole("button", { name: "Usuń kategorię" }).click();
  await expect(page.getByRole("button", { name: `Edytuj kategorię ${categoryName}` })).toHaveCount(0);
}

async function capture(page: Page, name: string, testInfo: { project: { name: string } }) {
  const evidenceRoot = process.env.PLAYWRIGHT_IMAGE_UX_EVIDENCE_DIR;
  if (!evidenceRoot) return;
  const evidenceDirectory = path.resolve(process.cwd(), evidenceRoot, testInfo.project.name);
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  const filename = `${name}.png`;
  await page.screenshot({ path: path.join(evidenceDirectory, filename), fullPage: true });
}

function makePng(width: number, height: number, rgb: readonly number[]) {
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (1 + width * 4);
    scanlines[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      const accent = x > 160 && x < 480 && y > 160 && y < 480;
      scanlines[offset] = accent ? 255 : rgb[0];
      scanlines[offset + 1] = accent ? 255 : rgb[1];
      scanlines[offset + 2] = accent ? 255 : rgb[2];
      scanlines[offset + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function crc32(data: Buffer) {
  let checksum = 0xffffffff;
  for (const byte of data) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}
