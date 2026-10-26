import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { resetLocalPremiumCodeFixture } from "./local-premium-code-fixture";
import { isLocalDemoAppTarget } from "./local-target";

const productSlug = "moon-garden-coloring-book";
const premiumAssetId = "asset-moon-premium-pdf";
const secondProductSlug = "bedtime-forest-picture-book";
const browserRunId = process.env.LAMILIA_BROWSER_RUN_ID ?? `pr-45-unlock-${Date.now()}`;
const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
let restorePremiumCodeFixture: (() => void) | undefined;
const diagnosticsByPage = new WeakMap<Page, {
  startedAt: number;
  consoleErrors: string[];
  failedNetworkRequests: Array<{
    method: string;
    url: string;
    error: string | null;
    resourceType: string;
    isNavigationRequest: boolean;
    hasNextActionHeader: boolean;
    elapsedMs: number;
  }>;
  failedResponses: Array<{ method: string; url: string; status: number }>;
}>();

// This suite exercises local demo accounts and fixed email addresses. Keep it
// away from externally configured Playwright targets.
test.describe("Local demo unlock funnel", () => {
  test.beforeEach(async ({ page }) => {
    const diagnostics = {
      startedAt: Date.now(),
      consoleErrors: [] as string[],
      failedNetworkRequests: [] as Array<{
        method: string;
        url: string;
        error: string | null;
        resourceType: string;
        isNavigationRequest: boolean;
        hasNextActionHeader: boolean;
        elapsedMs: number;
      }>,
      failedResponses: [] as Array<{ method: string; url: string; status: number }>,
    };
    diagnosticsByPage.set(page, diagnostics);
    page.on("console", (message) => {
      if (message.type() === "error") diagnostics.consoleErrors.push(redactBrowserText(message.text()));
    });
    page.on("requestfailed", (request) => {
      diagnostics.failedNetworkRequests.push({
        method: request.method(),
        url: safeBrowserUrl(request.url()),
        error: request.failure()?.errorText ?? null,
        resourceType: request.resourceType(),
        isNavigationRequest: request.isNavigationRequest(),
        hasNextActionHeader: Boolean(request.headers()["next-action"]),
        elapsedMs: Date.now() - diagnostics.startedAt,
      });
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        diagnostics.failedResponses.push({
          method: response.request().method(),
          url: safeBrowserUrl(response.url()),
          status: response.status(),
        });
      }
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    const diagnostics = diagnosticsByPage.get(page);
    if (!diagnostics) return;
    console.log(
      `PR45_BROWSER_DIAGNOSTICS ${JSON.stringify({
        testedSha,
        runId: browserRunId,
        project: testInfo.project.name,
        test: testInfo.title,
        consoleErrors: diagnostics.consoleErrors,
        failedNetworkRequests: diagnostics.failedNetworkRequests,
        failedResponses: diagnostics.failedResponses,
      })}`,
    );
  });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
      "The unlock-funnel suite uses fixed demo data and requires a loopback app running the local demo backend.",
    );
  });

  test.beforeEach(async ({ page }, testInfo) => {
    if (await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)) {
      restorePremiumCodeFixture = await resetLocalPremiumCodeFixture(testInfo.project.use.baseURL);
    }
  });

  test.afterEach(() => {
    restorePremiumCodeFixture?.();
    restorePremiumCodeFixture = undefined;
  });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ll_cookie_consent",
      JSON.stringify({ essential: true, analytics: false }),
    );
  });
});

function safeBrowserUrl(value: string) {
  const url = new URL(value);
  for (const key of ["code", "token", "password", "key", "email"]) {
    if (url.searchParams.has(key)) url.searchParams.set(key, "[REDACTED]");
  }
  return `${url.origin}${url.pathname}${url.search}`;
}

function redactBrowserText(value: string) {
  return value.replace(/([?&](?:code|token|password|key|email)=)[^&\s]*/gi, "$1[REDACTED]");
}

