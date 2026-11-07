import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createDemoSession, serializeDemoSession } from "@/lib/auth";
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
  const failedRequests: Array<{ url: string; method: string; resource: string; error: string }> = [];
  const failedResponses: Array<{ url: string; status: number }> = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), method: request.method(), resource: request.resourceType(), error: request.failure()?.errorText ?? "unknown" }));
  page.on("response", (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
  await page.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
  // Login/verification has its own reader E2E. This isolated local-only fixture
  // starts as the known demo administrator and exercises the actual admin UI.
  await page.context().addCookies([{ name: "ll_demo_session", value: serializeDemoSession(createDemoSession({ email: "admin@lamilialomi.test" })), url: String(info.project.use.baseURL), httpOnly: true, sameSite: "Lax" }]);
  await page.goto(`/admin/products/${productId}`);
  const manager = page.getByTestId("shared-premium-code-manager");
  const disclosure = manager.locator("xpath=ancestor::details[1]");
  if (await disclosure.count()) await disclosure.locator("summary").click();
  const enteredCode = "KDP-E2E-PRINT-2026";
  const field = manager.getByLabel("Kod do wpisania");
  const createButton = manager.getByRole("button", { name: "Utwórz kod premium i QR" });
  await expect(async () => {
    await field.fill("");
    await field.fill(enteredCode);
    await expect(createButton).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  const [created] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/admin/products/${productId}/shared-code`) && response.request().method() === "POST", { timeout: 120_000 }),
    createButton.click(),
  ]);
  expect(created.status()).toBe(200);
  const { code: { id: codeId } } = await created.json();
  const code = manager.getByLabel("Wspólny kod premium");
  await expect(code).toBeVisible();
  const stableCode = await code.innerText();
  expect(stableCode).toBe(enteredCode);
  const preview = manager.getByRole("img");
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((element) => (element as HTMLImageElement).naturalWidth), { timeout: 120_000 }).toBeGreaterThan(0);

  for (const format of ["SVG", "PDF"]) {
    const link = manager.getByRole("link", { name: `Pobierz ${format} do druku` });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href).toBe(`/api/admin/products/${productId}/shared-code?format=${format.toLowerCase()}&codeId=${codeId}`);
    const download = await page.request.get(href!);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-disposition"]).toBe(`attachment; filename="lamilialomi-kdp-${productId}-${codeId}.${format.toLowerCase()}"`);
    expect(download.headers()["content-type"]).toContain(format === "SVG" ? "image/svg+xml" : "application/pdf");
    const contents = await download.body();
    const qrProofDirectory = path.join(os.tmpdir(), "lamilialomi-premium-ux");
    fs.mkdirSync(qrProofDirectory, { recursive: true });
    fs.writeFileSync(path.join(qrProofDirectory, format === "SVG" ? "qr.svg" : "qr.pdf"), contents);
    expect(contents.length).toBeGreaterThan(100);
    const printableContent = contents.toString("utf8");
    expect(printableContent).not.toContain(enteredCode);
    expect(printableContent).not.toContain("Scan for premium");
    expect(printableContent).not.toContain("Manual code");
  }
  await manager.scrollIntoViewIfNeeded();
  const screenshot = path.join(os.tmpdir(), "lamilialomi-premium-ux", `${info.project.name === "mobile" ? "mobile" : "desktop"}-shared-manager.png`);
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  await page.locator("#product-premium-codes").screenshot({ path: screenshot, mask: [code, preview], maskColor: "#d6d3ce" });
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
  const legacy = page.locator("#product-premium-codes").getByRole("link", { name: "Pobierz SVG do druku" }).last();
  const legacyHref = await legacy.getAttribute("href");
  expect(legacyHref).not.toContain(codeId);
  expect((await page.request.get(legacyHref!)).status()).toBe(200);

  page.once("dialog", (dialog) => dialog.accept());
  await reloaded.getByRole("button", { name: "Usuń wspólny kod" }).click();
  await reloaded.getByLabel("Kod do wpisania").fill("KDP-NEW-PRINT-2026");
  await reloaded.getByRole("button", { name: "Utwórz kod premium i QR" }).click();
  await expect(reloaded.getByLabel("Wspólny kod premium")).toHaveText("KDP-NEW-PRINT-2026");
  expect((await page.request.get(`/api/admin/products/${productId}/shared-code?format=svg&codeId=${codeId}`)).status()).toBe(404);
  await info.attach("shared-manager-browser-diagnostics", { body: JSON.stringify({ consoleErrors, failedRequests, failedResponses }), contentType: "application/json" });
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(failedResponses).toEqual([]);
});
