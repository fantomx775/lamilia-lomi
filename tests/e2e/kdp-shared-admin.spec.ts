import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { resetLocalPremiumCodeFixture } from "./local-premium-code-fixture";
import { isLocalDemoAppTarget } from "./local-target";

const productId = "11111111-1111-4111-8111-111111111111";
let restore: (() => void) | undefined;
test.setTimeout(300_000);

test.beforeEach(async ({ page }, info) => {
  test.skip(!(await isLocalDemoAppTarget(page, info.project.use.baseURL)), "Requires isolated local demo backend.");
  restore = await resetLocalPremiumCodeFixture(info.project.use.baseURL);
  const filename = path.resolve("data/lamilialomi-content.local.json");
  const content = JSON.parse(fs.readFileSync(filename, "utf8"));
  const product = content.products.find((item: { id: string }) => item.id === productId);
  product.premiumCodes = product.premiumCodes.filter((code: { codeType?: string }) => code.codeType !== "shared");
  fs.writeFileSync(filename, JSON.stringify(content));
});
test.afterEach(() => { restore?.(); restore = undefined; });

test("admin creates a permanent shared code, downloads print files, toggles and reloads without rotating", async ({ page }, info) => {
  await page.setViewportSize({ width: info.project.name === "mobile" ? 390 : 1440, height: info.project.name === "mobile" ? 844 : 1100 });
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("requestfailed", (request) => { if (request.failure()?.errorText !== "net::ERR_ABORTED") failedRequests.push(request.url()); });
  await page.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
  await page.goto("/en/login?redirectTo=/admin");
  await page.getByLabel("Email").fill("admin@lamilialomi.test");
  await page.getByLabel("Password").fill("demo-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect.poll(async () => {
    const cookie = (await page.context().cookies()).find((item) => item.name === "ll_demo_session");
    return cookie ? JSON.parse(Buffer.from(cookie.value.split(".")[0], "base64url").toString("utf8")).role : null;
  }).toBe("admin");
  await page.goto(`/admin/products/${productId}`);
  const manager = page.getByTestId("shared-premium-code-manager");
  const disclosure = manager.locator("xpath=ancestor::details[1]");
  if (await disclosure.count()) await disclosure.locator("summary").click();
  await manager.getByRole("button", { name: "Utwórz stały wspólny kod" }).click();
  const code = manager.getByLabel("Wspólny kod premium");
  await expect(code).toBeVisible();
  const stableCode = await code.innerText();
  expect(stableCode.length).toBeGreaterThan(20);
  const preview = manager.getByRole("img");
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  for (const format of ["SVG", "PDF"]) {
    const downloadPromise = page.waitForEvent("download");
    await manager.getByRole("link", { name: `Pobierz ${format} do druku` }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`lamilialomi-kdp-${productId}.${format.toLowerCase()}`);
    expect(await download.failure()).toBeNull();
  }
  await manager.scrollIntoViewIfNeeded();
  const screenshot = path.resolve("docs/verification/pr-102", `${info.project.name === "mobile" ? "mobile" : "desktop"}-shared-manager.png`);
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await manager.getByRole("button", { name: "Dezaktywuj wspólny kod" }).click();
  await expect(manager.getByRole("img")).toHaveCount(0);
  await manager.getByRole("button", { name: "Aktywuj ponownie ten sam kod" }).click();
  await expect(manager.getByLabel("Wspólny kod premium")).toHaveText(stableCode);
  await expect(manager.getByRole("img")).toBeVisible();
  await page.reload();
  const reloaded = page.getByTestId("shared-premium-code-manager");
  const reloadedDisclosure = reloaded.locator("xpath=ancestor::details[1]");
  if (await reloadedDisclosure.count()) await reloadedDisclosure.locator("summary").click();
  await expect(reloaded.getByLabel("Wspólny kod premium")).toHaveText(stableCode);
  await expect(reloaded.getByRole("button", { name: "Dezaktywuj wspólny kod" })).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
