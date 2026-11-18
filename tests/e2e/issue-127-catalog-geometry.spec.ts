import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { getSeedContentSnapshot } from "../../src/lib/local-content";
import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test.use({ trace: "off", screenshot: "off", video: "off" });

async function geometry(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element | null) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    const visibleControls = [...document.querySelectorAll('[data-testid="catalog-mobile-search"],[data-testid="catalog-desktop-filters"]')].find((element) => element.getBoundingClientRect().height > 0);
    return { heading: box(document.querySelector('[data-testid="catalog-heading"]')), categories: box(document.querySelector('[aria-label="Categories"]')), controls: box(visibleControls ?? null), cover: box(document.querySelector('[data-testid="catalog-result-skeleton-cover"]') ?? document.querySelector('[data-testid="product-catalog-grid"] article a > div')) };
  });
}
function sameGeometry(before: Awaited<ReturnType<typeof geometry>>, after: Awaited<ReturnType<typeof geometry>>) {
  for (const field of ["heading", "categories", "controls", "cover"] as const) {
    if (!before[field] || !after[field]) { expect(after[field]).toEqual(before[field]); continue; }
    for (const dimension of ["x", "y", "width", "height"] as const) expect(Math.abs(before[field]![dimension] - after[field]![dimension]), `${field}.${dimension}`).toBeLessThanOrEqual(1);
  }
}

test("R5 F10 actual 0/1/7-category shell and 3/4/5-column results keep measured geometry", async ({ page }, info) => {
  test.skip(process.env.RUN_ISSUE_127_CATALOG_GEOMETRY_E2E !== "1", "Requires exclusive verified local-demo dev app with catalogue result delay enabled.");
  test.setTimeout(240_000);
  if (info.config.workers !== 1) throw new Error("Catalog fixture requires --workers=1.");
  if (Number(process.env.LAMILIA_TEST_CATALOG_LOADING_DELAY_MS) < 1000) throw new Error("Configure the existing dev-only catalogue result delay in app and runner for observable pending; never use a Production delay.");
  if (!(await isLocalDemoAppTarget(page, info.project.use.baseURL))) throw new Error("Refusing to change a content fixture outside verified local-demo mode.");
  await page.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
  const release = await acquireLocalContentStoreLock();
  const filename = path.resolve("data/lamilialomi-content.local.json");
  const previous = fs.existsSync(filename) ? fs.readFileSync(filename) : undefined;
  try {
    for (const categoryCount of [0, 1, 7]) for (const desktopColumns of [3, 4, 5] as const) {
      const snapshot = getSeedContentSnapshot();
      snapshot.products = snapshot.products.slice(0, 1);
      snapshot.categories = Array.from({ length: categoryCount }, (_, index) => ({ id: `ux127-category-${index}`, slug: `ux127-category-${index}`, sortOrder: index, translations: [{ locale: "en", name: `Category ${index + 1}` }] }));
      snapshot.products[0].categoryIds = snapshot.categories.slice(0, 1).map((item) => item.id);
      snapshot.catalogSettings.desktopColumns = desktopColumns;
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, JSON.stringify(snapshot), "utf8");
      for (const width of [390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(`/en/products?ux127case=${categoryCount}-${desktopColumns}-${width}`, { waitUntil: "commit" });
        await expect(page.getByTestId("product-catalog-opening")).toHaveCount(0);
        await expect(page.getByTestId("product-catalog-grid")).toBeVisible();
        await expect(page.getByTestId("catalog-category-list")).toHaveCount(categoryCount ? 1 : 0);
        if (categoryCount) await expect(page.locator('[data-testid^="catalog-category-ux127-category-"]')).toHaveCount(categoryCount);
        await page.evaluate(() => document.fonts.ready);
        const before = await geometry(page);
        const phase = `r5-c${categoryCount}-cols${desktopColumns}-w${width}`;
        await page.screenshot({ path: info.outputPath(`${phase}-before.png`), animations: "disabled" });
        // Native documents resolve critical content before sending it. Enhanced
        // GET transitions keep this actual shell and show the results skeleton.
        const form = page.getByTestId(width < 768 ? "catalog-mobile-search" : "catalog-desktop-filters");
        await form.getByRole("textbox", { name: "Search catalog" }).fill(snapshot.products[0].translations.find((item) => item.locale === "en")!.title);
        const submitted = await geometry(page);
        await form.getByRole("textbox", { name: "Search catalog" }).press("Enter");
        await expect(form.locator('[data-catalog-form-pending="true"]')).toBeVisible();
        await expect(page.getByTestId("product-catalog-loading")).toBeVisible();
        const pending = await geometry(page);
        sameGeometry(submitted, pending);
        await page.screenshot({ path: info.outputPath(`${phase}-pending.png`), animations: "disabled" });
        await expect(page.getByTestId("product-catalog-grid")).toBeVisible();
        await expect(page.getByTestId("product-catalog-loading")).toHaveCount(0);
        await expect(form.getByRole("textbox", { name: "Search catalog" })).toBeFocused();
        const final = await geometry(page);
        sameGeometry(pending, final);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`${phase}-after.png`), animations: "disabled" });
        await info.attach(`${phase}-bounds.json`, { body: JSON.stringify({ before, submitted, pending, final }), contentType: "application/json" });
        await expect(page.getByTestId("product-catalog-opening")).toHaveCount(0);
        await expect(form.locator('[data-catalog-form-pending="true"]')).toHaveCount(0);
      }
    }
  } finally {
    if (previous) fs.writeFileSync(filename, previous);
    else if (fs.existsSync(filename)) fs.unlinkSync(filename);
    release();
  }
});
