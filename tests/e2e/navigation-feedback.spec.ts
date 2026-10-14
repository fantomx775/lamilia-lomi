import { expect, test } from "@playwright/test";

test("primary navigation feedback keeps the storefront journey semantic and responsive", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}`));

  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const delayedRequests: string[] = [];
  await page.route("**/en/products**", async (route) => {
    if (route.request().headers().rsc === "1") {
      delayedRequests.push(route.request().url());
      await requestGate;
    }
    await route.continue();
  });

  await page.goto("/en");
  await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });

  const browseCatalog = page.getByRole("link", { name: "Browse catalog" });
  await expect(browseCatalog).toHaveAttribute("href", "/en/products");
  await expect(browseCatalog.getByTestId("navigation-link-pending")).toHaveAttribute("data-pending", "false");
  await browseCatalog.focus();
  await expect(browseCatalog).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => delayedRequests.length).toBeGreaterThan(0);
  await expect(browseCatalog.getByTestId("navigation-link-pending")).toHaveAttribute("data-pending", "true");
  await expect(browseCatalog.getByTestId("navigation-link-pending")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("catalog-pending.png"), fullPage: true });
  releaseRequest();

  await expect(page.getByRole("heading", { name: "Browse LamiliaLomi books" })).toBeVisible();
  const product = page.getByRole("link", { name: /Moon Garden Coloring Book/i }).first();
  await product.click();
  await expect(page.getByRole("heading", { name: "Moon Garden Coloring Book" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("product-detail.png"), fullPage: true });

  const backToCatalog = page.getByRole("link", { name: "Back to catalog" });
  await expect(backToCatalog).toHaveAttribute("href", "/en/products");
  await backToCatalog.click();
  await expect(page.getByRole("heading", { name: "Browse LamiliaLomi books" })).toBeVisible();

  const header = page.locator('nav[aria-label="Primary navigation"]:visible');
  await header.getByRole("link", { name: "My Library" }).click();
  await expect(page.getByTestId("library-guest-state")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("library.png"), fullPage: true });

  await page.locator("header").getByRole("link", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("login.png"), fullPage: true });
  await page.getByRole("link", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("register.png"), fullPage: true });

  const responsiveNav = page.locator('nav[aria-label="Primary navigation"]:visible');
  await expect(responsiveNav.getByRole("link", { name: "Catalog" })).toBeVisible();
  await expect(responsiveNav.getByRole("link", { name: "My Library" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await responsiveNav.getByRole("link", { name: "Catalog" }).click();
  await expect(page.getByRole("heading", { name: "Browse LamiliaLomi books" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("responsive-catalog.png"), fullPage: true });

  expect(pageErrors).toEqual([]);
  await testInfo.attach("navigation-diagnostics.json", {
    body: JSON.stringify({ consoleErrors, failedRequests, delayedRequests }, null, 2),
    contentType: "application/json",
  });
});

test("admin navigation shows pending feedback for local demo admins", async ({ page }, testInfo) => {
  test.skip(!process.env.PLAYWRIGHT_LOCAL_DEMO, "Uses the local demo admin session only");
  test.skip(testInfo.project.name !== "chromium", "Admin sidebar is verified in the desktop project");

  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const delayedRequests: string[] = [];
  await page.route("**/admin/products**", async (route) => {
    if (route.request().headers().rsc === "1") {
      delayedRequests.push(route.request().url());
      await requestGate;
    }
    await route.continue();
  });

  await page.goto("/en/login?redirectTo=/admin");
  await page.getByLabel("Email").fill("admin@lamilialomi.test");
  await page.getByLabel("Password").fill("demo-password");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.getByRole("button", { name: "Continue" }).click(),
  ]);

  const adminNav = page.getByRole("navigation");
  const productsLink = adminNav.getByRole("link", { name: "Produkty" });
  await expect(productsLink.getByTestId("navigation-link-pending")).toHaveAttribute("data-pending", "false");
  await page.screenshot({ path: testInfo.outputPath("admin-navigation.png"), fullPage: true });
  await productsLink.click();
  await expect.poll(() => delayedRequests.length).toBeGreaterThan(0);
  await expect(productsLink.getByTestId("navigation-link-pending")).toHaveAttribute("data-pending", "true");
  await page.screenshot({ path: testInfo.outputPath("admin-navigation-pending.png"), fullPage: true });
  releaseRequest();
  await expect(page).toHaveURL(/\/admin\/products$/);
  await expect(page.getByRole("heading", { name: "Produkty" })).toBeVisible();
  await expect(productsLink.getByTestId("navigation-link-pending")).toHaveAttribute("data-pending", "false");
});
