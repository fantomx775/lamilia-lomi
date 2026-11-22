import { primaryNavigation } from "./helpers/navigation";
import { hideLocalNextDevPortalIfBlocking } from "./helpers/hide-local-next-dev-portal";
import { expect, test } from "@playwright/test";

const navigationTestBaseUrl = new URL(
  process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
);
const usesLocalNavigationTestServer = ["127.0.0.1", "localhost", "[::1]"].includes(
  navigationTestBaseUrl.hostname,
);

test("Native Catalog GET returns complete content after the local data delay", async ({ page }, testInfo) => {
  const catalogDelayMs = Number(process.env.LAMILIA_TEST_CATALOG_LOADING_DELAY_MS);
  test.skip(
    !Number.isSafeInteger(catalogDelayMs) || catalogDelayMs < 1 || catalogDelayMs > 5_000 || !usesLocalNavigationTestServer,
    "Requires a valid local demo catalog delay",
  );
  const browser = page.context().browser();
  expect(browser).not.toBeNull();
  const isMobile = testInfo.project.name === "mobile";
  const context = await browser!.newContext({
    baseURL: navigationTestBaseUrl.origin,
    javaScriptEnabled: false,
    viewport: isMobile ? { width: 412, height: 839 } : { width: 1440, height: 900 },
    deviceScaleFactor: isMobile ? 2.625 : 1,
    isMobile,
    hasTouch: isMobile,
  });
  const nativePage = await context.newPage();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const sameOriginHttpErrors: Array<{ path: string; status: number }> = [];
  nativePage.on("pageerror", () => pageErrors.push("page-error"));
  nativePage.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push("console-error");
  });
  nativePage.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === navigationTestBaseUrl.origin && response.status() >= 400) {
      sameOriginHttpErrors.push({ path: url.pathname, status: response.status() });
    }
  });

  try {
    const startedAt = Date.now();
    const response = await nativePage.goto("/en/products", { waitUntil: "domcontentloaded" });
    const documentReadyMs = Date.now() - startedAt;
    expect(response?.status()).toBe(200);
    expect(documentReadyMs).toBeGreaterThanOrEqual(catalogDelayMs - 100);
    await expect(nativePage).toHaveURL(/\/en\/products$/);
    await expect(nativePage.getByRole("heading", { name: "Browse LamiliaLomi books" })).toBeVisible();
    await expect(nativePage.getByTestId("product-catalog-grid")).toBeVisible();
    await expect(nativePage.getByTestId("product-catalog-opening")).toHaveCount(0);
    await expect(nativePage.getByTestId("product-catalog-loading")).toHaveCount(0);
    const catalogForms = await nativePage.locator('form[data-testid^="catalog-"]').evaluateAll((elements) =>
      elements.map((element) => {
        const form = element as HTMLFormElement;
        const action = new URL(form.action);
        return { method: form.method, origin: action.origin, pathname: action.pathname };
      }),
    );
    expect(catalogForms).toHaveLength(3);
    expect(catalogForms.every((form) =>
      form.method === "get" && form.origin === navigationTestBaseUrl.origin && form.pathname === "/en/products",
    )).toBe(true);
    await expect(nativePage.locator('input[aria-label="Search catalog"]:visible')).toHaveCount(1);
    const search = nativePage.locator('input[aria-label="Search catalog"]:visible');
    await search.fill("Moon Garden Coloring Book");
    const submittedResponsePromise = nativePage.waitForNavigation({ waitUntil: "domcontentloaded" });
    await search.press("Enter");
    const submittedResponse = await submittedResponsePromise;
    expect(submittedResponse?.status()).toBe(200);
    const submittedUrl = new URL(nativePage.url());
    expect(submittedUrl.origin).toBe(navigationTestBaseUrl.origin);
    expect(submittedUrl.pathname).toBe("/en/products");
    expect(submittedUrl.searchParams.get("q")).toBe("Moon Garden Coloring Book");
    await expect(nativePage.getByTestId("product-catalog-grid")).toContainText("Moon Garden Coloring Book");
    await expect(nativePage.getByTestId("product-catalog-grid").locator(":scope > *")).toHaveCount(1);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(sameOriginHttpErrors).toEqual([]);
    await nativePage.screenshot({
      path: testInfo.outputPath("catalog-native-get-complete.png"),
      fullPage: false,
      animations: "disabled",
    });
    await testInfo.attach("catalog-native-get-diagnostics.json", {
      body: JSON.stringify({
        documentReadyMs,
        configuredLocalDelayMs: catalogDelayMs,
        javaScriptEnabled: false,
        completeCatalogGrid: true,
        nativeGetForms: catalogForms.length,
        nativeGetSearchSubmission: true,
        pageErrors,
        consoleErrors,
        sameOriginHttpErrors,
      }, null, 2),
      contentType: "application/json",
    });
  } finally {
    await context.close();
  }
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
    const essentialOnly = page.getByRole("button", { name: "Essential only", exact: true });
    await hideLocalNextDevPortalIfBlocking(page, essentialOnly);
    await essentialOnly.click();
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
    const productHref = await product.getAttribute("href");
    expect(productHref).not.toBeNull();
    const productUrl = new URL(productHref!, page.url());
    const catalogContext = productUrl.searchParams.get("catalog");
    expect(productUrl.pathname).toBe("/en/products/moon-garden-coloring-book");
    expect(catalogContext).not.toBeNull();
    const catalogUrl = new URL(catalogContext!, page.url());
    expect(catalogUrl.pathname).toBe("/en/products");
    expect(catalogUrl.hash).toBe(`#${await product.evaluate((link) => link.closest("article")?.id ?? "")}`);
    await product.click();
    await expect(page).toHaveURL((url) => url.pathname === productUrl.pathname && url.searchParams.get("catalog") === catalogContext);
    await expect(page.getByRole("heading", { name: "Moon Garden Coloring Book" })).toBeVisible();
    await capture("product-detail.png");

    const backToCatalog = page.getByRole("link", { name: "Back to catalog" });
    await expect(backToCatalog).toHaveAttribute("href", catalogContext!);
    await backToCatalog.click();
    await expect(page).toHaveURL((url) => url.pathname === catalogUrl.pathname && url.search === catalogUrl.search && url.hash === catalogUrl.hash);
    await expect(page.getByRole("heading", { name: "Browse LamiliaLomi books" })).toBeVisible();

    const header = await primaryNavigation(page);
    await header.getByRole("link", { name: "My Library" }).click();
    await expect(page.getByTestId("library-guest-state")).toBeVisible();
    await capture("library.png");

    await page.locator("header").getByRole("link", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
    await capture("login.png");
    await page.getByRole("link", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
    await capture("register.png");

    const responsiveNav = await primaryNavigation(page);
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
    const essentialOnly = page.getByRole("button", { name: "Essential only", exact: true });
    await hideLocalNextDevPortalIfBlocking(page, essentialOnly);
    await essentialOnly.click();
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
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
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
