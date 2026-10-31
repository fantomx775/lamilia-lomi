import { devices, expect, test } from "@playwright/test";

import { isLocalDemoAppTarget } from "./local-target";

test("versioned public images reach the optimizer and galleries load at desktop DPR1/DPR2 and mobile", async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "This scenario creates its own responsive contexts.");
  test.skip(!(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)), "Read-only synthetic-image verification requires the loopback local backend.");
  const baseURL = String(testInfo.project.use.baseURL);
  const versionedSource = "/api/media/asset-moon-gallery-1?v=asset-moon-gallery-1";
  const optimizerUrl = new URL("/_next/image", baseURL);
  optimizerUrl.searchParams.set("url", versionedSource);
  optimizerUrl.searchParams.set("w", "640");
  optimizerUrl.searchParams.set("q", "75");
  const optimized = await page.request.get(optimizerUrl.toString());
  expect(optimized.status()).toBe(200);
  expect(optimized.headers()["content-type"]).toMatch(/^image\//);

  // Even an apparently public artwork ID must never enter the optimizer cache.
  optimizerUrl.searchParams.set("url", "/api/community/artworks/11111111-1111-4111-8111-111111111111/media");
  expect((await page.request.get(optimizerUrl.toString())).status()).toBe(400);

  const scenarios = [
    { name: "desktop-dpr1", options: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    { name: "desktop-dpr2", options: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
    { name: "pixel-7", options: { ...devices["Pixel 7"] } },
  ];
  for (const scenario of scenarios) {
    const context = await browser.newContext({ ...scenario.options, baseURL });
    try {
      const view = await context.newPage();
      const pageErrors: string[] = [];
      const imageFailures: number[] = [];
      view.on("pageerror", (error) => pageErrors.push(error.message));
      view.on("response", (response) => {
        if (response.request().resourceType() === "image" && response.status() >= 400) imageFailures.push(response.status());
      });
      await view.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
      await view.goto("/en/products/moon-garden-coloring-book");
      const layout = view.getByTestId("product-media-layout");
      await expect(layout).toBeVisible();
      const thumbnail = layout.locator("button img").first();
      await expect(thumbnail).toBeVisible();
      await expect.poll(() => thumbnail.evaluate((image) => image instanceof HTMLImageElement ? image.naturalWidth : 0)).toBeGreaterThan(0);
      const metrics = await thumbnail.evaluate((image) => {
        if (!(image instanceof HTMLImageElement)) throw new Error("Expected a gallery image.");
        return { cssWidth: image.getBoundingClientRect().width, dpr: devicePixelRatio,
          naturalWidth: image.naturalWidth, currentSrc: image.currentSrc };
      });
      const requestedWidth = new URL(metrics.currentSrc).searchParams.get("w");
      expect(requestedWidth ? Number(requestedWidth) : metrics.naturalWidth).toBeGreaterThanOrEqual(Math.ceil(metrics.cssWidth * metrics.dpr));
      expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await layout.screenshot({ path: testInfo.outputPath(`gallery-${scenario.name}.png`), animations: "disabled" });
      expect(pageErrors).toEqual([]);
      expect(imageFailures).toEqual([]);
    } finally { await context.close(); }
  }
});
