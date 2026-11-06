import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { resetLocalPremiumCodeFixture } from "./local-premium-code-fixture";
import { isLocalDemoAppTarget } from "./local-target";

const productId = "11111111-1111-4111-8111-111111111111";
const code = "LOMI-BOOK-2026";
const slug = "moon-garden-coloring-book";
let restore: (() => void) | undefined;
test.setTimeout(300_000);

test.beforeEach(async ({ page }, info) => {
  test.skip(!(await isLocalDemoAppTarget(page, info.project.use.baseURL)), "Requires the isolated local demo backend.");
  restore = await resetLocalPremiumCodeFixture(info.project.use.baseURL);
  const filename = path.resolve("data/lamilialomi-content.local.json");
  const content = JSON.parse(fs.readFileSync(filename, "utf8"));
  const fixture = content.products.find((item: { id: string }) => item.id === productId).premiumCodes.find((item: { code: string }) => item.code === code);
  fixture.codeType = "shared";
  fixture.redeemedByUsers = [];
  fs.writeFileSync(filename, JSON.stringify(content));
});
test.afterEach(() => { restore?.(); restore = undefined; });

async function scan(page: Page) {
  await page.goto(`/en/unlock/${productId}#code=${code}&productId=${productId}`);
  await expect(page).toHaveURL(new RegExp(`/en/products/${slug}(?:\\?[^#]*)?#premium$`));
  await expect(page).not.toHaveURL(/LOMI-BOOK-2026/);
}

test("private QR survives signup and verification; a second account and repeat scans keep access", async ({ page, context }, info) => {
  const leakedRequests: string[] = [];
  page.on("request", request => {
    if (request.url().includes(code)) leakedRequests.push(request.url());
  });
  await context.clearCookies();
  await scan(page);
  await expect(page.getByTestId("product-unlock-section").getByLabel("Premium code")).toHaveValue(code);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/register\?/, { timeout: 120_000 });
  await page.getByLabel("Email").fill(`kdp-${info.project.name}@example.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("checkbox", { name: /Terms/ }).check();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("button", { name: "Mark demo email as verified" }).click();
  await expect(page.getByTestId("unlock-success-state")).toBeVisible();
  await scan(page);
  await expect(page.getByTestId("unlock-success-state")).toBeVisible();
  const filename = path.resolve("docs/verification/pr-102", `${info.project.name}-unlocked.png`);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  await page.screenshot({ path: filename, fullPage: false });
  await context.clearCookies();
  await page.goto(`/en/products/${slug}#premium`);
  await page.getByTestId("product-unlock-section").getByLabel("Premium code").fill(code);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/login\?/, { timeout: 120_000 });
  await page.getByLabel("Email").fill(`kdp-second-${info.project.name}@example.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("unlock-success-state")).toBeVisible();
  expect(leakedRequests).toEqual([]);
  const downloadUrl = await page.locator('a[href*="/api/downloads/asset-moon-premium-pdf"]').first().getAttribute("href");
  expect(downloadUrl).toBeTruthy();
  const download = await page.request.get(downloadUrl!, { headers: { accept: "application/json" } });
  expect(download.status()).toBe(200);
});
