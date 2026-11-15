import { expect, test } from "@playwright/test";

test("product gallery opens a full-size image preview and supports navigation", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ll_cookie_consent",
      JSON.stringify({ essential: true, analytics: false }),
    );
  });

  await page.goto("/en/products");
  const catalog = page.getByTestId("product-catalog-grid");
  await expect(catalog).toBeVisible();
  const catalogCover = catalog.getByRole("img").first();
  await expect(catalogCover).toBeVisible();
  await expect.poll(() => catalogCover.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("product-catalog.png"), fullPage: true, caret: "initial" });

  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(response.url());
  });

  const bleedFixturePath = "/assets/gallery/moon-garden-page-1.svg";
  await page.route((url) => url.pathname === bleedFixturePath || url.searchParams.get("url") === bleedFixturePath, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1725" height="1750"><rect width="100%" height="100%" fill="lightyellow"/><circle cx="50%" cy="50%" r="30%" fill="coral"/></svg>',
    }),
  );
  await page.goto("/en/products/moon-garden-coloring-book");
  await expect(page.getByRole("heading", { name: "Inside the book" })).toBeVisible();
  const productCover = page.getByRole("main").getByRole("img").first();
  await expect(productCover).toBeVisible();
  await expect.poll(() => productCover.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("product-detail-cover.png"), fullPage: true, caret: "initial" });

  const firstThumbnail = page.getByRole("button", { name: "Open image 1" });
  await firstThumbnail.scrollIntoViewIfNeeded();
  const thumbnailImage = firstThumbnail.getByRole("img");
  await expect(thumbnailImage).toHaveCSS("object-fit", "cover");
  await expect(thumbnailImage).toHaveCSS("object-position", "50% 50%");
  await expect(thumbnailImage.locator("..")).toHaveCSS("aspect-ratio", "1 / 1");
  await firstThumbnail.screenshot({ path: testInfo.outputPath("product-gallery-bleed.png") });
  await firstThumbnail.click();

  const dialog = page.getByRole("dialog", { name: "Image preview" });
  await expect(dialog).toBeVisible();
  const firstImage = dialog.getByRole("img", { name: "Stars and little houses" });
  await expect(firstImage).toBeVisible();
  await expect(firstImage).toHaveCSS("object-fit", "contain");
  await expect.poll(() => firstImage.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(dialog.getByText("1 of 2")).toBeVisible();

  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);

  await page.screenshot({ path: testInfo.outputPath("product-gallery-preview.png") });

  if (testInfo.project.name === "mobile") {
    const frame = dialog.getByTestId("product-gallery-preview-frame");
    await frame.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const startX = bounds.left + bounds.width * 0.8;
      const endX = bounds.left + bounds.width * 0.2;
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", clientX: startX }));
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", clientX: endX }));
    });
    await expect(dialog.getByRole("img", { name: "Sleepy flower page" })).toBeVisible();
  } else {
    await dialog.getByRole("button", { name: "Next image" }).click();
    await expect(dialog.getByText("2 of 2")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(dialog.getByRole("img", { name: "Stars and little houses" })).toBeVisible();
  }

  await dialog.getByRole("button", { name: "Close image preview" }).click();
  await expect(dialog).not.toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});
