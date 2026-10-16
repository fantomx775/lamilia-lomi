import { expect, test } from "@playwright/test";

const navigationTestBaseUrl = new URL(
  process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
);
const usesLocalNavigationTestServer = ["127.0.0.1", "localhost", "[::1]"].includes(
  navigationTestBaseUrl.hostname,
);

test("Catalog shows its destination fallback while catalog data is pending", async ({ page }, testInfo) => {
  test.skip(
    !process.env.LAMILIA_TEST_CATALOG_LOADING_DELAY_MS || !usesLocalNavigationTestServer,
    "Requires the local demo catalog delay for a deterministic pending state",
  );

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedNetworkRequests: Array<{ url: string; errorText: string }> = [];
  const sameOriginHttpErrors: Array<{ url: string; status: number }> = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedNetworkRequests.push({
      url: request.url(),
      errorText: request.failure()?.errorText ?? "unknown",
    });
  });
  page.on("response", (response) => {
    if (
      new URL(response.url()).origin === navigationTestBaseUrl.origin &&
      response.status() >= 400
    ) {
      sameOriginHttpErrors.push({ url: response.url(), status: response.status() });
    }
  });

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ll_cookie_consent",
      JSON.stringify({ essential: true, analytics: false }),
    );
  });
  await page.goto("/en");

  const browseCatalog = page.getByRole("link", { name: "Browse catalog", exact: true });
  const startedAt = Date.now();
  await browseCatalog.click();

  const loading = page.getByTestId("product-catalog-loading");
  const catalogHeading = page.getByRole("heading", { name: "Browse LamiliaLomi books" });
  await expect(page).toHaveURL(/\/en\/products$/);
  await expect(loading).toBeVisible();
  const loadingUiMs = Date.now() - startedAt;
  await expect(catalogHeading).not.toBeVisible();
  const pendingState = await page.evaluate(() => {
    const fallback = document.querySelector<HTMLElement>("[data-testid='product-catalog-loading']");
    const heading = [...document.querySelectorAll("h1")].find((element) =>
      element.textContent?.includes("Browse LamiliaLomi books"),
    );

    return {
      fallbackOpacity: fallback ? Number(getComputedStyle(fallback).opacity) : 0,
      headingVisible: Boolean(heading && heading.getBoundingClientRect().height > 0),
      pathname: window.location.pathname,
    };
  });
  expect(pendingState.pathname).toBe("/en/products");
  expect(pendingState.fallbackOpacity).toBeGreaterThanOrEqual(0.1);
  expect(pendingState.headingVisible).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath("catalog-destination-pending.png"),
    fullPage: false,
    animations: "disabled",
    style: "nextjs-portal { display: none !important; }",
  });

  await expect(catalogHeading).toBeVisible();
  await expect(loading).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("catalog-destination-final.png"),
    fullPage: false,
    animations: "disabled",
    style: "nextjs-portal { display: none !important; }",
  });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(sameOriginHttpErrors).toEqual([]);
  const classifiedNetworkFailures = failedNetworkRequests.map((request) => {
    const requestUrl = new URL(request.url);
    const isCanceledDestinationRsc =
      request.errorText === "net::ERR_ABORTED" &&
      requestUrl.origin === navigationTestBaseUrl.origin &&
      requestUrl.pathname === "/en/products" &&
      requestUrl.searchParams.has("_rsc");

    return isCanceledDestinationRsc
      ? {
          ...request,
          disposition: "unrelated",
          reason:
            "The destination RSC request was canceled during client navigation; the Catalog URL and H1 loaded and no HTTP status error occurred.",
        }
      : {
          ...request,
          disposition: "unexpected",
          reason: "Unexpected failed request during the Catalog navigation regression.",
        };
  });
  expect(classifiedNetworkFailures.filter((request) => request.disposition !== "unrelated")).toEqual([]);
  await testInfo.attach("catalog-browser-diagnostics.json", {
    body: JSON.stringify(
      {
        pageErrors,
        consoleErrors,
        failedNetworkRequests: classifiedNetworkFailures,
        sameOriginHttpErrors,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await testInfo.attach("catalog-pending-timing.json", {
    body: JSON.stringify({ loadingUiMs, pendingState, pageErrors, consoleErrors }, null, 2),
    contentType: "application/json",
  });
});

test("primary navigation feedback keeps the storefront journey semantic and responsive", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(
      `${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? "unknown"}`,
    );
  });

  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  page.once("close", releaseRequest);
  const delayedRequests: string[] = [];
  const capture = (name: string) =>
    page.screenshot({
      path: testInfo.outputPath(name),
      fullPage: true,
      animations: "disabled",
      style: "nextjs-portal { display: none !important; }",
    });
  await page.route("**/en/products**", async (route) => {
    if (route.request().headers().rsc === "1") {
      delayedRequests.push(new URL(route.request().url()).pathname);
      await requestGate;
    }
    await route.continue();
  });

  try {
    await page.goto("/en");
    await page.getByRole("button", { name: "Essential" }).click();
    await capture("home.png");

    const browseCatalog = page.getByRole("link", { name: "Browse catalog" });
    await expect(browseCatalog).toHaveAttribute("href", "/en/products");
    await expect(browseCatalog.getByTestId("navigation-link-pending")).toHaveAttribute("data-pending", "false");
    await browseCatalog.focus();
    await expect(browseCatalog).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => delayedRequests.length).toBeGreaterThan(0);
    await expect(browseCatalog.getByTestId("navigation-link-pending")).toHaveAttribute("data-pending", "true");
    await expect(browseCatalog.getByTestId("navigation-link-pending")).toHaveCSS("opacity", "1");
    await capture("catalog-pending.png");
    releaseRequest();

    await expect(page.getByRole("heading", { name: "Browse LamiliaLomi books" })).toBeVisible();
    const product = page.getByRole("link", { name: /Moon Garden Coloring Book/i }).first();
    await product.click();
    await expect(page.getByRole("heading", { name: "Moon Garden Coloring Book" })).toBeVisible();
    await capture("product-detail.png");

    const backToCatalog = page.getByRole("link", { name: "Back to catalog" });
    await expect(backToCatalog).toHaveAttribute("href", "/en/products");
    await backToCatalog.click();
    await expect(page.getByRole("heading", { name: "Browse LamiliaLomi books" })).toBeVisible();

    const header = page.locator('nav[aria-label="Primary navigation"]:visible');
    await header.getByRole("link", { name: "My Library" }).click();
    await expect(page.getByTestId("library-guest-state")).toBeVisible();
    await capture("library.png");

    await page.locator("header").getByRole("link", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
    await capture("login.png");
    await page.getByRole("link", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
    await capture("register.png");

    const responsiveNav = page.locator('nav[aria-label="Primary navigation"]:visible');
    await expect(responsiveNav.getByRole("link", { name: "Catalog" })).toBeVisible();
    await expect(responsiveNav.getByRole("link", { name: "My Library" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
    await responsiveNav.getByRole("link", { name: "Catalog" }).click();
    await expect(page.getByRole("heading", { name: "Browse LamiliaLomi books" })).toBeVisible();
    await capture("responsive-catalog.png");

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await testInfo.attach("navigation-diagnostics.json", {
      body: JSON.stringify({ consoleErrors, failedRequests, delayedRequests }, null, 2),
      contentType: "application/json",
    });
  } finally {
    releaseRequest();
  }
});

test("admin navigation shows pending feedback for local demo admins", async ({ page }, testInfo) => {
  test.skip(!process.env.PLAYWRIGHT_LOCAL_DEMO, "Uses the local demo admin session only");

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    failedRequests.push(
      `${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? "unknown"}`,
    );
  });

  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  page.once("close", releaseRequest);
  const delayedRequests: string[] = [];
  const capture = (name: string) =>
    page.screenshot({
      path: testInfo.outputPath(name),
      fullPage: true,
      animations: "disabled",
      style: "nextjs-portal { display: none !important; }",
    });
  try {
    await page.route("**/admin/products**", async (route) => {
      if (route.request().headers().rsc === "1") {
        delayedRequests.push(new URL(route.request().url()).pathname);
        await requestGate;
      }
      await route.continue();
    });

    await page.goto("/en/login?redirectTo=/admin");
    await page.getByRole("button", { name: "Essential" }).click();
    await page.getByLabel("Email").fill("admin@lamilialomi.test");
    await page.getByLabel("Password").fill("demo-password");
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/admin"),
      page.getByRole("button", { name: "Continue" }).click(),
    ]);

    const adminNav = page.getByRole("navigation");
    const productsLink = adminNav.getByRole("link", { name: "Produkty" });
    await expect(productsLink.getByTestId("navigation-link-pending")).toHaveAttribute("data-pending", "false");
    await capture("admin-navigation.png");
    await productsLink.click();
    await expect.poll(() => delayedRequests.length).toBeGreaterThan(0);
    await expect(productsLink.getByTestId("navigation-link-pending")).toHaveAttribute("data-pending", "true");
    await capture("admin-navigation-pending.png");
    releaseRequest();
    await expect(page).toHaveURL(/\/admin\/products$/);
    await expect(page.getByRole("heading", { name: "Produkty" })).toBeVisible();
    await expect(productsLink.getByTestId("navigation-link-pending")).toHaveAttribute("data-pending", "false");
    await capture("admin-products.png");

    await page.goto("/en/login?returnTo=/en/account");
    await page.getByLabel("Email").fill("demo@lamilialomi.test");
    await page.getByLabel("Password").fill("demo-password");
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/en/account"),
      page.getByRole("button", { name: "Continue" }).click(),
    ]);
    await page.goto("/en");
    await page.locator("header").getByRole("link", { name: "Account" }).click();
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
    await capture("authenticated-account.png");

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await testInfo.attach("admin-navigation-diagnostics.json", {
      body: JSON.stringify({ consoleErrors, failedRequests, delayedRequests }, null, 2),
      contentType: "application/json",
    });
  } finally {
    releaseRequest();
  }
});
