import { expect, test } from "@playwright/test";

test("product gallery opens a full-size image preview and supports navigation", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/en/products/moon-garden-coloring-book");
  await expect(page.getByRole("heading", { name: "Inside the book" })).toBeVisible();
  await page.getByRole("button", { name: "Open image 1" }).click();

  const dialog = page.getByRole("dialog", { name: "Image preview" });
  await expect(dialog).toBeVisible();
  const firstImage = dialog.getByRole("img", { name: "Stars and little houses" });
  await expect(firstImage).toBeVisible();
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
});