test("legacy QR links keep product context and land on English", async ({ page }) => {
  const response = await page.goto(`/pl/unlock/${productSlug}?code=LOMI-BOOK-2026`);

  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium`));
  expect(page.url()).not.toContain("code=");
  await expect(page.getByRole("heading", { name: "Moon Garden Coloring Book" })).toBeVisible();
  await expect(page.getByTestId("unlock-guest-state")).toBeVisible();
  await expect(page.getByLabel("Premium code")).toHaveValue("LOMI-BOOK-2026");
});

test("guest login preserves code intent without putting code in the auth return URL", async ({ page }) => {
  await page.goto(`/en/products/${productSlug}?code=LOMI-BOOK-2026`);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(new RegExp(`/en/login\\?returnTo=`));
  expect(page.url()).not.toContain("code=");
  await page.getByLabel("Email").fill("locked@example.com");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`));
  await expect(page.getByTestId("product-unlock-section")).toBeInViewport();
  expect(page.url()).not.toContain("code=");
  await expect(page.getByLabel("Premium code")).toHaveValue("LOMI-BOOK-2026");
  await page.reload();
  await expect(page.getByLabel("Premium code")).toHaveValue("LOMI-BOOK-2026");
});

test("generic login opens account creation without unlock context", async ({ page }) => {
  await page.goto("/en/login");

  await expect(page.getByText("Don't have an account?")).toBeVisible();
  const createAccountLink = page.getByRole("link", { name: "Create account" });
  await expect(createAccountLink).toHaveAttribute("href", "/en/register");

  await createAccountLink.click();
  await expect(page).toHaveURL(/\/en\/register$/);
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();

  await page.getByLabel("Email").fill("new-reader@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("checkbox", { name: /Terms/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
});

test("registration and verification resume the unlock journey", async ({ page }) => {
  await page.goto(`/de/unlock/${productSlug}`);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/register\\?returnTo=`));

  await page.getByLabel("Email").fill("new-reader@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("checkbox", { name: /Terms/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}`));
  await expect(page.getByTestId("unlock-verification-state")).toBeVisible();
  await page.getByRole("button", { name: "Mark demo email as verified" }).click();
  await expect(page.getByTestId("unlock-code-state")).toBeVisible();
  await page.getByLabel("Premium code").fill("  lomi-book-2026 ");
  await page.getByRole("button", { name: "Unlock premium content" }).click();

  await expect(page.getByTestId("unlock-success-state")).toBeVisible();
  await page.getByRole("link", { name: "Go to My Library" }).click();
  await expect(page).toHaveURL(/\/en\/library/);
  await expect(page.getByRole("heading", { name: "My Library" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Moon Garden Coloring Book/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: /Moon Garden Coloring Book/ })).toBeVisible();
});

test("verified owner reaches Library and downloads only through the authorized route", async ({ page }) => {
  await page.goto(`/en/unlock/${productSlug}`);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByLabel("Email").fill("locked@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Premium code").fill("lomi-book-2026");
  await page.getByLabel("Premium code").press("Enter");
  await expect(page.getByTestId("unlock-success-state")).toBeVisible();

  await page.getByRole("link", { name: "Go to My Library" }).click();
  await expect(page.getByRole("heading", { name: "My Library" })).toBeVisible();
  await page.getByRole("link", { name: /Moon Garden Coloring Book/ }).click();
  const directDownloadResponse = await page.request.get(
    `/api/downloads/${premiumAssetId}?locale=en&returnTo=%2Fen%2Fproducts%2F${productSlug}`,
  );
  expect(directDownloadResponse.status()).toBe(403);

  const downloadLink = page.locator(`a[href*="/api/downloads/${premiumAssetId}"]`);
  await expect(downloadLink).toHaveAttribute("href", /expires=.*token=/);
  const downloadHref = await downloadLink.getAttribute("href");
  expect(downloadHref).toBeTruthy();
  const downloadResponse = await page.request.get(downloadHref!);

  expect(downloadResponse.status()).toBe(200);
  expect(downloadResponse.headers()["content-disposition"]).toContain("moon-garden-bonus.pdf");
  expect((await downloadResponse.body()).subarray(0, 4).toString()).toBe("%PDF");

  const publicFileResponse = await page.request.get("/demo-premium/moon-garden-bonus.pdf");
  expect(publicFileResponse.status()).toBe(404);
});

