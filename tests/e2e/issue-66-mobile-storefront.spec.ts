import { devices, expect, test, webkit, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { getSeedContentSnapshot } from "../../src/lib/local-content";
import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test.setTimeout(120_000);

type BrowserDiagnostics = {
  engine: string;
  consoleErrors: string[];
  pageErrors: string[];
  failedResponses: Array<{ url: string; status: number }>;
  failedRequests: Array<{ url: string; error: string | null }>;
};

test("Issue 66 compact mobile storefront keeps navigation and URL filters usable", async ({ page }, testInfo) => {
  test.skip(!(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)), "Uses disposable local catalog content.");

  const release = await acquireLocalContentStoreLock();
  const store = path.resolve("data/lamilialomi-content.local.json");
  const originalStore = fs.existsSync(store) ? fs.readFileSync(store) : null;
  const evidenceDirectory = path.resolve(process.env.ISSUE_66_SCREENSHOT_DIR ?? "test-results/issue-66-screenshots");
  const runId = process.env.ISSUE_66_RUN_ID ?? `issue-66-${Date.now()}`;
  const diagnostics: BrowserDiagnostics[] = [];
  let webkitBrowser: Awaited<ReturnType<typeof webkit.launch>> | undefined;

  const recordDiagnostics = (target: Page, engine: string) => {
    const result: BrowserDiagnostics = {
      engine,
      consoleErrors: [],
      pageErrors: [],
      failedResponses: [],
      failedRequests: [],
    };
    diagnostics.push(result);
    target.on("console", (message) => {
      if (message.type() === "error") result.consoleErrors.push(message.text());
    });
    target.on("pageerror", (error) => result.pageErrors.push(error.message));
    target.on("response", (response) => {
      if (response.status() >= 400) {
        const url = new URL(response.url());
        result.failedResponses.push({ url: url.origin + url.pathname, status: response.status() });
      }
    });
    target.on("requestfailed", (request) => {
      const url = new URL(request.url());
      result.failedRequests.push({ url: url.origin + url.pathname, error: request.failure()?.errorText ?? null });
    });
    return result;
  };

  const saveScreenshot = async (target: Page, name: string, fullPage = false) => {
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    await target.addStyleTag({ content: "nextjs-portal { display: none; }" });
    await target.screenshot({
      path: path.join(evidenceDirectory, `${name}.png`),
      fullPage,
      animations: "disabled",
      caret: "initial",
    });
  };

  try {
    const snapshot = getSeedContentSnapshot();
    const product = snapshot.products[0];
    const category = snapshot.categories[0];
    const tag = snapshot.tags[0];
    if (!product || !category || !tag) throw new Error("The local catalog seed needs a product, category, and tag for this browser flow.");

    product.slug = "issue-66-mobile-catalog-book";
    product.status = "published";
    product.categoryIds = [category.id];
    product.tagIds = [tag.id];
    product.translations = [{
      locale: "en",
      title: "A Very Long Moon Garden Story for Curious Little Readers and Families A Very Long Moon Garden Story for Curious Little Readers and Families",
      shortDescription: "A gentle story with tiny creatures, secret paths, and a peaceful garden.",
      longDescription: "",
    }];
    fs.mkdirSync(path.dirname(store), { recursive: true });
    fs.writeFileSync(store, JSON.stringify(snapshot));

    const search = new URLSearchParams({
      q: "moon garden",
      audience: product.audience,
      type: product.productType,
      category: category.slug,
      tag: tag.slug,
      sort: "newest",
      campaign: "issue-66-browser-check",
    });
    const catalogPath = `/en/products?${search.toString()}`;

    await page.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
    if (testInfo.project.name === "chromium") await page.setViewportSize({ width: 1440, height: 900 });
    const primaryDiagnostics = recordDiagnostics(page, testInfo.project.name);
    await page.goto(catalogPath, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Browse LamiliaLomi books" })).toBeVisible();
    await page.evaluate(async () => { await document.fonts.ready; });

    const header = page.locator("header");
    const accountAction = header.getByRole("link", { name: "Log in", exact: true });
    await expect(accountAction).toBeVisible();

    if (testInfo.project.name === "chromium") {
      await expect(header.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
      await expect(header.getByRole("button", { name: /navigation menu/ })).toHaveCount(0);
      await expect(page.getByTestId("catalog-desktop-filters")).toBeVisible();
      await expect(page.getByTestId("product-catalog-grid").locator("article")).toHaveCount(1);
      await expect(page.getByTestId("product-catalog-grid").locator("article summary")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await saveScreenshot(page, "desktop-catalog", true);
    } else {
      const menuButton = header.getByRole("button", { name: "Open navigation menu" });
      const logo = header.getByRole("link", { name: "LamiliaLomi home" });
      const [logoBox, accountBox, menuBox] = await Promise.all([
        logo.boundingBox(), accountAction.boundingBox(), menuButton.boundingBox(),
      ]);
      expect(logoBox).not.toBeNull();
      expect(accountBox).not.toBeNull();
      expect(menuBox).not.toBeNull();
      expect(Math.abs((logoBox!.y + logoBox!.height / 2) - (accountBox!.y + accountBox!.height / 2))).toBeLessThan(8);
      expect(Math.abs((accountBox!.y + accountBox!.height / 2) - (menuBox!.y + menuBox!.height / 2))).toBeLessThan(8);
      expect((await header.boundingBox())!.height).toBeLessThan(80);
      await expect(page.getByTestId("catalog-mobile-search").getByRole("textbox", { name: "Search catalog" })).toBeVisible();
      await expect(page.getByTestId("catalog-desktop-filters")).not.toBeVisible();
      await expect(page.getByTestId("catalog-mobile-filter-disclosure")).not.toHaveAttribute("open", "");

      const categoryList = page.getByTestId("catalog-category-list");
      const categoryTops = await categoryList.locator("a").evaluateAll((links) => links.map((link) => Math.round(link.getBoundingClientRect().top)));
      expect(new Set(categoryTops).size).toBe(1);
      await expect(page.getByTestId(`catalog-category-${category.slug}`)).toHaveAttribute("aria-current", "true");
      await expect(page.getByTestId("catalog-category-all")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await saveScreenshot(page, "pixel7-catalog", true);

      await menuButton.click();
      const mobileMenu = header.getByRole("navigation", { name: "Mobile primary navigation" });
      await expect(mobileMenu).toBeVisible();
      for (const label of ["Catalog", "About", "My Library", "Log in", "Sign up"]) {
        await expect(mobileMenu.getByRole("link", { name: label, exact: true })).toBeVisible();
      }
      await expect(mobileMenu.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/en/register");
      await saveScreenshot(page, "pixel7-header-menu");
      await page.keyboard.press("Escape");
      await expect(menuButton).toBeFocused();
      await expect(mobileMenu).not.toBeVisible();

      await menuButton.click();
      await page.mouse.click(4, 180);
      await expect(mobileMenu).not.toBeVisible();

      const card = page.getByTestId("product-catalog-grid").locator("article").first();
      const disclosure = card.locator("summary");
      await expect(disclosure).toBeVisible();
      await page.mouse.move(0, 0);
      await disclosure.tap();
      await expect(card.locator("details")).toHaveAttribute("open", "");
      await page.mouse.move(0, 0);
      await expect.poll(async () => card.evaluate((element) => getComputedStyle(element).boxShadow)).not.toContain("197, 111, 93");

      const filterDisclosure = page.getByTestId("catalog-mobile-filter-disclosure");
      const filterSummary = filterDisclosure.locator("summary");
      await filterSummary.click();
      const filterForm = page.getByTestId("catalog-mobile-filters");
      await expect(filterForm.getByLabel("Audience filter")).toHaveValue(product.audience);
      await expect(filterForm.getByLabel("Type filter")).toHaveValue(product.productType);
      await expect(filterForm.getByLabel("Category filter")).toHaveValue(category.slug);
      await expect(filterForm.getByLabel("Tag filter")).toHaveValue(tag.slug);
      await expect(filterForm.getByLabel("Sort products")).toHaveValue("newest");
      await expect(filterForm.getByText("Audience: Kids")).toHaveCount(product.audience === "kids" ? 1 : 0);
      const allCategories = page.getByTestId("catalog-category-all");
      const allCategoriesHref = await allCategories.getAttribute("href");
      expect(new URL(allCategoriesHref!, page.url()).searchParams.get("category")).toBeNull();
      await allCategories.click();
      await page.waitForURL((url) => url.searchParams.get("category") === null);
      let currentUrl = new URL(page.url());
      expect(currentUrl.searchParams.get("category")).toBeNull();
      expect(currentUrl.searchParams.get("q")).toBe("moon garden");
      expect(currentUrl.searchParams.get("sort")).toBe("newest");
      expect(currentUrl.searchParams.get("campaign")).toBe("issue-66-browser-check");
      await page.goBack();
      await expect(page.getByTestId(`catalog-category-${category.slug}`)).toHaveAttribute("aria-current", "true");

      const searchForm = page.getByTestId("catalog-mobile-search");
      await searchForm.getByRole("textbox", { name: "Search catalog" }).fill("moon garden query");
      await searchForm.getByRole("button", { name: "Search", exact: true }).click();
      await page.waitForURL((url) => url.searchParams.get("q") === "moon garden query");
      currentUrl = new URL(page.url());
      expect(currentUrl.searchParams.get("q")).toBe("moon garden query");
      expect(currentUrl.searchParams.get("audience")).toBe(product.audience);
      expect(currentUrl.searchParams.get("type")).toBe(product.productType);
      expect(currentUrl.searchParams.get("category")).toBe(category.slug);
      expect(currentUrl.searchParams.get("tag")).toBe(tag.slug);
      expect(currentUrl.searchParams.get("sort")).toBe("newest");
      expect(currentUrl.searchParams.get("campaign")).toBe("issue-66-browser-check");
      await page.reload();
      await expect(page.getByTestId("catalog-mobile-search").getByRole("textbox", { name: "Search catalog" })).toHaveValue("moon garden query");

      await page.getByTestId("catalog-mobile-filter-disclosure").locator("summary").click();
      const updatedAudience = product.audience === "kids" ? "adults" : "kids";
      const updatedFilterForm = page.getByTestId("catalog-mobile-filters");
      await updatedFilterForm.getByLabel("Audience filter").selectOption(updatedAudience);
      await updatedFilterForm.getByRole("button", { name: "Apply filters" }).click();
      await page.waitForURL((url) => url.searchParams.get("audience") === updatedAudience);
      currentUrl = new URL(page.url());
      expect(currentUrl.searchParams.get("q")).toBe("moon garden query");
      expect(currentUrl.searchParams.get("audience")).toBe(updatedAudience);
      expect(currentUrl.searchParams.get("type")).toBe(product.productType);
      expect(currentUrl.searchParams.get("category")).toBe(category.slug);
      expect(currentUrl.searchParams.get("tag")).toBe(tag.slug);
      expect(currentUrl.searchParams.get("sort")).toBe("newest");
      expect(currentUrl.searchParams.get("campaign")).toBe("issue-66-browser-check");
      await page.goBack();
      await page.waitForURL((url) => url.searchParams.get("audience") === product.audience);
      await page.goForward();
      await page.waitForURL((url) => url.searchParams.get("audience") === updatedAudience);
      await page.reload();
      await page.getByTestId("catalog-mobile-filter-disclosure").locator("summary").click();
      await expect(page.getByTestId("catalog-mobile-filters").getByLabel("Audience filter")).toHaveValue(updatedAudience);
      await page.getByRole("link", { name: "Clear all", exact: true }).click();
      await page.waitForURL((url) => ["q", "audience", "type", "category", "tag", "sort"].every((key) => !url.searchParams.has(key)));
      currentUrl = new URL(page.url());
      for (const key of ["q", "audience", "type", "category", "tag", "sort"]) expect(currentUrl.searchParams.has(key)).toBe(false);
      expect(currentUrl.searchParams.get("campaign")).toBe("issue-66-browser-check");

      const footer = page.locator("footer");
      await expect(footer.getByText(/Instagram \/ Pinterest placeholders/i)).toHaveCount(0);
      await expect(footer.getByRole("navigation", { name: "Explore" }).getByRole("link", { name: "Catalog" })).toHaveAttribute("href", "/en/products");
      await expect(footer.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy" })).toBeVisible();

      await page.setViewportSize({ width: 320, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(header.getByRole("link", { name: "Log in", exact: true })).toBeVisible();
      await expect(header.getByRole("button", { name: "Open navigation menu" })).toBeVisible();
      await page.setViewportSize({ width: 412, height: 915 });
    }

    if (testInfo.project.name === "chromium") {
      webkitBrowser = await webkit.launch();
      const webkitContext = await webkitBrowser.newContext({ ...devices["iPhone 13"] });
      const webkitPage = await webkitContext.newPage();
      await webkitPage.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
      const webkitDiagnostics = recordDiagnostics(webkitPage, "webkit-iphone-13");
      await webkitPage.goto(new URL("/en/products?campaign=webkit", String(testInfo.project.use.baseURL)).toString(), { waitUntil: "domcontentloaded" });
      await webkitPage.evaluate(async () => { await document.fonts.ready; });
      const webkitHeader = webkitPage.locator("header");
      await expect(webkitHeader.getByRole("link", { name: "Log in", exact: true })).toBeVisible();
      const webkitMenuButton = webkitHeader.getByRole("button", { name: "Open navigation menu" });
      await webkitMenuButton.tap();
      const webkitMenu = webkitHeader.getByRole("navigation", { name: "Mobile primary navigation" });
      await expect(webkitMenu.getByRole("link", { name: "Sign up", exact: true })).toHaveAttribute("href", "/en/register");
      await saveScreenshot(webkitPage, "webkit-iphone-header-menu");
      await webkitPage.keyboard.press("Escape");
      await expect(webkitMenuButton).toBeFocused();
      await webkitPage.getByTestId("catalog-mobile-filter-disclosure").locator("summary").tap();
      await expect(webkitPage.getByTestId("catalog-mobile-filters").getByRole("button", { name: "Apply filters" })).toBeVisible();
      await saveScreenshot(webkitPage, "webkit-iphone-catalog-filters");
      await webkitPage.setViewportSize({ width: 320, height: 800 });
      expect(await webkitPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await webkitContext.close();
      expect(webkitDiagnostics.consoleErrors).toEqual([]);
      expect(webkitDiagnostics.pageErrors).toEqual([]);
      expect(webkitDiagnostics.failedResponses).toEqual([]);
      expect(webkitDiagnostics.failedRequests.filter((item) => !item.error?.includes("ERR_ABORTED"))).toEqual([]);
    }

    expect(primaryDiagnostics.consoleErrors).toEqual([]);
    expect(primaryDiagnostics.pageErrors).toEqual([]);
    expect(primaryDiagnostics.failedResponses).toEqual([]);
    expect(primaryDiagnostics.failedRequests.filter((item) => !item.error?.includes("ERR_ABORTED"))).toEqual([]);
  } finally {
    if (webkitBrowser) await webkitBrowser.close();
    if (originalStore) fs.writeFileSync(store, originalStore);
    else if (fs.existsSync(store)) fs.unlinkSync(store);
    fs.mkdirSync(path.dirname(evidenceDirectory), { recursive: true });
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync(path.join("test-results", `issue-66-diagnostics-${testInfo.project.name}.json`), JSON.stringify({ runId, diagnostics }, null, 2));
    release();
  }
});
