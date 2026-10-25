import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

const productId = "11111111-1111-4111-8111-111111111111";
const screenshotDirectory = (outputDirectory: string) =>
  path.resolve(process.env.EDITOR_BANNER_SCREENSHOT_DIR ?? outputDirectory);

test("homepage banner selects the supplied responsive artwork and keeps navigation usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Check all requested viewport widths in one Chromium run.");
  test.setTimeout(90_000);
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  test.skip(!(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)), "Local demo only.");

  const diagnostics = { console: [] as string[], page: [] as string[], responses: [] as string[] };
  const screenshots = screenshotDirectory(testInfo.outputDir);
  fs.mkdirSync(screenshots, { recursive: true });
  page.on("console", (message) => { if (message.type() === "error") diagnostics.console.push(message.text()); });
  page.on("pageerror", (error) => diagnostics.page.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) diagnostics.responses.push(`${response.status()} ${response.url()}`);
  });

  try {
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto("/en");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByTestId("localized-page-loading")).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1, name: "LamiliaLomi" })).toBeVisible();
      const essentialConsent = page.getByRole("button", { name: "Essential", exact: true });
      if (width === 390) {
        await expect(essentialConsent).toBeVisible();
        await essentialConsent.click();
        await expect(essentialConsent).toBeHidden();
        await expect(page.getByText(/We use essential cookies/)).toBeHidden();
      } else await expect(essentialConsent).toBeHidden();

      const banner = page.getByTestId("home-campaign-banner");
      await expect(banner).toHaveCount(1);
      await expect(banner).toBeVisible();
      const logo = page.getByRole("link", { name: /LamiliaLomi home/i }).locator("img");
      await expect.poll(() => logo.evaluate((element) => {
        const candidate = element as HTMLImageElement;
        const box = candidate.getBoundingClientRect();
        return candidate.complete && candidate.naturalWidth > 0 && box.width >= 32 && box.height >= 32;
      }), { timeout: 20_000 }).toBe(true);
      await expect(logo).toBeVisible();
      await expect(page.getByRole("link", { name: "LamiliaLomi home" })).toBeVisible();
      const image = banner.locator("img");
      await expect.poll(() => image.evaluate((element) => {
        const candidate = element as HTMLImageElement;
        return candidate.complete && candidate.naturalWidth > 0;
      }), { timeout: 20_000 }).toBe(true);

      const imageState = await image.evaluate((element) => {
        const candidate = element as HTMLImageElement;
        const box = candidate.getBoundingClientRect();
        const bannerBox = candidate.closest("[data-testid='home-campaign-banner']")!.getBoundingClientRect();
        return {
          source: candidate.currentSrc,
          naturalRatio: candidate.naturalWidth / candidate.naturalHeight,
          renderedRatio: box.width / box.height,
          x: bannerBox.x,
          width: bannerBox.width,
          y: bannerBox.y,
          headerBottom: document.querySelector("header")!.getBoundingClientRect().bottom,
        };
      });
      const expectedRatio = width < 768 ? 1.5 : 4.8;
      expect(Math.abs(imageState.naturalRatio - expectedRatio), `${width}px should select the ${expectedRatio}:1 supplied artwork (${imageState.source})`).toBeLessThan(0.06);
      expect(Math.abs(imageState.renderedRatio - expectedRatio), `${width}px banner should preserve its artwork proportions`).toBeLessThan(0.08);
      expect(Math.abs(imageState.x)).toBeLessThan(1);
      expect(Math.abs(imageState.width - width)).toBeLessThan(1);
      expect(imageState.y).toBeGreaterThanOrEqual(imageState.headerBottom);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await page.addStyleTag({ content: "nextjs-portal { display:none !important } * { caret-color:transparent !important }" });
      await page.screenshot({ path: path.join(screenshots, `homepage-${width}.png`), animations: "disabled", caret: "initial" });

      if (width === 390) {
        const openMenu = page.getByRole("button", { name: "Open navigation menu" });
        await openMenu.click();
        const mobileNavigation = page.getByRole("navigation", { name: "Mobile primary navigation" });
        await expect(mobileNavigation).toBeVisible();
        await page.getByRole("button", { name: "Close navigation menu" }).click();
        await expect(mobileNavigation).toBeHidden();
        await page.getByRole("button", { name: "Open navigation menu" }).click();
        await mobileNavigation.getByRole("link", { name: "About", exact: true }).click();
        await expect(page).toHaveURL(/\/en\/about(?:\?.*)?$/);
        await expect(page.getByRole("button", { name: "Open navigation menu" })).toHaveAttribute("aria-expanded", "false");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.evaluate(() => document.fonts.ready);
        await page.addStyleTag({ content: "nextjs-portal { display:none !important } * { caret-color:transparent !important }" });
        await page.screenshot({ path: path.join(screenshots, "about-390.png"), animations: "disabled", caret: "initial" });
        await page.goto("/en");
      }

      await page.getByRole("link", { name: "Browse catalog", exact: true }).click();
      await expect(page).toHaveURL(/\/en\/products(?:\?.*)?$/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      if (width === 1440) {
        await page.goto("/en");
        const audienceCard = page.locator('a[href^="/en/products?audience="]').first();
        const audienceHref = await audienceCard.getAttribute("href");
        expect(audienceHref).toMatch(/^\/en\/products\?audience=(kids|adults)$/);
        await audienceCard.click();
        const audience = audienceHref!.split("=")[1];
        await expect.poll(() => ({
          pathname: new URL(page.url()).pathname,
          audience: new URL(page.url()).searchParams.get("audience"),
        })).toEqual({ pathname: "/en/products", audience });
        await expect(page.getByTestId("product-catalog-grid")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

        await page.goto("/en/products");
        const productLink = page.getByTestId("product-catalog-grid").locator("article a").first();
        await expect(productLink).toBeVisible();
        await productLink.click();
        await expect(page).toHaveURL(/\/en\/products\/[^/?#]+$/);
        await expect(page.locator("h1")).toBeVisible();
        await expect.poll(() => page.locator("[data-testid='product-hero'] img").evaluateAll((images) =>
          images.length > 0 && images.every((element) => {
            const image = element as HTMLImageElement;
            return image.complete && image.naturalWidth > 0;
          }),
        ), { timeout: 20_000 }).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.evaluate(() => document.fonts.ready);
        await page.addStyleTag({ content: "nextjs-portal { display:none !important } * { caret-color:transparent !important }" });
        await page.screenshot({ path: path.join(screenshots, "product-detail-1440.png"), animations: "disabled", caret: "initial" });
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.addStyleTag({ content: "nextjs-portal { display:none !important } * { caret-color:transparent !important }" });
        await page.screenshot({ path: path.join(screenshots, "product-detail-390.png"), animations: "disabled", caret: "initial" });
      }

      await page.goto("/en");
    }

    expect(diagnostics).toEqual({ console: [], page: [], responses: [] });
  } finally {
    fs.writeFileSync(path.join(screenshots, "homepage-diagnostics.json"), JSON.stringify(diagnostics, null, 2));
  }
});

