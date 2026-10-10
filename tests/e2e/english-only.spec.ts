import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

test("public pages use English only and retired locale links reach English", async ({ page }, testInfo) => {
  const browserRunId = process.env.LAMILIA_BROWSER_RUN_ID ?? `issue-42-${Date.now()}`;
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

  const screenshotName = testInfo.project.name === "mobile"
    ? "english-home-mobile.png"
    : "english-home-desktop.png";
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({
    path: path.join(screenshotDirectory, screenshotName),
    fullPage: true,
    animations: "disabled",
  });
  console.log(`BROWSER_EVIDENCE runId=${browserRunId} screenshot=${screenshotName}`);

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

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
