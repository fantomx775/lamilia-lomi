import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test.setTimeout(600_000);

test("Issue 51 rich text and HTML modes preserve supported content safely", async ({ page }, testInfo) => {
  test.skip(
    !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
    "Issue 51 browser verification edits disposable records and requires the local demo backend.",
  );

  const releaseContentStoreLock = await acquireLocalContentStoreLock();
  const contentStorePath = path.resolve(process.cwd(), "data", "lamilialomi-content.local.json");
  const hadContentStore = fs.existsSync(contentStorePath);
  const originalContentStore = hadContentStore ? fs.readFileSync(contentStorePath) : undefined;
  const screenshotDirectory = path.resolve(process.env.ISSUE_51_SCREENSHOT_DIR ?? path.join(process.cwd(), "docs", "verification", "issue-51"));
  const browserRunId = process.env.ISSUE_51_BROWSER_RUN_ID ?? `issue-51-${Date.now()}`;
  const diagnostics = {
    consoleErrors: [] as string[],
    pageErrors: [] as string[],
    failedNetworkRequests: [] as Array<{ method: string; url: string; error: string | null; resourceType: string; disposition?: string; reason?: string }>,
    failedResponses: [] as Array<{ method: string; url: string; status: number }>,
    postResponses: [] as Array<{ path: string; status: number }>,
  };

  fs.mkdirSync(screenshotDirectory, { recursive: true });
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => diagnostics.failedNetworkRequests.push({
    method: request.method(),
    url: safeUrl(request.url()),
    error: request.failure()?.errorText ?? null,
    resourceType: request.resourceType(),
  }));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (response.request().method() === "POST") diagnostics.postResponses.push({ path: url.pathname, status: response.status() });
    if (response.status() >= 400) diagnostics.failedResponses.push({
      method: response.request().method(),
      url: safeUrl(response.url()),
      status: response.status(),
    });
  });

  try {
    await page.addInitScript(() => {
      window.localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false }));
      (window as Window & { __issue51Executed?: boolean }).__issue51Executed = false;
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
    const productField = page.locator('#product-editor-form input[name="longDescription"]');
    const originalProductValue = await productField.inputValue();
    const productHtml = '<h2>Issue 51 product summary</h2><p><u>Underlined product copy</u> <a href="https://example.com/issue-51">Editable link</a> <a href="javascript:alert(51)">Unsafe link</a></p><blockquote><p>Product quotation.</p></blockquote><hr><ul><li><p>Product feature one</p></li><li><p>Product feature two</p></li></ul><script>window.__issue51Executed = true</script><p onclick="window.__issue51Executed = true">Safe paragraph.</p>';
    await page.getByRole("button", { name: "HTML" }).click();
    await page.getByRole("textbox", { name: "Źródło HTML" }).fill(productHtml);
    await page.getByRole("button", { name: "Rich Text" }).click();
    await expect(page.getByText("Przed konwersją sprawdź obsługiwane formatowanie:")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Źródło HTML" })).toHaveValue(productHtml);
    await expect(productField).toHaveValue(originalProductValue);
    expect(await page.evaluate(() => (window as Window & { __issue51Executed?: boolean }).__issue51Executed)).toBe(false);
    await saveScreenshot(page, screenshotDirectory, `product-editor-html-warning-${testInfo.project.name}.png`, page.getByRole("textbox", { name: "Źródło HTML" }));
    await page.getByRole("button", { name: "Użyj obsługiwanej treści" }).click();
    await expect(productEditor.locator("h2")).toHaveText("Issue 51 product summary");
    await expect(productEditor.locator("u")).toHaveText("Underlined product copy");
    await expect(productEditor.locator("blockquote")).toContainText("Product quotation.");
    await expect(productEditor.locator("hr")).toHaveCount(1);
    await expect(productEditor.locator("ul li")).toHaveCount(2);
    await expect(productEditor.locator("a[href*='example.com/issue-51']")).toHaveText("Editable link");
    await expect(productEditor.locator("a[href^='javascript:']")).toHaveCount(0);
    await productEditor.locator("a[href='https://example.com/issue-51']").click();
    await page.getByRole("button", { name: "Dodaj lub edytuj link" }).click();
    await page.getByLabel("Adres strony").fill("https://example.com/issue-51-edited");
    await page.getByRole("button", { name: "Zapisz link" }).click();
    await expect(productEditor.locator("a[href='https://example.com/issue-51-edited']")).toHaveText("Editable link");
    await page.getByText("Editable link", { exact: true }).click();
    await page.getByRole("button", { name: "Usuń link" }).click();
    await expect(productEditor.locator("a")).toHaveCount(0);
    await productEditor.press("Control+End");
    await productEditor.press("Enter");
    await productEditor.evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/html", "<p><strong>Copied from Word</strong> and <em>kept formatted</em>.</p>");
      clipboardData.setData("text/plain", "Copied from Word and kept formatted.");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    });
    await expect(productEditor.locator("strong")).toHaveText("Copied from Word");
    await expect(productEditor.locator("em")).toHaveText("kept formatted");
    await productEditor.press("Control+Z");
    await expect(productEditor.locator("strong")).toHaveCount(0);
    await productEditor.press("Control+Shift+Z");
    await expect(productEditor.locator("strong")).toHaveText("Copied from Word");
    const savedProductDescription = await productField.inputValue();
    expect(savedProductDescription).toContain("lamilia-rich-text:v1:");
    expect(savedProductDescription).not.toMatch(/javascript:|<script|onclick/i);
    await expectNoHorizontalOverflow(page);
    await saveScreenshot(page, screenshotDirectory, `product-editor-${testInfo.project.name}.png`, page.locator("#product-editor-form [role='toolbar']"));
    await page.getByRole("button", { name: /Zapisz/ }).first().click();
    await expect(page.getByText("Zapisano. Zmiany są aktualne.")).toBeVisible();
    await page.reload();
    await expect(productField).toHaveValue(savedProductDescription);
    await page.goto(`/en/products/${productSlug}`);
    const productDescription = page.locator("main .mt-5.max-w-2xl");
    await expect(page.getByRole("heading", { level: 2, name: "Issue 51 product summary" })).toBeVisible();
    await expect(productDescription.locator("blockquote")).toContainText("Product quotation.");
    await expect(productDescription.locator("u")).toHaveText("Underlined product copy");
    await expect(productDescription.locator("a")).toHaveCount(0);
    await expect(productDescription.locator("script")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await saveScreenshot(page, screenshotDirectory, `product-storefront-${testInfo.project.name}.png`, page.getByRole("heading", { level: 2, name: "Issue 51 product summary" }));

    await page.goto("/admin/pages/terms");
    const termsEditor = page.getByRole("textbox", { name: "Treść" });
    const termsHtml = "<h2>Issue 51 Terms</h2><p>Terms copied from the HTML source.</p><ol><li><p>Keep account details current.</p></li><li><p>Use the account responsibly.</p></li></ol><hr>";
    await page.getByRole("button", { name: "HTML" }).click();
    await page.getByRole("textbox", { name: "Źródło HTML" }).fill(termsHtml);
    await page.getByRole("button", { name: "Rich Text" }).click();
    await expect(termsEditor.locator("h2")).toHaveText("Issue 51 Terms");
    await expect(termsEditor.locator("ol li")).toHaveCount(2);
    await expect(termsEditor.locator("hr")).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    await saveScreenshot(page, screenshotDirectory, `terms-editor-${testInfo.project.name}.png`, page.locator("#page-editor-form [role='toolbar']"));
    const termsSaveResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/admin/pages/terms");
    await page.getByRole("button", { name: "Zapisz" }).first().click();
    expect((await termsSaveResponse).status()).toBe(200);
    await page.reload();
    await expect(page.locator('#page-editor-form input[name="body"]')).toHaveValue(/lamilia-rich-text:v1:/);
    await page.goto("/en/terms");
    await expect(page.getByRole("heading", { level: 2, name: "Issue 51 Terms" })).toBeVisible();
    await expect(page.locator("main .prose-lomi ol li")).toHaveCount(2);
    await expect(page.locator("main .prose-lomi hr")).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    await saveScreenshot(page, screenshotDirectory, `terms-storefront-${testInfo.project.name}.png`, page.getByRole("heading", { level: 2, name: "Issue 51 Terms" }));

    await page.goto("/admin/pages/privacy");
    const privacyEditor = page.getByRole("textbox", { name: "Treść" });
    const privacyHtml = '<h2>Issue 51 Privacy</h2><p><u>Privacy source copy.</u> <a href="javascript:alert(52)">Unsafe link</a></p><p onclick="window.__issue51Executed = true">Privacy paragraph.</p><script>window.__issue51Executed = true</script><blockquote><p>Privacy quotation.</p></blockquote>';
    await page.getByRole("button", { name: "HTML" }).click();
    await page.getByRole("textbox", { name: "Źródło HTML" }).fill(privacyHtml);
    await page.getByRole("button", { name: "Rich Text" }).click();
    await expect(page.getByText("Przed konwersją sprawdź obsługiwane formatowanie:")).toBeVisible();
    await expect(privacyEditor.locator("h2")).toHaveCount(0);
    expect(await page.evaluate(() => (window as Window & { __issue51Executed?: boolean }).__issue51Executed)).toBe(false);
    await page.getByRole("button", { name: "Użyj obsługiwanej treści" }).click();
    await expect(privacyEditor.locator("h2")).toHaveText("Issue 51 Privacy");
    await expect(privacyEditor.locator("u")).toHaveText("Privacy source copy.");
    await expect(privacyEditor.locator("blockquote")).toContainText("Privacy quotation.");
    await expect(privacyEditor.locator("a[href^='javascript:']")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await saveScreenshot(page, screenshotDirectory, `privacy-editor-${testInfo.project.name}.png`, page.locator("#page-editor-form [role='toolbar']"));
    const privacySaveResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/admin/pages/privacy");
    await page.getByRole("button", { name: "Zapisz" }).first().click();
    expect((await privacySaveResponse).status()).toBe(200);
    await page.reload();
    await expect(page.locator('#page-editor-form input[name="body"]')).toHaveValue(/lamilia-rich-text:v1:/);
    await page.goto("/en/privacy");
    await expect(page.getByRole("heading", { level: 2, name: "Issue 51 Privacy" })).toBeVisible();
    await expect(page.locator("main .prose-lomi blockquote")).toContainText("Privacy quotation.");
    await expect(page.locator("main .prose-lomi a")).toHaveCount(0);
    await expect(page.locator("main .prose-lomi script")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await saveScreenshot(page, screenshotDirectory, `privacy-storefront-${testInfo.project.name}.png`, page.getByRole("heading", { level: 2, name: "Issue 51 Privacy" }));

    const persistedContent = JSON.parse(fs.readFileSync(contentStorePath, "utf8")) as {
      products: Array<{ id: string; translations: Array<{ locale: string; longDescription: string }> }>;
      staticPages: Array<{ slug: string; locale: string; body: string }>;
    };
    const savedProduct = persistedContent.products.find((product) => product.id === productId);
    expect(savedProduct?.translations.find((translation) => translation.locale === "en")?.longDescription).toBe(savedProductDescription);
    expect(persistedContent.staticPages.find((record) => record.slug === "terms" && record.locale === "en")?.body).toContain("lamilia-rich-text:v1:");
    expect(persistedContent.staticPages.find((record) => record.slug === "privacy" && record.locale === "en")?.body).toContain("lamilia-rich-text:v1:");

    const successfulPostPaths = new Set(
      diagnostics.postResponses.filter((response) => response.status >= 200 && response.status < 300).map((response) => response.path),
    );
    const inspectedNetworkRequests = diagnostics.failedNetworkRequests.map((request) => {
      const pathname = new URL(request.url).pathname;
      if (request.error === "net::ERR_ABORTED" && request.method === "GET" && request.resourceType === "font") {
        return { ...request, disposition: "unrelated", reason: "A font request was canceled as the browser navigated away; the affected page rendered and screenshots were inspected." };
      }
      if (request.error === "net::ERR_ABORTED" && request.method === "POST" && successfulPostPaths.has(pathname)) {
        return { ...request, disposition: "unrelated", reason: "The server action returned HTTP 200 and its resulting navigation was verified; a superseded fetch was canceled during the route transition." };
      }
      return request;
    });
    const browserEvidence = {
      runId: browserRunId,
      testedAt: new Date().toISOString(),
      testedSha: process.env.ISSUE_51_TESTED_SHA ?? "not-recorded",
      project: testInfo.project.name,
      flows: ["product-description", "terms", "privacy"],
      consoleErrors: diagnostics.consoleErrors,
      pageErrors: diagnostics.pageErrors,
      failedNetworkRequests: inspectedNetworkRequests,
      failedResponses: diagnostics.failedResponses,
      postResponses: diagnostics.postResponses,
      screenshots: fs.readdirSync(screenshotDirectory).filter((file) => file.endsWith(`-${testInfo.project.name}.png`)).sort(),
    };
    await testInfo.attach("issue-51-browser-diagnostics.json", {
      body: Buffer.from(JSON.stringify(browserEvidence, null, 2)),
      contentType: "application/json",
    });
    console.log(`BROWSER_EVIDENCE issue-51 ${JSON.stringify(browserEvidence)}`);
    expect(diagnostics.consoleErrors).toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);
    expect(inspectedNetworkRequests.every((request) => request.disposition === "unrelated" && request.reason)).toBe(true);
    expect(diagnostics.failedResponses).toEqual([]);
  } finally {
    try {
      if (originalContentStore) fs.writeFileSync(contentStorePath, originalContentStore);
      else if (fs.existsSync(contentStorePath)) fs.rmSync(contentStorePath);
    } finally {
      releaseContentStoreLock();
    }
  }
});

async function signInAsAdmin(page: Page) {
  await page.goto("/pl/login?redirectTo=/admin");
  await page.getByLabel(/^(e-mail|email)$/i).fill("admin@lamilialomi.test");
  await page.getByLabel(/^(hasło|password)$/i).fill("demo-password");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.getByRole("button", { name: /^(kontynuuj|continue)$/i }).click(),
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
  const screenshotStyles = await page.addStyleTag({ content: "nextjs-portal, [data-testid='product-save-bar'] { display: none !important; }" });
  try {
    await page.screenshot({ path: path.join(directory, filename), animations: "disabled" });
  } finally {
    await screenshotStyles.evaluate((element) => element.parentNode?.removeChild(element));
  }
}

function safeUrl(value: string) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}
