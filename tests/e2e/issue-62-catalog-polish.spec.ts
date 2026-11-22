import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { getSeedContentSnapshot } from "../../src/lib/local-content";
import type { CatalogDesktopColumns } from "../../src/lib/types";
import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test.setTimeout(180_000);

test("catalog category recovery, full titles and configurable responsive cards", async ({ page }, testInfo) => {
  test.skip(!(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)), "Uses disposable local content only.");
  const release = await acquireLocalContentStoreLock();
  const store = path.resolve("data/lamilialomi-content.local.json");
  const original = fs.existsSync(store) ? fs.readFileSync(store) : null;
  const directory = path.resolve(process.env.ISSUE_62_EVIDENCE_DIR ?? testInfo.outputPath("screenshots"));
  const missingImage = "/api/category-media/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb?v=62626262-6262-4262-8262-626262626262";
  const longTitle = "The Wonderful Garden of Stories and Adventures for Curious Readers " + "W".repeat(60);
  const responsiveTitle = "A delightful garden adventure with secret paths, tiny creatures and fun activities";
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedResponses: { path: string; status: number; disposition: string }[] = [];
  const failedRequests: { path: string; error: string | null; disposition: string }[] = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => {
    if (response.status() >= 400) {
      const responseUrl = new URL(response.url());
      const optimizedSource = responseUrl.pathname === "/_next/image" ? responseUrl.searchParams.get("url") : null;
      failedResponses.push({
        path: responseUrl.pathname,
        status: response.status(),
        disposition: response.status() === 404 && (response.url().includes(missingImage) || optimizedSource === missingImage)
          ? "intentional-missing-image" : "unresolved",
      });
    }
  });
  page.on("requestfailed", request => failedRequests.push({
    path: new URL(request.url()).pathname,
    error: request.failure()?.errorText ?? null,
    disposition: request.failure()?.errorText === "net::ERR_ABORTED" ? "navigation-cancellation" : "unresolved",
  }));
  const screenshot = async (name: string, fullPage = true) => {
    fs.mkdirSync(directory, { recursive: true });
    await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
    await page.screenshot({ path: path.join(directory, `${testInfo.project.name}-${name}.png`), fullPage, animations: "disabled" });
  };
  try {
    const originalViewport = page.viewportSize();
    expect(originalViewport).not.toBeNull();
    const snapshot = getSeedContentSnapshot();
    const first = snapshot.products[0];
    snapshot.products = Array.from({ length: 5 }, (_, index) => {
      const product = structuredClone(snapshot.products[index % 3]);
      product.id = `62626262-6262-4262-8262-62626262626${index}`;
      product.slug = `issue-62-product-${index}`;
      product.status = "published";
      product.sortOrder = index;
      const title = index === 0 ? "Moon Garden" : index === 1 ? longTitle : index === 2 ? responsiveTitle : `Creative Stories ${index}`;
      product.translations = [{ locale: "en", title, shortDescription: "Gentle stories and creative activities for curious readers.", longDescription: "Catalog browser fixture." }];
      return product;
    });
    snapshot.categories[0].image = {
      id: "62626262-6262-4262-8262-626262626260", path: first.assets.find(asset => asset.id === first.coverAssetId)!.path,
      storagePath: "fixture/category.svg", storageProvider: "supabase", filename: "fixture.svg", contentType: "image/svg+xml", sizeBytes: 1,
    };
    snapshot.categories[1].image = { ...snapshot.categories[0].image, id: "62626262-6262-4262-8262-626262626261", path: missingImage };
    delete snapshot.categories[2].image;
    fs.mkdirSync(path.dirname(store), { recursive: true });
    await page.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
    if (testInfo.project.name === "chromium") await page.setViewportSize({ width: 1440, height: 900 });
    for (const columns of [3, 4, 5] satisfies CatalogDesktopColumns[]) {
      snapshot.catalogSettings.desktopColumns = columns;
      fs.writeFileSync(store, JSON.stringify(snapshot));
      if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto("/en/products", { waitUntil: "domcontentloaded" });
      const categories = page.getByRole("region", { name: "Categories" });
      // Category imagery is hidden on narrow phones. Use the tablet breakpoint
      // to exercise real image loading and fallback, then restore the phone size.
      for (const tile of await categories.getByRole("link").all()) await tile.scrollIntoViewIfNeeded();
      await expect(categories.getByTestId("category-image-fallback")).toHaveCount(2);
      await categories.getByRole("link").first().scrollIntoViewIfNeeded();
      await expect.poll(() => categories.locator("img").evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
      if (testInfo.project.name === "mobile") await page.setViewportSize(originalViewport!);
      const grid = page.getByTestId("product-catalog-grid");
      await expect(grid.locator("article")).toHaveCount(5);
      for (const image of await grid.locator("img").all()) {
        await image.scrollIntoViewIfNeeded();
        await expect.poll(() => image.evaluate(element => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
      }
      await grid.locator("article").first().scrollIntoViewIfNeeded();
      await expect.poll(() => grid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(testInfo.project.name === "chromium" ? columns : 1);
      const shortCard = grid.locator("article").first();
      const longCard = grid.locator("article").nth(1);
      const responsiveCard = grid.locator("article").nth(2);
      const assertCompleteTitles = async () => {
        await expect(shortCard.locator("h3[data-product-card-title]")).toHaveText("Moon Garden");
        await expect(longCard.locator("h3[data-product-card-title]")).toHaveText(longTitle);
        await expect(responsiveCard.locator("h3[data-product-card-title]")).toHaveText(responsiveTitle);
        await expect(grid.locator("details, summary")).toHaveCount(0);
        const headingsFit = await grid.locator("h3[data-product-card-title]").evaluateAll(headings =>
          headings.every(heading => heading.scrollHeight <= heading.clientHeight + 1),
        );
        expect(headingsFit).toBe(true);
      };
      await assertCompleteTitles();
      const covers = await grid.locator("a > div.relative").evaluateAll(elements => elements.map(element => {
        const bounds = element.getBoundingClientRect(); return bounds.width / bounds.height;
      }));
      expect(covers).toHaveLength(5);
      for (const ratio of covers) expect(ratio).toBeCloseTo(8.5 / 11, 2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.evaluate(() => scrollTo(0, 0));
      await screenshot(`columns-${columns}`);
    }
    if (testInfo.project.name === "mobile") {
      await page.getByTestId("product-catalog-grid").locator("article").first().scrollIntoViewIfNeeded();
      await screenshot("grid", false);
    }
    const grid = page.getByTestId("product-catalog-grid");
    const longCard = grid.locator("article").nth(1);
    await longCard.locator("h3[data-product-card-title]").scrollIntoViewIfNeeded();
    await expect(longCard.locator("h3[data-product-card-title]")).toHaveText(longTitle);
    await expect(longCard.locator("details, summary")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await screenshot("full-title", false);
    if (testInfo.project.name === "chromium") {
      const responsiveCard = grid.locator("article").nth(2);
      const responsiveHeading = responsiveCard.locator("h3");
      await page.setViewportSize({ width: 800, height: 1024 });
      await expect.poll(() => page.getByTestId("product-catalog-grid").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);
      await expect(responsiveHeading).toHaveText(responsiveTitle);
      await expect.poll(() => responsiveHeading.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
      await expect(responsiveCard.locator("details, summary")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.evaluate(() => scrollTo(0, 0));
      await screenshot("tablet");
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(responsiveHeading).toHaveText(responsiveTitle);
      await expect.poll(() => responsiveHeading.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    }
    await expect(grid.locator("details, summary")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    expect(failedResponses.filter(entry => entry.disposition === "unresolved")).toEqual([]);
    expect(failedResponses.filter(entry => entry.disposition === "intentional-missing-image").length).toBeGreaterThan(0);
    expect(failedRequests.filter(entry => entry.disposition === "unresolved")).toEqual([]);
    expect(consoleErrors.filter(message => !message.includes("404 (Not Found)"))).toEqual([]);
  } finally {
    if (original) fs.writeFileSync(store, original); else if (fs.existsSync(store)) fs.unlinkSync(store);
    release();
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${testInfo.project.name}-diagnostics.json`), JSON.stringify({ consoleErrors, pageErrors, failedResponses, failedRequests, expectedFailureReason: "A deliberately absent versioned category image exercises error recovery; no real category image was changed." }, null, 2));
  }
});