test("invalid code is recoverable and already unlocked is a positive state", async ({ page }) => {
  await page.goto(`/en/login?returnTo=/en/products/${productSlug}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("unlock-success-state")).toBeVisible();

  await page.context().clearCookies();
  await page.goto(`/en/unlock/${productSlug}`);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByLabel("Email").fill("locked@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Premium code").fill("NOT-REAL");
  await expect(page.getByRole("link", { name: /Download premium file/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Unlock premium content" }).click();
  await expect(page.locator("#premium-code-error")).toHaveText(/couldn't find a valid code/i);
});

test("empty Library state is actionable for an authenticated locked reader", async ({ page }) => {
  await page.goto("/en/login?returnTo=/en/library");
  await page.getByLabel("Email").fill("locked@example.com");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByTestId("library-empty-state")).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse products" })).toBeVisible();
});

test("unknown QR product, guest download, and external return targets are controlled", async ({ page }) => {
  const unknown = await page.goto("/en/unlock/not-a-product");
  expect(unknown?.status()).toBe(404);

  const guestDownload = await page.request.get(`/api/downloads/${premiumAssetId}?locale=en&returnTo=%2Fen%2Fproducts%2F${productSlug}`);
  expect(guestDownload.status()).toBe(401);
  expect((await guestDownload.json()).next).toContain("/en/login?returnTo=");

  await page.goto("/en/login?returnTo=https%3A%2F%2Fevil.example%2Fphish");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/en\/library/);
});

test("mobile unlock flow stays English and has no language selector", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/en/products/${productSlug}?code=LOMI-BOOK-2026&step=verify#premium`);
  await expect(page.getByLabel("Premium code")).toBeVisible();
  await expect(page.getByTestId("product-unlock-section")).toBeInViewport();
  await expect(page.getByLabel("Premium code")).toHaveValue("LOMI-BOOK-2026");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await expect(page.getByTestId("product-unlock-section")).toBeInViewport();
  await expect(page.locator('header [aria-label^="Language:"]')).toHaveCount(0);
  await expect(page.getByLabel("Premium code")).toHaveValue("LOMI-BOOK-2026");
  await page.reload();
  await expect(page.getByLabel("Premium code")).toHaveValue("LOMI-BOOK-2026");

  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/login\\?returnTo=`));
  expect(page.url()).not.toContain("code=");
  await expect(page).toHaveURL(new RegExp(`/en/login\\?returnTo=`));
  expect(page.url()).not.toContain("code=");
  await page.getByLabel("Email").fill("locked@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  expect(page.url()).not.toContain("code=");
  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`));
  await expect(page.getByTestId("product-unlock-section")).toBeInViewport();
  await expect(page.getByLabel("Premium code")).toHaveValue("LOMI-BOOK-2026");
});

test("mobile unlock keeps its code tied to the matching product across legacy redirects", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/products/${productSlug}?code=LOMI-BOOK-2026`);
  await page.locator("header a[aria-label]").first().waitFor({ state: "visible" });
  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`));
  await expect(page.getByLabel("Premium code")).toHaveValue("LOMI-BOOK-2026");
  await expect(page.locator('header [aria-label^="Language:"]')).toHaveCount(0);
  await page.goto(`/pl/products/${productSlug}?code=LOMI-BOOK-2026`);
  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`));
  await expect(page.getByLabel("Premium code")).toHaveValue("LOMI-BOOK-2026");

  await page.goto(`/en/products/${secondProductSlug}?step=verify`);
  await expect(page.getByLabel("Premium code")).toHaveValue("");
  await page.goto(`/de/products/${secondProductSlug}?step=verify`);
  await expect(page).toHaveURL(new RegExp(`/en/products/${secondProductSlug}\\?step=verify$`));
  await expect(page.getByLabel("Premium code")).toHaveValue("");
  await page.reload();
  await expect(page.getByLabel("Premium code")).toHaveValue("");

  await page.goto(`/en/products/${productSlug}`);
  await expect(page.getByLabel("Premium code")).toHaveValue("LOMI-BOOK-2026");
});
});
