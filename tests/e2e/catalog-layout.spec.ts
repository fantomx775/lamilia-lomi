import { expect, test, type Page } from "@playwright/test";
import { isLoopbackPlaywrightTarget } from "./local-target";

test("admin catalog preference persists and stays responsive", async ({ page }, testInfo) => {
  test.skip(
    !process.env.PLAYWRIGHT_LOCAL_DEMO || !isLoopbackPlaywrightTarget(testInfo.project.use.baseURL),
    "Uses the local demo admin session and requires a loopback baseURL.",
  );
  test.skip(testInfo.project.name !== "chromium", "Checks all viewport sizes in one Chromium session");
  test.setTimeout(90_000);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/pl/login?redirectTo=/admin/settings");
  await page.getByLabel("E-mail").fill("admin@lamilialomi.test");
  await page.getByLabel("Hasło").fill("demo-password");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin/settings"),
    page.getByRole("button", { name: "Kontynuuj" }).click(),
  ]);

  try {
    await expect(
      page.getByRole("combobox", { name: "Karty w wierszu na dużych ekranach" }),
    ).toHaveValue("4");
    await saveCatalogColumns(page, "5");
    await expect(
      page.getByRole("status"),
    ).toContainText("Ustawienia katalogu zostały zapisane.");
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Karty w wierszu na dużych ekranach" }),
    ).toHaveValue("5");
    await page.screenshot({
      path: testInfo.outputPath("admin-settings-catalog-columns.png"),
      fullPage: true,
    });

    await page.goto("/en/products");
    await dismissCookieConsent(page);
    const grid = page.getByTestId("product-catalog-grid");
    await expect(grid.locator("a").first()).toBeVisible();
    await expectGridColumns(grid, 5);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("catalog-desktop-five-columns.png"),
      fullPage: true,
    });

    await page.goto("/admin/settings");
    await saveCatalogColumns(page, "4");
    await page.goto("/en/products");
    await expectGridColumns(grid, 4);

    await page.goto("/admin/settings");
    await saveCatalogColumns(page, "3");
    await page.goto("/en/products");
    await expectGridColumns(grid, 3);
    await page.screenshot({
      path: testInfo.outputPath("catalog-desktop-three-columns.png"),
      fullPage: true,
    });

    const cover = grid.locator("a > div.relative").first();
    const coverRatio = await cover.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.width / bounds.height;
    });
    expect(coverRatio).toBeCloseTo(0.75, 1);

    await page.setViewportSize({ width: 800, height: 1024 });
    await expectGridColumns(grid, 2);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("catalog-tablet-two-columns.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expectGridColumns(grid, 1);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("catalog-mobile-one-column.png"),
      fullPage: true,
    });
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/admin/settings");
    await saveCatalogColumns(page, "4");
  }
});

async function saveCatalogColumns(page: Page, columns: "3" | "4" | "5") {
  await page
    .getByRole("combobox", { name: "Karty w wierszu na dużych ekranach" })
    .selectOption(columns);
  await Promise.all([
    page.waitForURL(
      (url) =>
        url.pathname === "/admin/settings" &&
        url.searchParams.get("saved") === "1",
    ),
    page.getByRole("button", { name: "Zapisz ustawienia katalogu" }).click(),
  ]);
}

async function dismissCookieConsent(page: Page) {
  const essentialConsent = page.getByRole("button", {
    name: "Essential",
    exact: true,
  });

  await essentialConsent.waitFor({ state: "visible" });
  await essentialConsent.click();
  await essentialConsent.waitFor({ state: "hidden" });
}

async function expectGridColumns(
  grid: ReturnType<Page["getByTestId"]>,
  expectedColumns: number,
) {
  await expect
    .poll(() =>
      grid.evaluate(
        (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length,
      ),
    )
    .toBe(expectedColumns);
}

async function expectNoHorizontalOverflow(page: Page) {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasOverflow).toBe(false);
}
