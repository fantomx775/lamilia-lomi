import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

test("public pages use English only and retired locale links reach English", async ({ page }, testInfo) => {
  const browserRunId = process.env.LAMILIA_BROWSER_RUN_ID ?? `issue-42-${Date.now()}`;
  const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const screenshotDirectory = path.resolve(process.cwd(), "docs", "verification", "issue-42");
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  fs.mkdirSync(screenshotDirectory, { recursive: true });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/en$/);
  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Catalog" })).toBeVisible();
  await expect(header.getByRole("link", { name: "My Library" })).toBeVisible();
  await expect(header.getByText("Dzieci", { exact: true })).toHaveCount(0);
  await expect(header.getByText("PL", { exact: true })).toHaveCount(0);
  await expect(header.getByText("DE", { exact: true })).toHaveCount(0);
  await expect(header.getByText("ES", { exact: true })).toHaveCount(0);
  await expect(header.locator('[aria-label^="Language:"]')).toHaveCount(0);
  await expect(page.getByText("Kids", { exact: true }).first()).toBeVisible();

  for (const locale of ["pl", "de", "es"]) {
    const response = await page.request.get(`/${locale}/products?q=moon`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(308);
    const target = new URL(response.headers().location!, page.url());
    expect(target.pathname + target.search).toBe("/en/products?q=moon");
  }

  await page.goto("/pl/login?campaign=spring&returnTo=%2Fde%2Fproducts%2Fmoon-garden-coloring-book");
  await expect(page).toHaveURL(/\/en\/login\?/);
  const loginUrl = new URL(page.url());
  expect(loginUrl.searchParams.get("campaign")).toBe("spring");
  expect(loginUrl.searchParams.get("returnTo")).toBe(
    "/en/products/moon-garden-coloring-book",
  );

  const legacyUnlock = await page.request.get(
    "/api/unlock/es/moon-garden-coloring-book?code=demo",
    { maxRedirects: 0 },
  );
  expect(legacyUnlock.status()).toBe(308);
  const unlockTarget = new URL(legacyUnlock.headers().location!, page.url());
  expect(unlockTarget.pathname + unlockTarget.search).toBe(
    "/api/unlock/en/moon-garden-coloring-book?code=demo",
  );

  const sitemap = await page.request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  const sitemapXml = await sitemap.text();
  expect(sitemapXml).toContain("/en/products/moon-garden-coloring-book");
  expect(sitemapXml).not.toMatch(/\/(?:pl|de|es)\//);

  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("localized-page-loading")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "LamiliaLomi", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Real product paths from the first screen", level: 2 })).toBeVisible();
  const firstProductCard = page
    .locator('main a[href^="/en/products/"]')
    .filter({ has: page.locator("h3") })
    .first();
  await expect(firstProductCard).toBeVisible();
  await expect(firstProductCard.locator("h3")).toHaveText(/\S/);
  const firstProductImage = firstProductCard.locator("img").first();
  await firstProductImage.scrollIntoViewIfNeeded();
  await expect.poll(
    () => firstProductImage.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    { timeout: 15_000 },
  ).toBeGreaterThan(0);

  // Full-page screenshots do not always trigger native lazy loading for images
  // below the viewport. Load each image before capturing the evidence so the
  // committed screenshot shows the same cover cards as the tested page.
  await page.locator("img").evaluateAll(async (images) => {
    const imageElements = images.filter(
      (image): image is HTMLImageElement => image instanceof HTMLImageElement,
    );
    for (const image of imageElements) {
      image.scrollIntoView({ block: "center" });
      if (!image.complete) {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(
            () => reject(new Error(`Timed out loading screenshot image: ${image.currentSrc}`)),
            15_000,
          );
          image.addEventListener("load", () => {
            window.clearTimeout(timeout);
            resolve();
          }, { once: true });
          image.addEventListener("error", () => {
            window.clearTimeout(timeout);
            reject(new Error(`Failed to load screenshot image: ${image.currentSrc}`));
          }, { once: true });
        });
      }
      if (image.naturalWidth === 0) {
        throw new Error(`Screenshot image has no natural width: ${image.currentSrc}`);
      }
    }
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const screenshotName = testInfo.project.name === "mobile"
    ? "english-home-mobile.png"
    : "english-home-desktop.png";
  await page.screenshot({
    path: path.join(screenshotDirectory, screenshotName),
    fullPage: true,
    animations: "disabled",
  });
  console.log(
    `PR45_BROWSER_SCREENSHOT ${JSON.stringify({
      testedSha,
      runId: browserRunId,
      path: `docs/verification/issue-42/${screenshotName}`,
      project: testInfo.project.name,
    })}`,
  );

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  console.log(
    `PR45_BROWSER_DIAGNOSTICS ${JSON.stringify({
      testedSha,
      runId: browserRunId,
      project: testInfo.project.name,
      consoleErrors,
      pageErrors,
      failedNetworkRequests: failedRequests,
    })}`,
  );
});