test("product editor stays aligned and taxonomy selections persist responsively", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Check desktop and mobile widths in one Chromium run.");
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  test.skip(!(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)), "Owned local-demo fixture only.");

  const release = await acquireLocalContentStoreLock();
  const storePath = path.resolve("data/lamilialomi-content.local.json");
  const originalStore = fs.existsSync(storePath) ? fs.readFileSync(storePath) : undefined;
  const diagnostics = { console: [] as string[], page: [] as string[], responses: [] as string[] };
  const screenshots = screenshotDirectory(testInfo.outputDir);
  fs.mkdirSync(screenshots, { recursive: true });
  page.on("console", (message) => { if (message.type() === "error") diagnostics.console.push(message.text()); });
  page.on("pageerror", (error) => diagnostics.page.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) diagnostics.responses.push(`${response.status()} ${response.url()}`);
  });

  try {
    await page.goto("/en/login?redirectTo=/admin/products");
    await page.getByLabel("Email", { exact: true }).fill("admin@lamilialomi.test");
    await page.getByLabel("Password", { exact: true }).fill("demo-password");
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/admin/products"),
      page.getByRole("button", { name: "Continue", exact: true }).click(),
    ]);
    await page.goto(`/admin/products/${productId}`);
    await page.getByRole("textbox", { name: "Długi opis", exact: true }).waitFor();

    const main = page.locator("#product-editor-form main");
    const expectedSections = [
      "Podstawowe informacje",
      "Okładka",
      "Galeria",
      "Pokolorowane prace czytelniczek",
      "Wideo flipthrough",
      "Publiczne pliki do pobrania",
      "Materiały premium",
      "Sprzedaż na Amazon",
      "Dostęp premium",
      "Publikacja i organizacja",
    ];
    await expect.poll(() => main.locator("h2").allTextContents()).toEqual(expectedSections);
    const headings = await page.locator("h1, h2, h3").allTextContents();
    const allCapsHeading = headings.find((heading) => /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(heading) && heading === heading.toLocaleUpperCase("pl"));
    expect(allCapsHeading).toBeUndefined();

    const categoryGroup = page.getByRole("group", { name: "Kategorie" });
    const tagGroup = page.getByRole("group", { name: "Tagi" });
    await expect(categoryGroup.locator("input[type=checkbox]").first()).toBeVisible();
    await expect(tagGroup.locator("input[type=checkbox]").first()).toBeVisible();

    const editorCard = page.getByRole("heading", { name: "Publikacja i organizacja" }).locator("xpath=../..");
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.evaluate(() => {
      const mainElement = document.querySelector("#product-editor-form main")!;
      const dangerElement = [...document.querySelectorAll("section")].find((section) => section.querySelector("h2")?.textContent?.trim() === "Strefa niebezpieczna")!;
      const mainBox = mainElement.getBoundingClientRect();
      const dangerBox = dangerElement.getBoundingClientRect();
      return {
        main: { x: mainBox.x, y: mainBox.y, width: mainBox.width, bottom: mainBox.bottom },
        danger: { x: dangerBox.x, y: dangerBox.y, width: dangerBox.width },
      };
    });
    expect(geometry.main.width).toBeGreaterThan(1000);
    expect(Math.abs(geometry.main.x - geometry.danger.x)).toBeLessThan(2);
    expect(Math.abs(geometry.main.width - geometry.danger.width)).toBeLessThan(2);
    expect(geometry.danger.y - geometry.main.bottom).toBeGreaterThanOrEqual(24);

    await page.addStyleTag({ content: "nextjs-portal { display:none !important } * { caret-color:transparent !important }" });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(screenshots, "editor-1440.png"), animations: "disabled", caret: "initial" });
    await editorCard.screenshot({ path: path.join(screenshots, "taxonomy-1440.png"), animations: "disabled", caret: "initial" });
    const dangerCard = page.getByRole("heading", { name: "Strefa niebezpieczna" }).locator("xpath=../..");
    await dangerCard.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await page.evaluate(() => window.scrollBy(0, -80));
    const dangerActions = [dangerCard.getByRole("button", { name: "Archiwizuj" }), dangerCard.getByRole("button", { name: "Usuń produkt" })];
    const actionBoxes = await Promise.all(dangerActions.map((button) => button.boundingBox()));
    const saveBarBox = await page.getByTestId("product-save-bar").boundingBox();
    expect(actionBoxes.every((box) => box && box.y >= 0 && box.y + box.height < saveBarBox!.y)).toBe(true);
    await dangerCard.screenshot({ path: path.join(screenshots, "danger-zone-1440.png"), animations: "disabled", caret: "initial" });

    for (const group of [categoryGroup, tagGroup]) {
      const firstOption = group.locator("input[type=checkbox]").first();
      if (await firstOption.isChecked()) await firstOption.uncheck();
      else await firstOption.check();
    }
    const expectedCategories = await categoryGroup.locator("input[type=checkbox]").evaluateAll((inputs) => (inputs as HTMLInputElement[]).map((input) => input.checked));
    const expectedTags = await tagGroup.locator("input[type=checkbox]").evaluateAll((inputs) => (inputs as HTMLInputElement[]).map((input) => input.checked));
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(screenshots, "editor-390.png"), animations: "disabled", caret: "initial" });
    await page.setViewportSize({ width: 390, height: 1800 });
    await editorCard.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -80));
    await editorCard.screenshot({ path: path.join(screenshots, "taxonomy-390.png"), animations: "disabled", caret: "initial" });

    await page.getByTestId("product-save-bar").getByRole("button", { name: /Zapisz/ }).click();
    await expect(page.getByTestId("product-save-bar").getByRole("status")).toContainText("Zapisano", { timeout: 30_000 });
    await page.reload();
    await page.getByRole("textbox", { name: "Długi opis", exact: true }).waitFor();
    await expect.poll(() => categoryGroup.locator("input[type=checkbox]").evaluateAll((inputs) => (inputs as HTMLInputElement[]).map((input) => input.checked))).toEqual(expectedCategories);
    await expect.poll(() => tagGroup.locator("input[type=checkbox]").evaluateAll((inputs) => (inputs as HTMLInputElement[]).map((input) => input.checked))).toEqual(expectedTags);

    expect(diagnostics).toEqual({ console: [], page: [], responses: [] });
  } finally {
    try {
      await page.goto("about:blank");
    } finally {
      try {
        if (originalStore) fs.writeFileSync(storePath, originalStore);
        else if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
      } finally {
        fs.writeFileSync(path.join(screenshots, "editor-diagnostics.json"), JSON.stringify(diagnostics, null, 2));
        release();
      }
    }
  }
});
