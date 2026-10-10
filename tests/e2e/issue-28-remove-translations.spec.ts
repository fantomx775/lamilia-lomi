import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test.setTimeout(600_000);

test("single-language admin content saves and reloads on the English public URL", async ({ page }, testInfo) => {
  test.skip(
    !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
    "Uses the local demo admin session and restores its disposable content store after verification.",
  );

  const releaseContentStoreLock = await acquireLocalContentStoreLock();
  const contentStorePath = path.resolve(process.cwd(), "data", "lamilialomi-content.local.json");
  const hadContentStore = fs.existsSync(contentStorePath);
  const originalContentStore = hadContentStore ? fs.readFileSync(contentStorePath) : undefined;
  const screenshotDirectory = path.resolve(process.cwd(), "docs", "verification", "issue-42");
  const browserDiagnostics = {
    consoleErrors: [] as string[],
    pageErrors: [] as string[],
    failedRequests: [] as Array<{ method: string; url: string; error: string | null; disposition: "expected" | "unresolved"; reason?: string }>,
    failedResponses: [] as Array<{ method: string; url: string; status: number }>,
  };
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  page.on("console", (message) => {
    if (message.type() === "error") browserDiagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserDiagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url()).pathname;
    const error = request.failure()?.errorText ?? null;
    const requestUrl = new URL(request.url());
    const isExpectedNavigationAbort = error === "net::ERR_ABORTED" && (
      request.isNavigationRequest() ||
      request.resourceType() === "font" ||
      Boolean(request.headers()["next-action"]) ||
      (request.resourceType() === "fetch" && requestUrl.searchParams.has("_rsc"))
    );
    browserDiagnostics.failedRequests.push({
      method: request.method(),
      url,
      error,
      disposition: isExpectedNavigationAbort ? "expected" : "unresolved",
      ...(isExpectedNavigationAbort ? {
        reason: "The browser canceled a navigation, Server Action, Next route-transition, or page font request while the test moved to its next asserted route; saved fields and public route content are rechecked after reload.",
      } : {}),
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      browserDiagnostics.failedResponses.push({
        method: response.request().method(),
        url: new URL(response.url()).pathname,
        status: response.status(),
      });
    }
  });

  try {
    await page.goto("/pl/login?redirectTo=/admin/products");
    await page.getByLabel("Email").fill("admin@lamilialomi.test");
    await page.getByLabel("Password").fill("demo-password");
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/admin/products"),
      page.getByRole("button", { name: "Continue" }).click(),
    ]);

    await page.goto("/admin/products/new");
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.locator('#product-editor-form input[name="assetLocale"]')).toHaveCount(0);
    await page.getByLabel("Tytuł").fill("Issue 28 single language product");
    await page.getByLabel("Krótki opis").fill("Saved in the single English content language.");
    await page.getByLabel("Adres produktu").fill("issue-28-single-language-product");
    await saveScreenshot(page, screenshotDirectory, "product-editor", testInfo.project.name);
    await page.getByRole("button", { name: /Zapisz/ }).click();
    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]+\?saved=1$/i);
    await expect(page.getByRole("heading", { name: "Edycja: Issue 28 single language product" })).toBeVisible();
    await expect(page.getByLabel("Tytuł")).toHaveValue("Issue 28 single language product");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Edycja: Issue 28 single language product" })).toBeVisible();
    await expect(page.getByLabel("Tytuł")).toHaveValue("Issue 28 single language product");
    await expect(page.getByLabel("Krótki opis")).toHaveValue("Saved in the single English content language.");

    await page.goto("/admin/categories");
    await expect(page.getByRole("columnheader", { name: "Języki" })).toHaveCount(0);
    await page.getByRole("button", { name: "Dodaj kategorię" }).click();
    const categoryDialog = page.getByRole("dialog", { name: "Nowa kategoria" });
    await expect(categoryDialog.getByRole("tab")).toHaveCount(0);
    await categoryDialog.getByLabel("Nazwa").fill("Issue 28 category");
    await categoryDialog.getByLabel("Opis").fill("One English description.");
    await categoryDialog.locator('input[name="slug"]').fill("issue-28-category");
    await saveScreenshot(page, screenshotDirectory, "category-editor", testInfo.project.name);
    await categoryDialog.getByRole("button", { name: "Zapisz" }).click();
    await expect(page.getByRole("button", { name: "Edytuj kategorię Issue 28 category" })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Edytuj kategorię Issue 28 category" }).click();
    const savedCategoryDialog = page.getByRole("dialog", { name: "Edytuj kategorię" });
    await expect(savedCategoryDialog.getByLabel("Nazwa")).toHaveValue("Issue 28 category");
    await expect(savedCategoryDialog.getByLabel("Opis")).toHaveValue("One English description.");

    await page.goto("/admin/pages/terms");
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.locator('#page-editor-form input[name="title_pl"]')).toHaveCount(0);
    await page.getByLabel("Tytuł").fill("Issue 28 terms content");
    await page.getByLabel("Treść").fill("Updated English terms saved through the single-language editor.");
    await saveScreenshot(page, screenshotDirectory, "terms-editor", testInfo.project.name);
    await page.getByRole("button", { name: "Zapisz" }).first().click();
    await expect(page).toHaveURL(/\/admin\/pages\/terms\?saved=1$/);
    await expect(page.getByText("Zapisano zmiany.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Tytuł")).toHaveValue("Issue 28 terms content");
    await expect(page.getByLabel("Treść")).toHaveValue("Updated English terms saved through the single-language editor.");

    await page.goto("/en/terms");
    await expect(page.getByRole("heading", { name: "Issue 28 terms content" })).toBeVisible();
    await expect(page.getByText("Updated English terms saved through the single-language editor.")).toBeVisible();
    await page.goto("/pl/terms");
    await expect(page).toHaveURL(/\/en\/terms$/);
    await expect(page.getByRole("heading", { name: "Issue 28 terms content" })).toBeVisible();

    await testInfo.attach("browser-diagnostics.json", {
      body: Buffer.from(JSON.stringify(browserDiagnostics, null, 2)),
      contentType: "application/json",
    });
    console.log(`BROWSER_DIAGNOSTICS issue-28 ${JSON.stringify(browserDiagnostics)}`);
    expect(browserDiagnostics.consoleErrors).toEqual([]);
    expect(browserDiagnostics.pageErrors).toEqual([]);
    expect(browserDiagnostics.failedRequests.filter((request) => request.disposition === "unresolved")).toEqual([]);
    expect(browserDiagnostics.failedResponses).toEqual([]);
  } finally {
    try {
      if (originalContentStore) {
        fs.writeFileSync(contentStorePath, originalContentStore);
      } else if (fs.existsSync(contentStorePath)) {
        fs.rmSync(contentStorePath);
      }
    } finally {
      releaseContentStoreLock();
    }
  }
});

async function saveScreenshot(page: import("@playwright/test").Page, directory: string, name: string, projectName: string) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const screenshotStyles = await page.addStyleTag({
    content: "nextjs-portal, [data-testid='product-save-bar'] { display: none !important; } [class~='sticky'] { position: static !important; top: auto !important; bottom: auto !important; }",
  });
  try {
    await page.screenshot({
      path: path.join(directory, `${name}-${projectName}.png`),
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await screenshotStyles.evaluate((element) => element.parentNode?.removeChild(element));
  }
}
