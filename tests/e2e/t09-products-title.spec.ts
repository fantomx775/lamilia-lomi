import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test("T09 product titles, statuses, search, and responsive table layout", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  test.skip(!(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)), "Requires the local demo admin.");
  const releaseLock = await acquireLocalContentStoreLock();
  const storePath = path.resolve(process.cwd(), "data", "lamilialomi-content.local.json");
  const originalStore = fs.readFileSync(storePath);
  const unbrokenTitleToken = "moonlitgardenstorybook".repeat(2).slice(0, 30);
  const title = `${"The moonlit garden story follows a little owl, three sleepy birds, and their night-time journey through a forest filled with tiny lights: ".slice(0, 110)}${unbrokenTitleToken}`;
  const id = "77777777-7777-4777-8777-777777777777";

  try {
    expect(title).toHaveLength(140);
    const screenshotDir = process.env.T09_SCREENSHOT_DIR
      ? path.resolve(process.env.T09_SCREENSHOT_DIR)
      : testInfo.outputPath();
    fs.mkdirSync(screenshotDir, { recursive: true });
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const readerArtworksStatuses: number[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const store = JSON.parse(originalStore.toString("utf8")) as { products: Array<Record<string, unknown>> };
    const product = structuredClone(store.products[0]!) as Record<string, unknown>;
    product.id = id;
    product.slug = "moonlit-garden-" + "a-very-long-unbroken-slug-".repeat(8);
    product.status = "archived";
    product.translations = (product.translations as Array<Record<string, unknown>>).map((translation) => ({
      ...translation,
      title,
    }));
    product.categoryIds = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"];
    product.tagIds = ["dddddddd-dddd-4ddd-8ddd-dddddddddddd", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "ffffffff-ffff-4fff-8fff-ffffffffffff"];
    store.products.push(product);
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));

    await signInAsAdmin(page);
    await page.goto("/admin/products", { waitUntil: "load", timeout: 15_000 });
    const search = page.getByRole("textbox", { name: "Szukaj produktów" });
    await expect(search).toBeVisible();
    await search.fill("moonlit garden");
    await expect(page.getByText("1 wynik", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: `Edytuj produkt ${title}`, exact: true })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Edytuj produkt Moon Garden Coloring Book", exact: true })).toHaveCount(0);
    await search.fill("");
    await expect(page.getByText(`${store.products.length} wyników`, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: `Edytuj produkt ${title}`, exact: true })).toHaveCount(1);
    await search.evaluate((input: HTMLInputElement) => input.blur());

    const snapshots: Array<Record<string, unknown>> = [];
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const link = page.getByRole("link", { name: `Edytuj produkt ${title}`, exact: true }).last();
      await expect(link).toBeVisible();
      const measurement = await page.evaluate((accessibleName) => {
        const table = document.querySelector("[data-slot='data-table']");
        const wrapper = table?.querySelector(".overflow-x-auto");
        const tableSection = table?.children.item(0);
        const cardSection = table?.children.item(1);
        const titleLink = Array.from(table?.querySelectorAll("a[aria-label]") ?? []).find((link) => link.getAttribute("aria-label") === accessibleName);
        const status = titleLink?.closest("tr")?.querySelector("td:nth-child(2) span");
        const mobileLink = Array.from(cardSection?.querySelectorAll("a[aria-label]") ?? []).find((link) => link.getAttribute("aria-label") === accessibleName);
        const mobileStatus = Array.from(mobileLink?.querySelectorAll("span") ?? []).find((element) => element.textContent === "Zarchiwizowany");
        const rect = status?.getBoundingClientRect();
        const wrapperRect = wrapper?.getBoundingClientRect();
        const badgeStyle = status ? getComputedStyle(status) : null;
        const mobileBadgeRect = mobileStatus?.getBoundingClientRect();
        const mobileTitle = mobileLink?.querySelector("p[title]");
        const statusBounds = Array.from(table?.querySelectorAll("tbody td:nth-child(2) span") ?? []).map((badge) => {
          const bounds = badge.getBoundingClientRect();
          const cell = badge.closest("td")?.getBoundingClientRect();
          return { text: badge.textContent, left: bounds.left, right: bounds.right, cellLeft: cell?.left, cellRight: cell?.right, scrollWidth: badge.scrollWidth, clientWidth: badge.clientWidth };
        });
        const titleElement = titleLink?.querySelector("span[title]");
        const titleBounds = titleElement?.getBoundingClientRect();
        const titleCellBounds = titleElement?.closest("td")?.getBoundingClientRect();
        const titleStyle = titleElement ? getComputedStyle(titleElement) : null;
        return {
          viewport: window.innerWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          tableVisible: Boolean(tableSection && getComputedStyle(tableSection).display !== "none"),
          cardVisible: Boolean(cardSection && getComputedStyle(cardSection).display !== "none"),
          wrapperClientWidth: wrapper?.clientWidth ?? null,
          wrapperScrollWidth: wrapper?.scrollWidth ?? null,
          badgeText: status?.textContent,
          badgeRight: rect?.right ?? null,
          wrapperRight: wrapperRect?.right ?? null,
          badgeWhiteSpace: badgeStyle?.whiteSpace,
          statusBounds,
          titleClamp: titleStyle?.webkitLineClamp,
          titleHeight: titleBounds?.height,
          titleLineHeight: Number.parseFloat(titleStyle?.lineHeight ?? "0"),
          titleRight: titleBounds?.right,
          titleCellRight: titleCellBounds?.right,
          mobileBadgeText: mobileStatus?.textContent,
          mobileBadgeRight: mobileBadgeRect?.right ?? null,
          mobileTitle: mobileTitle?.getAttribute("title"),
          mobileTitleClamp: mobileTitle ? getComputedStyle(mobileTitle).webkitLineClamp : null,
        };
      }, `Edytuj produkt ${title}`);
      snapshots.push(measurement);
      expect(measurement.documentScrollWidth).toBeLessThanOrEqual(width);
      if (width < 1280) {
        expect(measurement.cardVisible).toBe(true);
        expect(measurement.tableVisible).toBe(false);
        expect(measurement.mobileBadgeText).toBe("Zarchiwizowany");
        expect(measurement.mobileBadgeRight).toBeLessThanOrEqual(width);
        expect(measurement.mobileTitle).toBe(title);
        expect(measurement.mobileTitleClamp).toBe("2");
        if (width === 390) await link.scrollIntoViewIfNeeded();
      } else {
        expect(measurement.tableVisible).toBe(true);
        expect(measurement.wrapperScrollWidth).toBeLessThanOrEqual(measurement.wrapperClientWidth as number);
        expect(measurement.badgeText).toBe("Zarchiwizowany");
        expect(measurement.badgeRight).toBeLessThanOrEqual(measurement.wrapperRight as number);
        expect(measurement.statusBounds).toEqual(expect.arrayContaining([
          expect.objectContaining({ text: "Szkic" }),
          expect.objectContaining({ text: "Opublikowany" }),
          expect.objectContaining({ text: "Zarchiwizowany" }),
        ]));
        for (const badge of measurement.statusBounds as Array<{
          left: number;
          right: number;
          cellLeft: number;
          cellRight: number;
          scrollWidth: number;
          clientWidth: number;
        }>) {
          expect(badge.left).toBeGreaterThanOrEqual(badge.cellLeft as number);
          expect(badge.right).toBeLessThanOrEqual(badge.cellRight as number);
          expect(badge.scrollWidth).toBeLessThanOrEqual(badge.clientWidth);
        }
        expect(measurement.titleClamp).toBe("2");
        expect(measurement.titleHeight).toBeLessThanOrEqual((measurement.titleLineHeight as number) * 2 + 1);
        expect(measurement.titleRight).toBeLessThanOrEqual(measurement.titleCellRight as number);
      }

      if (width === 390 || width === 1280 || width === 1440) {
        if (width !== 390) await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(screenshotDir, `products-${width}.png`), fullPage: false, animations: "disabled" });
      }
      if (width === 1440) {
        const toggle = page.getByRole("button", { name: "Pokaż 1 kolejną kategorię" }).last();
        await toggle.click();
        await expect(page.getByRole("group", { name: "Pozostałe kategorie" }).last()).toBeVisible();
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const desktopTitleLink = page.locator("tbody").getByRole("link", { name: `Edytuj produkt ${title}`, exact: true });
    await desktopTitleLink.focus();
    await expect(desktopTitleLink).toBeFocused();
    const keyboardReaderArtworks = page.waitForResponse((response) =>
      response.request().method() === "GET" && response.url().endsWith(`/api/admin/products/${id}/reader-artworks`),
      { timeout: 15_000 },
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/admin/products/${id}$`));
    const keyboardArtworksResponse = await keyboardReaderArtworks;
    readerArtworksStatuses.push(keyboardArtworksResponse.status());
    expect(keyboardArtworksResponse.ok()).toBe(true);
    await page.goto("/admin/products", { waitUntil: "domcontentloaded", timeout: 15_000 });
    const productRow = page.locator("tbody tr").filter({ has: page.locator(`a[href='/admin/products/${id}']`) });
    const rowReaderArtworks = page.waitForResponse((response) =>
      response.request().method() === "GET" && response.url().endsWith(`/api/admin/products/${id}/reader-artworks`),
      { timeout: 15_000 },
    );
    await productRow.locator("td").nth(2).click();
    await expect(page).toHaveURL(new RegExp(`/admin/products/${id}$`));
    const rowArtworksResponse = await rowReaderArtworks;
    readerArtworksStatuses.push(rowArtworksResponse.status());
    expect(rowArtworksResponse.ok()).toBe(true);
    await page.goto("/admin/products", { waitUntil: "load", timeout: 15_000 });
    await expect(page.getByRole("link", { name: `Edytuj produkt ${title}`, exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    console.log(`T09 responsive measurements: ${JSON.stringify(snapshots)}`);
    console.log(`T09 browser diagnostics: ${JSON.stringify({ pageErrors, consoleErrors, readerArtworksStatuses })}`);
  } finally {
    fs.writeFileSync(storePath, originalStore);
    releaseLock();
  }
});

async function signInAsAdmin(page: Page) {
  await page.goto("/pl/login?redirectTo=/admin", { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.getByLabel(/^(e-mail|email)$/i).fill("admin@lamilialomi.test");
  await page.getByLabel(/^(hasło|password)$/i).fill("demo-password");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin", { timeout: 15_000 }),
    page.getByRole("button", { name: /^(kontynuuj|continue)$/i }).click(),
  ]);
}
