import { expect, test } from "@playwright/test";

const productSlug = "moon-garden-coloring-book";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ll_cookie_consent",
      JSON.stringify({ essential: true, analytics: false }),
    );
  });
});

test("direct unknown Product Detail keeps the localized HTTP 404 and noindex response", async ({ page }) => {
  const response = await page.goto("/pl/products/not-a-real-product");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Nie znaleziono produktu" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Przeglądaj katalog" })).toHaveAttribute(
    "href",
    "/pl/products",
  );
  expect(await response?.headerValue("x-robots-tag")).toContain("noindex");
});

test("desktop primary navigation journey reaches Catalog, Product Detail, Library, and Login", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop navigation timing sample");

  const timings: Array<{ transition: string; clickToContentMs: number }> = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/en");
  await expect(page.getByRole("heading", { name: "LamiliaLomi", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("home-desktop.png"), fullPage: true });

  let started = Date.now();
  await page.getByRole("link", { name: "Browse catalog", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Browse LamiliaLomi books" })).toBeVisible();
  timings.push({ transition: "Home → Catalog", clickToContentMs: Date.now() - started });
  await page.screenshot({ path: testInfo.outputPath("catalog-desktop.png"), fullPage: true });

  const productCard = page.getByRole("link", { name: /Moon Garden Coloring Book/i });
  started = Date.now();
  await productCard.click();
  await expect(page.getByRole("heading", { name: "Moon Garden Coloring Book" })).toBeVisible();
  timings.push({ transition: "Catalog → Product Detail", clickToContentMs: Date.now() - started });

  const primaryNav = page.locator('nav[aria-label="Primary navigation"]:visible');
  started = Date.now();
  await primaryNav.getByRole("link", { name: "Catalog" }).click();
  await expect(page.getByRole("heading", { name: "Browse LamiliaLomi books" })).toBeVisible();
  timings.push({ transition: "Product Detail → Catalog", clickToContentMs: Date.now() - started });

  started = Date.now();
  await primaryNav.getByRole("link", { name: "My Library" }).click();
  await expect(page.getByRole("heading", { name: "My Library" })).toBeVisible();
  timings.push({ transition: "Header → Library", clickToContentMs: Date.now() - started });
  await page.screenshot({ path: testInfo.outputPath("library-desktop.png"), fullPage: true });

  started = Date.now();
  await page.locator("header").getByRole("link", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  timings.push({ transition: "Header → Login", clickToContentMs: Date.now() - started });
  await testInfo.attach("desktop-navigation-timings.json", {
    body: JSON.stringify(timings, null, 2),
    contentType: "application/json",
  });
});

test("tablet header navigation is visible and fits the viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/en/products");

  const nav = page.locator('nav[aria-label="Primary navigation"]:visible');
  await expect(nav.getByRole("link", { name: "Catalog" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "My Library" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("tablet-catalog-navigation.png"), fullPage: true });
});

test("admin sidebar navigation reaches the main resource pages with immediate active feedback", async ({ page }, testInfo) => {
  test.skip(!process.env.PLAYWRIGHT_LOCAL_DEMO, "Uses the local demo admin session only");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/pl/login?redirectTo=/admin");
  await page.getByLabel("E-mail").fill("admin@lamilialomi.test");
  await page.getByLabel("Hasło").fill("demo-password");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.getByRole("button", { name: "Kontynuuj" }).click(),
  ]);

  const routes = [
    { label: "Produkty", path: "/admin/products" },
    { label: "Kategorie", path: "/admin/categories" },
    { label: "Tagi", path: "/admin/tags" },
    { label: "Użytkownicy", path: "/admin/users" },
    { label: "Strony", path: "/admin/pages" },
    { label: "Ustawienia", path: "/admin/settings" },
  ];

  for (const { label, path } of routes) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
    await expect(page.getByRole("link", { name: label, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    if (label === "Produkty") {
      await page.screenshot({ path: testInfo.outputPath("admin-products.png"), fullPage: true });
    }
  }
});

test("product navigation keeps semantic keyboard behavior and reaches the full destination", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/en/products");
  const productCard = page.getByRole("link", { name: /Moon Garden Coloring Book/i });
  await expect(productCard).toBeVisible();
  await productCard.focus();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}$`));
  await expect(page.getByRole("heading", { name: "Moon Garden Coloring Book" })).toBeVisible();
  await expect(page.getByTestId("product-unlock-section")).toBeVisible();
  await expect(page.getByTestId("unlock-guest-state")).toBeVisible();
  expect(pageErrors).toEqual([]);

  await page.screenshot({ path: testInfo.outputPath("product-detail-final.png"), fullPage: true });
});

test("a slow Product Detail request shows inline pending feedback and then the final destination", async ({ page }, testInfo) => {
  let signalRequestStarted!: () => void;
  let releaseRequest!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    signalRequestStarted = resolve;
  });
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const interceptedRequests: string[] = [];

  await page.route(`**/en/products/${productSlug}**`, async (route) => {
    const request = route.request();
    if (request.headers().rsc === "1") {
      interceptedRequests.push(request.url());
      signalRequestStarted();
      await requestGate;
    }
    await route.continue();
  });

  await page.goto("/en/products");
  const productCard = page.getByRole("link", { name: /Moon Garden Coloring Book/i });
  await expect(productCard).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("catalog.png"), fullPage: true });
  try {
    await productCard.click();
    await requestStarted;

    const pendingIndicator = productCard.getByTestId("product-card-pending");
    await expect(pendingIndicator).toHaveAttribute("data-pending", "true");
    await expect(pendingIndicator).toHaveCSS("opacity", "1");
    await expect(page.getByRole("heading", { name: "Browse LamiliaLomi books" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("catalog-product-link-pending.png"), fullPage: true });

    releaseRequest();
    await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}$`));
    await expect(page.getByRole("heading", { name: "Moon Garden Coloring Book" })).toBeVisible();
    await expect(page.getByTestId("product-detail-loading")).toHaveCount(0);
    expect(interceptedRequests.length).toBeGreaterThan(0);
  } finally {
    releaseRequest();
  }
});

test("mobile primary navigation exposes Catalog and Library without horizontal overflow", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const sameOriginFailures: string[] = [];
  let appOrigin = "";
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      consoleErrors.push(`${location.url}:${location.lineNumber} ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (appOrigin && new URL(request.url()).origin === appOrigin) {
      sameOriginFailures.push(`${request.method()} ${request.url()}`);
    }
  });
  page.on("response", (response) => {
    const responseUrl = new URL(response.url());
    if (response.status() >= 400 && appOrigin && responseUrl.origin === appOrigin) {
      sameOriginFailures.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en");
  appOrigin = new URL(page.url()).origin;
  const nav = page.locator('nav[aria-label="Primary navigation"]:visible');
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Catalog" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "My Library" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await testInfo.attach("mobile-navigation-browser-errors.log", {
    body: [
      "Console errors:",
      ...consoleErrors,
      "Uncaught page errors:",
      ...pageErrors,
      "Same-origin failed or error responses:",
      ...sameOriginFailures,
    ].join("\n"),
    contentType: "text/plain",
  });
  await page.screenshot({ path: testInfo.outputPath("mobile-home-navigation.png"), fullPage: true });
  await nav.getByRole("link", { name: "My Library" }).click();
  await expect(page).toHaveURL(/\/en\/library$/);
  await expect(page.getByRole("heading", { name: "My Library" })).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(sameOriginFailures).toEqual([]);
});
