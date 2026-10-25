import { expect, request, test, type Page } from "@playwright/test";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";
import { getContentSnapshot, saveContentSnapshot } from "@/lib/content-store";

test("Issue 73 reader artwork admin flow stays separate, private, and usable on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "This owned local-store scenario runs once in Chromium; it checks mobile geometry by resizing the same browser.");
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  test.skip(!(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)), "Requires the local demo backend and restores its owned content-store fixture.");

  const releaseLock = await acquireLocalContentStoreLock();
  const outputOverride = process.env.ISSUE_73_OUTPUT_DIR;
  if (outputOverride) fs.mkdirSync(path.resolve(outputOverride), { recursive: true });
  const artifactPath = (filename: string) => outputOverride ? path.resolve(outputOverride, filename) : testInfo.outputPath(filename);
  const storePath = path.resolve(process.cwd(), "data", "lamilialomi-content.local.json");
  const hadStore = fs.existsSync(storePath);
  const originalStore = hadStore ? fs.readFileSync(storePath) : undefined;
  const diagnostics = { consoleErrors: [] as string[], pageErrors: [] as string[], failedResponses: [] as Array<{ method: string; path: string; status: number }> };
  const adminEmail = "admin@lamilialomi.test";
  let productId = "";
  let productSlug = "";
  let originalGalleryCountBefore = 0;
  let endpoint = "";
  const artworkIds: string[] = [];
  let originalImagePaths = new Set<string>();
  const imageDir = () => path.resolve(process.cwd(), "data", ".collection-media", "reader-artworks", productId, "image");
  const listImagePaths = () => fs.existsSync(imageDir()) ? new Set(fs.readdirSync(imageDir()).map((name) => path.join(imageDir(), name))) : new Set<string>();

  page.on("console", (message) => { if (message.type() === "error") diagnostics.consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) diagnostics.failedResponses.push({ method: response.request().method(), path: new URL(response.url()).pathname, status: response.status() }); });

  try {
    await page.goto("/pl/login?redirectTo=/admin/products");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill("demo-password");
    await Promise.all([page.waitForURL((url) => url.pathname === "/admin/products"), page.getByRole("button", { name: /^(kontynuuj|continue)$/i }).click()]);
    const productLink = page.locator('a[href^="/admin/products/"]:not([href="/admin/products/new"])').first();
    await expect(productLink).toBeVisible();
    const editorPath = await productLink.getAttribute("href");
    if (!editorPath) throw new Error("No local product editor link was available.");
    await page.goto(editorPath);
    productId = await page.locator('#product-editor-form input[name="id"]').inputValue();
    productSlug = await page.getByLabel("Adres produktu").inputValue();
    endpoint = `/api/admin/products/${encodeURIComponent(productId)}/reader-artworks`;
    originalImagePaths = listImagePaths();
    const aboutFixture = getContentSnapshot();
    aboutFixture.aboutPageSettings.favoriteColoringBookIds = [productId, "", ""];
    saveContentSnapshot(aboutFixture);
    await page.goto(`/en/products/${encodeURIComponent(productSlug)}`);
    await expect(page.getByTestId("product-media-layout")).toBeVisible();
    originalGalleryCountBefore = await page.getByTestId("product-media-layout").locator("button").count();
    expect(originalGalleryCountBefore).toBeGreaterThan(0);
    await page.goto(editorPath);
    await expect(page.getByText("Wczytywanie prac…", { exact: true })).toHaveCount(0);
    const addButton = page.getByRole("button", { name: "Dodaj pracę" });
    await expect(page.getByText("Wczytywanie prac…", { exact: true })).toHaveCount(0);
    await expect(addButton).toBeEnabled();

    const png = await sharp({ create: { width: 72, height: 96, channels: 3, background: { r: 204, g: 105, b: 91 } } }).png().toBuffer();
    const uploadArtwork = async (nickname: string, name: string) => {
      await page.getByLabel(/Obraz/).setInputFiles({ name: `${name}.png`, mimeType: "image/png", buffer: png });
      await page.getByLabel("Pseudonim").fill(nickname);
      const response = page.waitForResponse((item) => item.request().method() === "POST" && new URL(item.url()).pathname === endpoint);
      await addButton.click();
      const result = await response;
      expect(result.status()).toBe(201);
      const body = await result.json() as { artwork: { id: string } };
      artworkIds.push(body.artwork.id);
      await expect(page.getByTestId("reader-artwork-item")).toHaveCount(artworkIds.length);
    };

    await uploadArtwork("Reader One", "reader-one");
    await uploadArtwork("Reader Two", "reader-two");
    await uploadArtwork("Reader Three", "reader-three");
    const rows = page.getByTestId("reader-artwork-item");
    const initialNames = await rows.allTextContents();
    expect(initialNames[0]).toContain("Reader One");
    expect(initialNames[1]).toContain("Reader Two");
    expect(initialNames[2]).toContain("Reader Three");

    const firstRow = rows.nth(0);
    const longNickname = "N".repeat(80);
    const longCaption = "C".repeat(240);
    await firstRow.getByRole("button", { name: "Edytuj" }).click();
    await firstRow.getByLabel("Pseudonim").fill(longNickname);
    await firstRow.getByLabel("Opis alternatywny").fill(longCaption);
    const editResponse = page.waitForResponse((item) => item.request().method() === "PATCH" && new URL(item.url()).pathname === endpoint);
    await firstRow.getByRole("button", { name: "Zapisz" }).click();
    expect((await editResponse).ok()).toBe(true);
    await expect(firstRow).toContainText(longNickname);

    const moveResponse = page.waitForResponse((item) => item.request().method() === "PATCH" && new URL(item.url()).pathname === endpoint);
    await rows.nth(1).getByRole("button", { name: "Przesuń wyżej" }).click();
    expect((await moveResponse).ok()).toBe(true);
    expect((await rows.allTextContents())[0]).toContain("Reader Two");
    expect((await rows.allTextContents())[1]).toContain(longNickname);
    expect((await rows.allTextContents())[2]).toContain("Reader Three");

    const hideResponse = page.waitForResponse((item) => item.request().method() === "PATCH" && new URL(item.url()).pathname === endpoint);
    await rows.nth(1).getByRole("button", { name: "Ukryj" }).click();
    expect((await hideResponse).ok()).toBe(true);
    const anonymous = await request.newContext({ baseURL: String(testInfo.project.use.baseURL) });
    try {
      expect((await anonymous.get(`/api/reader-artworks/${artworkIds[0]}`)).status()).toBe(404);
      expect((await anonymous.post(endpoint, { multipart: { displayName: "Anonymous" } })).status()).toBe(403);
    } finally { await anonymous.dispose(); }
    const showResponse = page.waitForResponse((item) => item.request().method() === "PATCH" && new URL(item.url()).pathname === endpoint);
    await rows.nth(1).getByRole("button", { name: "Pokaż" }).click();
    expect((await showResponse).ok()).toBe(true);

    await page.reload();
    await expect(page.getByText("Wczytywanie prac…", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("reader-artwork-item")).toHaveCount(3);
    expect((await rows.allTextContents())[0]).toContain("Reader Two");
    expect((await rows.allTextContents())[1]).toContain(longNickname);
    const loadedImage = rows.nth(1).locator("img");
    await expect.poll(() => loadedImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

    await page.setViewportSize({ width: 390, height: 844 });
    const adminRow = rows.nth(1);
    for (const longText of [adminRow.locator("strong"), adminRow.getByText(longCaption, { exact: true })]) {
      const geometry = await longText.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, scrollWidth: node.scrollWidth, viewport: document.documentElement.clientWidth, documentWidth: document.documentElement.scrollWidth };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(-1);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport + 1);
    }
    await page.screenshot({ path: artifactPath(`issue-73-reader-artwork-admin-mobile-${testInfo.project.name}.png`), fullPage: true });
    await page.goto(`/en/products/${encodeURIComponent(productSlug)}`);
    const originalImageButtons = page.getByTestId("product-media-layout").locator("button");
    const originalCount = await originalImageButtons.count();
    expect(originalCount).toBeGreaterThan(0);
    const readerGrid = page.getByTestId("reader-artwork-grid");
    await expect(readerGrid).toBeVisible();
    await expect(readerGrid.getByRole("button")).toHaveCount(3);
    const readerCaption = page.getByText(`Colored by ${longNickname}`, { exact: true }).first();
    await expect(readerCaption).toBeVisible();
    const publicGeometry = await readerCaption.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, scrollWidth: node.scrollWidth, viewport: document.documentElement.clientWidth, documentWidth: document.documentElement.scrollWidth };
    });
    expect(publicGeometry.left).toBeGreaterThanOrEqual(-1);
    expect(publicGeometry.right).toBeLessThanOrEqual(publicGeometry.viewport + 1);
    expect(publicGeometry.scrollWidth).toBeLessThanOrEqual(publicGeometry.width + 1);
    expect(publicGeometry.documentWidth).toBeLessThanOrEqual(publicGeometry.viewport + 1);
    const secondReaderButton = readerGrid.getByRole("button").nth(1);
    await secondReaderButton.click();
    const dialog = page.getByRole("dialog", { name: "Reader artwork preview" });
    await expect(dialog).toBeVisible();
    const lightboxCaption = dialog.getByText(new RegExp(`Colored by ${longNickname}`));
    await expect(lightboxCaption).toBeVisible();
    const lightboxGeometry = await lightboxCaption.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, scrollWidth: node.scrollWidth, viewport: document.documentElement.clientWidth };
    });
    expect(lightboxGeometry.left).toBeGreaterThanOrEqual(-1);
    expect(lightboxGeometry.right).toBeLessThanOrEqual(lightboxGeometry.viewport + 1);
    expect(lightboxGeometry.scrollWidth).toBeLessThanOrEqual(lightboxGeometry.width + 1);
    expect(await originalImageButtons.count()).toBe(originalCount);
    await page.keyboard.press("ArrowLeft");
    await expect(dialog).toContainText("1 of 3");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(secondReaderButton).toBeFocused();
    expect(await originalImageButtons.count()).toBe(originalGalleryCountBefore);
    await originalImageButtons.first().click();
    const originalDialog = page.getByRole("dialog", { name: "Image preview" });
    await expect(originalDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(originalDialog).toBeHidden();
    const screenshot = artifactPath(`issue-73-reader-gallery-mobile-${testInfo.project.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });

    await page.goto(editorPath);
    await expect(page.getByText("Wczytywanie prac…", { exact: true })).toHaveCount(0);
    const adminAddButton = page.getByRole("button", { name: "Dodaj pracę" });
    const addContrast = await contrastAgainstWhite(adminAddButton);
    expect(addContrast.ratio).toBeGreaterThanOrEqual(4.5);
    await adminAddButton.hover();
    await expect.poll(async () => (await contrastAgainstWhite(adminAddButton)).background).toBe("rgb(135, 59, 55)");
    const addHoverContrast = await contrastAgainstWhite(adminAddButton);
    expect(addHoverContrast.ratio).toBeGreaterThanOrEqual(4.5);
    expect(addHoverContrast.background).not.toBe(addContrast.background);
    await page.goto(`/en/about?reader-fixture=${Date.now()}`);
    const amazon = page.getByRole("link", { name: "View on Amazon" }).first();
    await expect(amazon).toBeVisible();
    const amazonContrast = await contrastAgainstWhite(amazon);
    expect(amazonContrast.ratio).toBeGreaterThanOrEqual(4.5);
    await amazon.hover();
    await expect.poll(async () => (await contrastAgainstWhite(amazon)).background).toBe("rgb(135, 59, 55)");
    const amazonHoverContrast = await contrastAgainstWhite(amazon);
    expect(amazonHoverContrast.ratio).toBeGreaterThanOrEqual(4.5);
    expect(amazonHoverContrast.background).not.toBe(amazonContrast.background);
    expect(diagnostics.pageErrors).toEqual([]);
    expect(diagnostics.consoleErrors).toEqual([]);
    const unexpected = diagnostics.failedResponses.filter((item) => !(item.status === 404 && item.path.startsWith("/api/reader-artworks/")) && !(item.status === 403 && item.path === endpoint));
    expect(unexpected).toEqual([]);
    fs.writeFileSync(artifactPath("issue-73-reader-gallery-diagnostics.json"), JSON.stringify({ diagnostics, publicGeometry, lightboxGeometry, contrasts: [addContrast, addHoverContrast, amazonContrast, amazonHoverContrast] }, null, 2));

    await page.goto(editorPath);
    await expect(page.getByRole("status", { name: "Wczytywanie prac…" })).toBeHidden();
    while (await page.getByTestId("reader-artwork-item").count()) {
      const countBefore = await page.getByTestId("reader-artwork-item").count();
      const deleteResponse = page.waitForResponse((item) => item.request().method() === "DELETE" && new URL(item.url()).pathname === endpoint);
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByTestId("reader-artwork-item").first().getByRole("button", { name: "Usuń" }).click();
      expect((await deleteResponse).ok()).toBe(true);
      await expect(page.getByTestId("reader-artwork-item")).toHaveCount(countBefore - 1);
    }
  } finally {
    try {
      if (productId) {
        await page.goto("/admin/products", { waitUntil: "domcontentloaded" }).catch(() => undefined);
        await page.waitForTimeout(250);
        const stillPresent = listImagePaths();
        for (const candidate of stillPresent) if (!originalImagePaths.has(candidate)) fs.rmSync(candidate, { force: true });
        if (fs.existsSync(imageDir()) && fs.readdirSync(imageDir()).length === 0) fs.rmdirSync(imageDir());
      }
      if (hadStore && originalStore) fs.writeFileSync(storePath, originalStore);
      else if (fs.existsSync(storePath)) fs.rmSync(storePath);
    } finally { releaseLock(); }
  }
});

async function contrastAgainstWhite(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((element) => {
    const parse = (value: string) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    const luminance = (value: number[]) => {
      const channels = value.map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const style = getComputedStyle(element);
    const foreground = luminance(parse(style.color));
    const background = luminance(parse(style.backgroundColor));
    const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    return { foreground: style.color, background: style.backgroundColor, ratio };
  });
}
