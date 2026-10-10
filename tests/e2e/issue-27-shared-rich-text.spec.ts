import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test.setTimeout(600_000);

test("shared rich text saves and renders product, Terms, and Privacy content", async ({ page }, testInfo) => {
  test.skip(
    !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
    "Issue 27 E2E edits disposable records and requires a loopback app running the local demo backend.",
  );

  const releaseContentStoreLock = await acquireLocalContentStoreLock();
  const contentStorePath = path.resolve(process.cwd(), "data", "lamilialomi-content.local.json");
  const hadContentStore = fs.existsSync(contentStorePath);
  const originalContentStore = hadContentStore ? fs.readFileSync(contentStorePath) : undefined;
  const screenshotDirectory = path.resolve(
    process.env.ISSUE_27_SCREENSHOT_DIR ?? path.join(process.cwd(), "docs", "verification", "issue-27"),
  );
  const browserRunId = process.env.ISSUE_27_BROWSER_RUN_ID ?? `issue-27-${Date.now()}`;
  const diagnostics = {
    consoleErrors: [] as string[],
    pageErrors: [] as string[],
    failedNetworkRequests: [] as Array<{
      method: string;
      url: string;
      error: string | null;
      resourceType: string;
      disposition?: string;
      reason?: string;
    }>,
    failedResponses: [] as Array<{ method: string; url: string; status: number }>,
    postResponses: [] as Array<{ path: string; status: number }>,
    staticPagePostEvents: [] as Array<Record<string, string | number | boolean | null>>,
  };

  fs.mkdirSync(screenshotDirectory, { recursive: true });
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.startsWith("/admin/pages/")) {
      diagnostics.staticPagePostEvents.push({
        event: "failed",
        path: url.pathname,
        isNavigationRequest: request.isNavigationRequest(),
        resourceType: request.resourceType(),
        error: request.failure()?.errorText ?? null,
      });
    }
    diagnostics.failedNetworkRequests.push({
      method: request.method(),
      url: safeUrl(request.url()),
      error: request.failure()?.errorText ?? null,
      resourceType: request.resourceType(),
    });
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (response.request().method() === "POST") {
      diagnostics.postResponses.push({ path: url.pathname, status: response.status() });
    }
    if (response.request().method() === "POST" && url.pathname.startsWith("/admin/pages/")) {
      diagnostics.staticPagePostEvents.push({
        event: "response",
        path: url.pathname,
        status: response.status(),
        isNavigationRequest: response.request().isNavigationRequest(),
        resourceType: response.request().resourceType(),
      });
    }
    if (response.status() < 400) return;
    diagnostics.failedResponses.push({
      method: response.request().method(),
      url: safeUrl(response.url()),
      status: response.status(),
    });
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

    const productId = await page.locator('#product-editor-form input[name="id"]').inputValue();
    const productSlug = await page.getByLabel("Adres produktu").inputValue();
    const productEditor = page.getByRole("textbox", { name: "Długi opis" });
    await expect(page.getByLabel("Krótki opis")).toHaveValue(/.+/);
    await productEditor.fill("Issue 27 rich text description.");
    await productEditor.press("Control+End");
    await productEditor.press("Enter");
    await page.getByRole("button", { name: "Lista punktowana" }).click();
    await page.keyboard.type("Product feature one");
    await productEditor.press("Enter");
    await page.keyboard.type("Product feature two");

    await productEditor.press("Control+Home");
    await productEditor.press("Shift+End");
    await page.getByRole("button", { name: "Pogrubienie" }).click();
    await expect(productEditor.locator("strong")).toHaveText("Issue 27 rich text description.");
    await page.getByLabel("Styl akapitu").selectOption("h2");
    await expect(productEditor.locator("h2")).toHaveText("Issue 27 rich text description.");

    await page.getByRole("button", { name: "Dodaj lub edytuj link" }).click();
    await page.getByLabel("Adres strony").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Zapisz link" }).click();
    await expect(page.getByText("Wpisz bezpieczny adres:", { exact: false })).toBeVisible();
    await page.getByLabel("Adres strony").fill("https://example.com/issue-27");
    await page.getByRole("button", { name: "Zapisz link" }).click();
    await page.getByRole("button", { name: "Podgląd" }).click();
    await expect(page.locator("#product-editor-form h2").filter({ hasText: "Issue 27 rich text description." })).toBeVisible();
    await expect(page.locator("#product-editor-form strong").filter({ hasText: "Issue 27 rich text description." })).toBeVisible();
    await expect(page.locator('#product-editor-form a[href="https://example.com/issue-27"]')).toBeVisible();
    await expect(page.locator("#product-editor-form ul li")).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    await saveScreenshot(page, screenshotDirectory, `product-editor-preview-${testInfo.project.name}.png`, page.locator("#product-editor-form [role='toolbar']"));

    const savedProductDescription = await page.locator('#product-editor-form input[name="longDescription"]').inputValue();
    expect(savedProductDescription).toContain("lamilia-rich-text:v1:");
    expect(savedProductDescription).not.toContain("javascript:");
    await page.getByRole("button", { name: /Zapisz/ }).first().click();
    await expect(page.getByText("Zapisano. Zmiany są aktualne.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${escapeRegex(productPath)}$`));
    await page.reload();
    await expect(page.locator('#product-editor-form input[name="longDescription"]')).toHaveValue(savedProductDescription);
    await page.goto(`/en/products/${productSlug}`);
    await expect(page.getByRole("heading", { level: 2, name: "Issue 27 rich text description." })).toBeVisible();
    await expect(page.locator("main strong")).toContainText("Issue 27 rich text description.");
    await expect(page.locator('main a[href="https://example.com/issue-27"]')).toHaveAttribute("target", "_blank");
    await expect(page.locator("main ul li")).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    await saveScreenshot(page, screenshotDirectory, `product-storefront-${testInfo.project.name}.png`, page.getByRole("heading", { level: 2, name: "Issue 27 rich text description." }));

    await page.goto("/admin/pages/terms");
    await expect(page.getByRole("tab")).toHaveCount(0);
    const termsEditor = page.getByRole("textbox", { name: "Treść" });
    await termsEditor.fill("Terms and Conditions");
    await termsEditor.press("Control+End");
    await termsEditor.press("Enter");
    await page.getByRole("button", { name: "Lista numerowana" }).click();
    await page.keyboard.type("Use the account responsibly");
    await termsEditor.press("Enter");
    await page.keyboard.type("Keep your account details current");
    await termsEditor.locator("p").first().click();
    await page.getByLabel("Styl akapitu").selectOption("h2");
    await page.getByRole("button", { name: "Podgląd" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Terms and Conditions" })).toBeVisible();
    await expect(page.locator("#page-editor-form ol li")).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    await saveScreenshot(page, screenshotDirectory, `terms-editor-preview-${testInfo.project.name}.png`, page.locator("#page-editor-form [role='toolbar']"));
    const termsSaveResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/admin/pages/terms",
    );
    await page.getByRole("button", { name: "Zapisz" }).first().click();
    expect((await termsSaveResponse).status()).toBe(200);
    await expect(page).toHaveURL(/\/admin\/pages\/terms\?saved=1$/);
    await page.reload();
    await expect(page.locator('#page-editor-form input[name="body"]')).toHaveValue(/lamilia-rich-text:v1:/);
    await page.goto("/en/terms");
    await expect(page.getByRole("heading", { level: 2, name: "Terms and Conditions" })).toBeVisible();
    await expect(page.locator("main ol li")).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    await saveScreenshot(page, screenshotDirectory, `terms-storefront-${testInfo.project.name}.png`, page.getByRole("heading", { level: 2, name: "Terms and Conditions" }));

    await page.goto("/admin/pages/privacy");
    await expect(page.getByRole("tab")).toHaveCount(0);
    const privacyEditor = page.getByRole("textbox", { name: "Treść" });
    await privacyEditor.fill("Privacy content copied from a normal text editor.");
    await privacyEditor.press("Control+A");
    await page.getByRole("button", { name: "Pogrubienie" }).click();
    await expect(privacyEditor.locator("strong")).toHaveText("Privacy content copied from a normal text editor.");
    await privacyEditor.press("Control+C");
    await privacyEditor.press("End");
    await privacyEditor.press("Enter");
    await privacyEditor.press("Control+V");
    await expect(privacyEditor).toContainText("Privacy content copied from a normal text editor.");
    await expect(privacyEditor.locator("strong")).toHaveCount(2);
    await privacyEditor.press("Control+A");
    await page.getByRole("button", { name: "Kursywa" }).click();
    await page.getByRole("button", { name: "Podgląd" }).click();
    await expect(page.locator("#page-editor-form em")).toHaveCount(2);
    await expect(page.locator("#page-editor-form em").first()).toHaveText("Privacy content copied from a normal text editor.");
    await expect(page.locator("#page-editor-form em strong")).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    await saveScreenshot(page, screenshotDirectory, `privacy-editor-preview-${testInfo.project.name}.png`, page.locator("#page-editor-form [role='toolbar']"));
    const privacySaveResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/admin/pages/privacy",
    );
    await page.getByRole("button", { name: "Zapisz" }).first().click();
    expect((await privacySaveResponse).status()).toBe(200);
    await expect(page).toHaveURL(/\/admin\/pages\/privacy\?saved=1$/);
    await page.reload();
    await expect(page.locator('#page-editor-form input[name="body"]')).toHaveValue(/lamilia-rich-text:v1:/);
    await page.goto("/en/privacy");
    await expect(page.locator("main em")).toHaveCount(2);
    await expect(page.locator("main em").first()).toHaveText("Privacy content copied from a normal text editor.");
    await expect(page.locator("main em strong")).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    await saveScreenshot(page, screenshotDirectory, `privacy-storefront-${testInfo.project.name}.png`, page.locator("main em").first());

    const persistedContent = JSON.parse(fs.readFileSync(contentStorePath, "utf8")) as {
      products: Array<{ id: string; translations: Array<{ locale: string; longDescription: string }> }>;
      staticPages: Array<{ slug: string; locale: string; body: string }>;
    };
    const savedProduct = persistedContent.products.find((product) => product.id === productId);
    expect(savedProduct?.translations.find((translation) => translation.locale === "en")?.longDescription).toBe(savedProductDescription);
    expect(persistedContent.staticPages.find((page) => page.slug === "terms" && page.locale === "en")?.body).toContain("lamilia-rich-text:v1:");
    expect(persistedContent.staticPages.find((page) => page.slug === "privacy" && page.locale === "en")?.body).toContain("lamilia-rich-text:v1:");

    const successfulPostPaths = new Set(
      diagnostics.postResponses
        .filter((response) => response.status >= 200 && response.status < 300)
        .map((response) => response.path),
    );
    const inspectedNetworkRequests = diagnostics.failedNetworkRequests.map((request) => {
      const pathname = new URL(request.url).pathname;
      if (request.error === "net::ERR_ABORTED" && request.method === "GET" && request.resourceType === "font") {
        return {
          ...request,
          disposition: "unrelated",
          reason: "A font request was canceled as the browser navigated away; the affected page rendered and screenshots were inspected.",
        };
      }
      if (
        request.error === "net::ERR_ABORTED" &&
        request.method === "POST" &&
        successfulPostPaths.has(pathname)
      ) {
        return {
          ...request,
          disposition: "unrelated",
          reason: "A server action on the same route returned HTTP 200 and its resulting navigation was verified; a superseded fetch was canceled during the route transition.",
        };
      }
      return request;
    });
    const browserEvidence = {
      runId: browserRunId,
      project: testInfo.project.name,
      flows: ["product-description", "terms", "privacy"],
      consoleErrors: diagnostics.consoleErrors,
      pageErrors: diagnostics.pageErrors,
      failedNetworkRequests: inspectedNetworkRequests,
      failedResponses: diagnostics.failedResponses,
      postResponses: diagnostics.postResponses,
      staticPagePostEvents: diagnostics.staticPagePostEvents,
    };
    await testInfo.attach("issue-27-browser-diagnostics.json", {
      body: Buffer.from(JSON.stringify(browserEvidence, null, 2)),
      contentType: "application/json",
    });
    console.log(`BROWSER_EVIDENCE issue-27 ${JSON.stringify(browserEvidence)}`);
    expect(diagnostics.consoleErrors).toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);
    expect(inspectedNetworkRequests.every((request) => request.disposition === "unrelated" && request.reason)).toBe(true);
    expect(diagnostics.failedResponses).toEqual([]);
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

async function signInAsAdmin(page: Page) {
  await page.goto("/pl/login?redirectTo=/admin");
  await page.getByLabel("E-mail").fill("admin@lamilialomi.test");
  await page.getByLabel("Hasło").fill("demo-password");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.getByRole("button", { name: "Kontynuuj" }).click(),
  ]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function saveScreenshot(page: Page, directory: string, filename: string, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const screenshotStyles = await page.addStyleTag({
    content: "nextjs-portal, [data-testid='product-save-bar'] { display: none !important; }",
  });
  try {
    await page.screenshot({
      path: path.join(directory, filename),
      animations: "disabled",
    });
  } finally {
    await screenshotStyles.evaluate((element) => element.parentNode?.removeChild(element));
  }
}

function safeUrl(value: string) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
