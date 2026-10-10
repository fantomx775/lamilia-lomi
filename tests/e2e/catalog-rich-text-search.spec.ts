import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test("PR 44 catalog search uses visible rich-text content", async ({ page }, testInfo) => {
  test.skip(
    !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
    "Catalog search browser evidence requires the loopback local demo backend.",
  );

  test.setTimeout(600_000);
  const releaseContentStoreLock = await acquireLocalContentStoreLock();
  const contentStorePath = path.resolve(process.cwd(), "data", "lamilialomi-content.local.json");
  const hadContentStore = fs.existsSync(contentStorePath);
  const originalContentStore = hadContentStore ? fs.readFileSync(contentStorePath) : undefined;
  const screenshotPath = path.resolve(
    process.env.PR_44_SCREENSHOT_PATH ??
      path.join(process.cwd(), "docs", "verification", "pr-44", "catalog-rich-text-search.png"),
  );
  const browserRunId = process.env.PR_44_BROWSER_RUN_ID ?? `pr-44-catalog-search-${Date.now()}`;
  const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const diagnostics = {
    consoleErrors: [] as string[],
    pageErrors: [] as string[],
    failedNetworkRequests: [] as Array<{ method: string; url: string; error: string | null }>,
    failedResponses: [] as Array<{ method: string; url: string; status: number }>,
  };
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });

  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    diagnostics.failedNetworkRequests.push({
      method: request.method(),
      url: safeUrl(request.url()),
      error: request.failure()?.errorText ?? null,
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      diagnostics.failedResponses.push({
        method: response.request().method(),
        url: safeUrl(response.url()),
        status: response.status(),
      });
    }
  });

  try {
    await page.addInitScript(() => {
      window.localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false }));
    });
    await signInAsAdmin(page);

    await page.goto("/admin/products");
    const firstProductLink = page.locator('a[href^="/admin/products/"]:not([href="/admin/products/new"])').first();
    const productPath = await firstProductLink.getAttribute("href");
    if (!productPath) throw new Error("The local product list did not provide an edit link.");
    await page.goto(productPath);

    const productSlug = await page.getByLabel("Adres produktu").inputValue();
    const productEditor = page.getByRole("textbox", { name: "Długi opis" });
    await productEditor.fill("Catalog split phrase");
    await productEditor.press("Control+Home");
    for (let index = 0; index < 8; index += 1) await productEditor.press("ArrowRight");
    for (let index = 0; index < 5; index += 1) await productEditor.press("Shift+ArrowRight");
    await page.getByRole("button", { name: "Pogrubienie" }).click();
    await expect(productEditor.locator("strong")).toHaveText("split");

    await productEditor.press("Control+Home");
    for (let index = 0; index < 14; index += 1) await productEditor.press("ArrowRight");
    for (let index = 0; index < 6; index += 1) await productEditor.press("Shift+ArrowRight");
    await page.getByRole("button", { name: "Dodaj lub edytuj link" }).click();
    await page.getByLabel("Adres strony").fill("https://metadata-only.example/catalog");
    await page.getByRole("button", { name: "Zapisz link" }).click();

    await page.getByRole("button", { name: /Zapisz/ }).first().click();
    await expect(page.getByText("Zapisano. Zmiany są aktualne.")).toBeVisible();

    await page.goto(`/en/products?q=${encodeURIComponent("split phrase")}`);
    const grid = page.getByTestId("product-catalog-grid");
    await expect(grid.locator(`a[href="/en/products/${productSlug}"]`)).toBeVisible();
    await expect(page.getByText("No products found", { exact: true })).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });

    await page.goto(`/en/products?q=${encodeURIComponent("metadata-only")}`);
    await expect(page.getByText("No products found", { exact: true })).toBeVisible();

    console.log(
      `PR44_BROWSER_EVIDENCE ${JSON.stringify({
        testedSha,
        browserRunId,
        screenshotPath,
        consoleErrors: diagnostics.consoleErrors,
        pageErrors: diagnostics.pageErrors,
        failedNetworkRequests: diagnostics.failedNetworkRequests,
        failedResponses: diagnostics.failedResponses,
      })}`,
    );
    expect(diagnostics.consoleErrors).toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);
    expect(diagnostics.failedNetworkRequests).toEqual([]);
    expect(diagnostics.failedResponses).toEqual([]);
  } finally {
    try {
      if (hadContentStore && originalContentStore) {
        fs.writeFileSync(contentStorePath, originalContentStore);
      } else if (fs.existsSync(contentStorePath)) {
        fs.rmSync(contentStorePath);
      }
    } finally {
      releaseContentStoreLock();
    }
  }
});

async function signInAsAdmin(page: Page) {
  await page.goto("/pl/login?redirectTo=/admin");
  await page.getByLabel("E-mail").fill("admin@lamilialomi.test");
  await page.getByLabel("Hasło").fill("demo-password");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.getByRole("button", { name: "Kontynuuj" }).click(),
  ]);
}

function safeUrl(value: string) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}
