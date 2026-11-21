import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test, type Page, type Request } from "@playwright/test";
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

async function submitAndObserveResponse(page: Page, pathname: string, submit: () => Promise<void>, verifiedRequests: WeakSet<Request>) {
  const responsePromise = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === pathname);
  await submit();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  verifiedRequests.add(response.request());
}

test("private QR survives signup and verification; a second account and repeat scans keep access", async ({ page, context, browser }, info) => {
  const leakedRequests: string[] = [];
  const browserErrors: string[] = [];
  const failedNetworkRequests: Array<{ request: Request; requestId: number; method: string; path: string; resource: string; nextAction: boolean; error: string }> = [];
  const failedResponses: Array<{ method: string; path: string; status: number }> = [];
  const responseStatuses = new WeakMap<Request, number>();
  const requestIds = new WeakMap<Request, number>();
  const verifiedServerActions = new WeakSet<Request>();
  let requestSequence = 0;
  function observe(observed: Page) {
    observed.on("pageerror", error => browserErrors.push(error.message));
    observed.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
    observed.on("request", request => requestIds.set(request, ++requestSequence));
    observed.on("requestfailed", request => failedNetworkRequests.push({
      request,
      requestId: requestIds.get(request) ?? ++requestSequence,
      method: request.method(),
      path: new URL(request.url()).pathname,
      resource: request.resourceType(),
      nextAction: Boolean(request.headers()["next-action"]),
      error: request.failure()?.errorText ?? "unknown",
    }));
    observed.on("response", response => {
      responseStatuses.set(response.request(), response.status());
      if (response.status() >= 400) failedResponses.push({ method: response.request().method(), path: new URL(response.url()).pathname, status: response.status() });
    });
    observed.on("request", request => { if (request.url().includes(code)) leakedRequests.push("code in request URL"); });
  }
  observe(page);
  await context.clearCookies();
  await scan(page);
  await expect(page.getByTestId("product-unlock-section").getByLabel("Premium code")).toHaveValue(code);
  await submitAndObserveResponse(page, `/en/products/${slug}`, () => page.getByRole("button", { name: "Create account", exact: true }).click(), verifiedServerActions);
  await expect(page).toHaveURL(/\/en\/register\?/, { timeout: 120_000 });
  await page.getByLabel("Email").fill(`kdp-${info.project.name}@example.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("checkbox", { name: /Terms/ }).check();
  await submitAndObserveResponse(page, "/en/register", () => page.getByRole("button", { name: "Create account", exact: true }).click(), verifiedServerActions);
  await submitAndObserveResponse(page, `/en/products/${slug}`, () => page.getByRole("button", { name: "Mark demo email as verified" }).click(), verifiedServerActions);
  await expect(page.getByTestId("unlock-success-state")).toBeVisible();
  const rescannedPage = await context.newPage();
  observe(rescannedPage);
  await scan(rescannedPage);
  await expect(rescannedPage.getByTestId("unlock-success-state")).toBeVisible();
  const filename = path.resolve("docs/verification/pr-102", `${info.project.name}-unlocked.png`);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  await rescannedPage.screenshot({ path: filename, fullPage: false });
  const secondContext = await browser.newContext({ baseURL: String(info.project.use.baseURL) });
  const secondPage = await secondContext.newPage();
  observe(secondPage);
  await secondPage.goto(`/en/products/${slug}#premium`);
  await secondPage.getByTestId("product-unlock-section").getByLabel("Premium code").fill(code);
  await submitAndObserveResponse(secondPage, `/en/products/${slug}`, () => secondPage.getByRole("button", { name: "Log in", exact: true }).click(), verifiedServerActions);
  await expect(secondPage).toHaveURL(/\/en\/login\?/, { timeout: 120_000 });
  await secondPage.getByLabel("Email").fill(`kdp-second-${info.project.name}@example.test`);
  await secondPage.getByLabel("Password").fill("password123");
  await submitAndObserveResponse(secondPage, "/en/login", () => secondPage.getByRole("button", { name: "Continue", exact: true }).click(), verifiedServerActions);
  await expect(secondPage.getByTestId("unlock-success-state")).toBeVisible();
  expect(leakedRequests).toEqual([]);
  const downloadUrl = await secondPage.locator('a[href*="/api/downloads/asset-moon-premium-pdf"]').first().getAttribute("href");
  expect(downloadUrl).toBeTruthy();
  const download = await secondContext.request.get(downloadUrl!, { headers: { accept: "application/json" } });
  expect(download.status()).toBe(200);
  const exactActionPaths = new Set([`/en/products/${slug}`, "/en/register", "/en/login"]);
  const expectedServerActionCancellations = failedNetworkRequests.filter((failure) =>
    failure.error === "net::ERR_ABORTED" &&
    failure.method === "POST" &&
    failure.resource === "fetch" &&
    failure.nextAction &&
    exactActionPaths.has(failure.path) &&
    responseStatuses.get(failure.request) === 200 &&
    verifiedServerActions.has(failure.request),
  );
  const unexpectedFailedNetworkRequests = failedNetworkRequests.filter((failure) => !expectedServerActionCancellations.includes(failure));
  const sanitizedFailures = (failures: typeof failedNetworkRequests) => failures.map((failure) =>
    Object.fromEntries(Object.entries(failure).filter(([key]) => key !== "request")),
  );
  await info.attach("kdp-browser-diagnostics", { body: JSON.stringify({ testedSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), runId: process.env.LAMILIA_BROWSER_RUN_ID ?? `kdp-reader-${info.project.name}-${Date.now()}`, browserErrors, failedNetworkRequests: sanitizedFailures(failedNetworkRequests), expectedServerActionCancellations: sanitizedFailures(expectedServerActionCancellations), unexpectedFailedNetworkRequests: sanitizedFailures(unexpectedFailedNetworkRequests), failedResponses, leakedCodeInUrls: leakedRequests.length }), contentType: "application/json" });
  expect(browserErrors).toEqual([]);
  expect(unexpectedFailedNetworkRequests).toEqual([]);
  expect(failedResponses).toEqual([]);
});
