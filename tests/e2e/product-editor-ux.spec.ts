import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test.setTimeout(600_000);

let releaseContentStoreLock: (() => void) | undefined;

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
    "Product editor E2E uses fixed demo admin credentials and disposable records; it requires a loopback app running the local demo backend.",
  );
  releaseContentStoreLock = await acquireLocalContentStoreLock();
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ll_cookie_consent",
      JSON.stringify({ essential: true, analytics: false }),
    );
  });
});

test.afterEach(() => {
  releaseContentStoreLock?.();
  releaseContentStoreLock = undefined;
});

test("product editor preserves work, saves all statuses, and keeps Save reachable", async ({ page, browser }, testInfo) => {
  const suffix = `issue-25-${testInfo.project.name}`;
  const titleText = `UX Product ${suffix}`;
  const slug = `ux-product-${suffix.toLowerCase()}`;
  const shortDescription = "Temporary local product used to verify the complete editor flow.";
  const simulatedFailures: string[] = [];
  const browserDiagnostics = createBrowserDiagnostics();
  collectBrowserDiagnostics(page, browserDiagnostics);
  let productPath: string | undefined;
  let createdProductId: string | undefined;
  let productSaved = false;

  try {
    await withExpectedNavigation(browserDiagnostics, "admin login redirect", () => signInAsAdmin(page));
    await page.goto("/admin/products/new");
    await expect(page.getByRole("heading", { name: "Nowy produkt" })).toBeVisible();
    createdProductId = await page.locator('#product-editor-form input[name="id"]').inputValue();

    await page.getByLabel("Tytuł").fill(titleText);
    await page.getByLabel("Krótki opis").fill(shortDescription);
    await page.getByLabel("Adres produktu").fill(slug);
    await page.getByLabel("Pozycja w katalogu").fill("37");
    await page.getByLabel("Przypomnienie o opinii po (dniach)").fill("9");

    await page.getByLabel("Tytuł").fill("");
    await page.getByRole("button", { name: /Zapisz/ }).click();
    await expect(page.getByText("Nie udało się zapisać. Twoje wpisane wartości są zachowane.")).toBeVisible();
    await expect(page.getByLabel("Tytuł")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Krótki opis")).toHaveValue(shortDescription);
    await expect(page).toHaveURL(/\/admin\/products\/new$/);

    await page.getByLabel("Tytuł").fill(titleText);
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"] && simulatedFailures.length === 0) {
        simulatedFailures.push(`${request.method()} ${request.url()}`);
        await new Promise((resolve) => setTimeout(resolve, 400));
        await route.fulfill({ status: 503, contentType: "text/plain", body: "Simulated local save failure" });
        return;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: /Zapisz/ }).click();
    await expect(page.getByTestId("product-save-bar")).toContainText("Zapisywanie…");
    await expect(page.getByRole("button", { name: /Zapisywanie/ })).toBeDisabled();
    await expect(page.getByText("Nie udało się zapisać. Twoje wpisane wartości są zachowane.")).toBeVisible();
    await expect(page.getByLabel("Tytuł")).toHaveValue(titleText);
    await expect(page.getByLabel("Krótki opis")).toHaveValue(shortDescription);
    expect(simulatedFailures).toHaveLength(1);
    await page.unrouteAll();

    await withExpectedNavigation(browserDiagnostics, "create product and open its editor", async () => {
      await page.getByRole("button", { name: /Zapisz/ }).click();
      await expect(page.getByText("Zapisano. Zmiany są aktualne.")).toBeVisible();
      productSaved = true;
      await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]+\?saved=1$/i);
    });
    const verifiedProductPath = new URL(page.url()).pathname;
    productPath = verifiedProductPath;
    await expect(page.getByText("Zapisano zmiany.", { exact: true })).toBeVisible();
    await waitForAdminTransition(page);
    await expect(page.getByLabel("Status")).toHaveValue("draft");
    await expect(page.getByLabel("Adres produktu")).toHaveValue(slug);
    await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("37");
    await expect(page.getByLabel("Przypomnienie o opinii po (dniach)")).toHaveValue("9");

    if (testInfo.project.name === "mobile") {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    } else {
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    const saveBar = page.getByTestId("product-save-bar");
    await expect(saveBar).toBeVisible();
    await expect(saveBar.getByRole("button", { name: /Zapisz/ })).toBeVisible();
    const saveBarBox = await saveBar.boundingBox();
    const viewport = page.viewportSize();
    expect(saveBarBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(saveBarBox!.y + saveBarBox!.height).toBeLessThanOrEqual(viewport!.height + 1);
    await saveScreenshot(page, `product-editor-${testInfo.project.name}.png`);

    await page.getByLabel("Pozycja w katalogu").fill("38");
    await expect(page.getByText("Zapisano zmiany.", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("product-save-bar")).toContainText("Niezapisane zmiany");
    const productsBackLink = page.locator('a[href="/admin/products"]').last();
    await withExpectedNavigation(browserDiagnostics, "dismiss unsaved internal navigation", async () => {
      page.once("dialog", (dialog) => void dialog.dismiss());
      await productsBackLink.click();
      await expect(page).toHaveURL(editorUrlRegex(verifiedProductPath));
      await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("38");
    });

    await withExpectedNavigation(browserDiagnostics, "dismiss beforeunload during reload", async () => {
      const beforeUnload = page.waitForEvent("dialog");
      const reload = page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      const dialog = await beforeUnload;
      expect(dialog.type()).toBe("beforeunload");
      await dialog.dismiss();
      await Promise.race([reload, page.waitForTimeout(2_000)]);
      await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("38");
    });

    await withExpectedNavigation(browserDiagnostics, "save edited product, leave, reopen, and reload", async () => {
      await page.getByRole("button", { name: /Zapisz/ }).click();
      await expect(page.getByText("Zapisano. Zmiany są aktualne.")).toBeVisible();
      await page.locator('a[href="/admin/products"]').last().click();
      await expect(page).toHaveURL(/\/admin\/products$/);
      await page.getByRole("link", { name: titleText, exact: false }).click();
      await expect(page).toHaveURL(editorUrlRegex(verifiedProductPath));
      await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("38");
      await expect(page.getByLabel("Przypomnienie o opinii po (dniach)")).toHaveValue("9");
      await page.reload();
      await expect(page.getByLabel("Adres produktu")).toHaveValue(slug);
      await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("38");
      await expect(page.getByLabel("Przypomnienie o opinii po (dniach)")).toHaveValue("9");
    });

    await withExpectedNavigation(browserDiagnostics, "open products and go Back to editor", async () => {
      await page.locator('a[href="/admin/products"]').last().click();
      await expect(page).toHaveURL(/\/admin\/products$/);
      await page.goBack();
      await expect(page).toHaveURL(editorUrlRegex(verifiedProductPath));
    });
    await page.getByLabel("Pozycja w katalogu").fill("39");
    await expect(page.getByTestId("product-save-bar")).toContainText("Niezapisane zmiany");

    await withExpectedNavigation(browserDiagnostics, "dismiss unsaved Forward navigation", async () => {
      const cancelForwardPromise = page.waitForEvent("dialog");
      void page.goForward().catch(() => null);
      const cancelForwardDialog = await cancelForwardPromise;
      expect(cancelForwardDialog.type()).toBe("confirm");
      await cancelForwardDialog.dismiss();
      await expect(page).toHaveURL(editorUrlRegex(verifiedProductPath));
      await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("39");
    });

    await withExpectedNavigation(browserDiagnostics, "accept Forward navigation and reopen editor", async () => {
      const acceptForwardPromise = page.waitForEvent("dialog");
      void page.goForward().catch(() => null);
      const acceptForwardDialog = await acceptForwardPromise;
      expect(acceptForwardDialog.type()).toBe("confirm");
      await acceptForwardDialog.accept();
      await expect(page).toHaveURL(/\/admin\/products$/);
      await page.getByRole("link", { name: titleText, exact: false }).click();
      await expect(page).toHaveURL(editorUrlRegex(verifiedProductPath));
      await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("38");
    });

    await page.getByLabel("Pozycja w katalogu").fill("42");
    await withExpectedNavigation(browserDiagnostics, "navigate away, unmount, and traverse history", async () => {
      const acceptAfterUnmountNavigationPromise = page.waitForEvent("dialog", { timeout: 5_000 });
      void page.locator('a[href="/admin/products"]').last().click().catch(() => null);
      const acceptAfterUnmountNavigation = await acceptAfterUnmountNavigationPromise;
      expect(acceptAfterUnmountNavigation.type()).toBe("confirm");
      await acceptAfterUnmountNavigation.accept();
      await expect(page).toHaveURL(/\/admin\/products$/);
      await page.goBack();
      await expect(page).toHaveURL(editorUrlRegex(verifiedProductPath));
      await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("38");
      await page.goForward();
      await expect(page).toHaveURL(/\/admin\/products$/);
      await page.goBack();
      await expect(page).toHaveURL(editorUrlRegex(verifiedProductPath));
      await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("38");
    });

    await page.getByLabel("Pozycja w katalogu").fill("40");
    await expect(page.getByTestId("product-save-bar")).toContainText("Niezapisane zmiany");
    await withExpectedNavigation(browserDiagnostics, "dismiss unsaved Back navigation", async () => {
      const backDialogPromise = page.waitForEvent("dialog", { timeout: 5_000 });
      void page.goBack().catch(() => null);
      const backDialog = await backDialogPromise;
      expect(backDialog.type()).toBe("confirm");
      await backDialog.dismiss();
      await expect(page).toHaveURL(editorUrlRegex(verifiedProductPath));
      await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("40");
    });
    await withExpectedNavigation(browserDiagnostics, "save and reload edited product states", async () => {
      await page.getByRole("button", { name: /Zapisz/ }).click();
      await expect(page.getByText("Zapisano. Zmiany są aktualne.")).toBeVisible();

      await page.locator("#media-upload-cover").setInputFiles({
        name: "ux-cover.png",
        mimeType: "image/png",
        buffer: makePng(),
      });
      await expect(page.getByText("Przesłano", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Dodaj rynek" }).click();
      await page.getByLabel("Link").fill("https://www.amazon.com/dp/B0UXTEST25");
      await page.getByLabel("Status").selectOption("published");
      await page.getByRole("button", { name: /Zapisz/ }).click();
      await expect(page.getByText("Zapisano. Zmiany są aktualne.")).toBeVisible();
      await expect(page.locator("form header").getByText("Opublikowany", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Status")).toHaveValue("published");
      await page.reload();
      await expect(page.getByLabel("Status")).toHaveValue("published");
      await expect(page.locator("form header").getByText("Opublikowany", { exact: true })).toBeVisible();

      await page.getByLabel("Status").selectOption("archived");
      await page.getByRole("button", { name: /Zapisz/ }).click();
      await expect(page.getByText("Zapisano. Zmiany są aktualne.")).toBeVisible();
      await expect(page.locator("form header").getByText("Zarchiwizowany", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Status")).toHaveValue("archived");
      await page.reload();
      await expect(page.getByLabel("Status")).toHaveValue("archived");
      await expect(page.locator("form header").getByText("Zarchiwizowany", { exact: true })).toBeVisible();
    });

    if (testInfo.project.name === "chromium") {
      const noJsContext = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        javaScriptEnabled: false,
      });
      try {
        await noJsContext.addCookies(await page.context().cookies());
        const noJsPage = await noJsContext.newPage();
        collectBrowserDiagnostics(noJsPage, browserDiagnostics);
        await noJsPage.goto(productPath, { waitUntil: "domcontentloaded" });
        const form = noJsPage.locator("#product-editor-form");
        await form.waitFor({ state: "attached" });
        await expect(form).toHaveAttribute("method", "POST");
      } finally {
        await noJsContext.close();
      }

      const legacyContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
      try {
        await legacyContext.addCookies(await page.context().cookies());
        await legacyContext.addInitScript(() => {
          Object.defineProperty(window, "navigation", { configurable: true, value: undefined });
        });
        const legacyPage = await legacyContext.newPage();
        collectBrowserDiagnostics(legacyPage, browserDiagnostics);
        await legacyPage.goto(productPath);
        await withExpectedNavigation(browserDiagnostics, "legacy browser Back/Forward and internal navigation", async () => {
          await legacyPage.locator('a[href="/admin/products"]').last().click();
          await expect(legacyPage).toHaveURL(/\/admin\/products$/);
          await legacyPage.goBack();
          await expect(legacyPage).toHaveURL(editorUrlRegex(verifiedProductPath));
          await legacyPage.getByLabel("Pozycja w katalogu").fill("41");

          const cancelLegacyForwardPromise = legacyPage.waitForEvent("dialog", { timeout: 5_000 });
          void legacyPage.goForward().catch(() => null);
          const cancelLegacyForwardDialog = await cancelLegacyForwardPromise;
          expect(cancelLegacyForwardDialog.type()).toBe("confirm");
          await cancelLegacyForwardDialog.dismiss();
          await expect(legacyPage).toHaveURL(editorUrlRegex(verifiedProductPath));
          await expect(legacyPage.getByLabel("Pozycja w katalogu")).toHaveValue("41");

          const acceptLegacyForwardPromise = legacyPage.waitForEvent("dialog", { timeout: 5_000 });
          void legacyPage.goForward().catch(() => null);
          const acceptLegacyForwardDialog = await acceptLegacyForwardPromise;
          expect(acceptLegacyForwardDialog.type()).toBe("confirm");
          await acceptLegacyForwardDialog.accept();
          await expect(legacyPage).toHaveURL(/\/admin\/products$/);
          await legacyPage.getByRole("link", { name: titleText, exact: false }).click();
          await expect(legacyPage).toHaveURL(editorUrlRegex(verifiedProductPath));
          await expect(legacyPage.getByLabel("Pozycja w katalogu")).toHaveValue("40");

          await legacyPage.getByLabel("Pozycja w katalogu").fill("43");
          const acceptDirtyInternalNavigationPromise = legacyPage.waitForEvent("dialog", { timeout: 5_000 });
          void legacyPage.locator('a[href="/admin/products"]').last().click().catch(() => null);
          const acceptDirtyInternalNavigationDialog = await acceptDirtyInternalNavigationPromise;
          expect(acceptDirtyInternalNavigationDialog.type()).toBe("confirm");
          await acceptDirtyInternalNavigationDialog.accept();
          await expect(legacyPage).toHaveURL(/\/admin\/products$/);
          await legacyPage.goBack();
          await expect(legacyPage).toHaveURL(editorUrlRegex(verifiedProductPath));
          await expect(legacyPage.getByLabel("Pozycja w katalogu")).toHaveValue("40");
          await legacyPage.getByLabel("Pozycja w katalogu").fill("44");

          const cancelDirtyLegacyForwardPromise = legacyPage.waitForEvent("dialog", { timeout: 5_000 });
          void legacyPage.goForward().catch(() => null);
          const cancelDirtyLegacyForwardDialog = await cancelDirtyLegacyForwardPromise;
          expect(cancelDirtyLegacyForwardDialog.type()).toBe("confirm");
          await cancelDirtyLegacyForwardDialog.dismiss();
          await expect(legacyPage).toHaveURL(editorUrlRegex(verifiedProductPath));
          await expect(legacyPage.getByLabel("Pozycja w katalogu")).toHaveValue("44");

          await legacyPage.getByLabel("Pozycja w katalogu").fill("41");
          await expect(legacyPage.getByTestId("product-save-bar")).toContainText("Niezapisane zmiany");
          await legacyPage.getByLabel("Pozycja w katalogu").fill("40");
          await expect(legacyPage.getByTestId("product-save-bar")).not.toContainText("Niezapisane zmiany");
          await legacyPage.getByLabel("Pozycja w katalogu").fill("42");
          await expect(legacyPage.getByTestId("product-save-bar")).toContainText("Niezapisane zmiany");
          const cancelLegacyBackPromise = legacyPage.waitForEvent("dialog", { timeout: 5_000 });
          void legacyPage.goBack().catch(() => null);
          const cancelLegacyBackDialog = await cancelLegacyBackPromise;
          expect(cancelLegacyBackDialog.type()).toBe("confirm");
          await cancelLegacyBackDialog.dismiss();
          await expect(legacyPage).toHaveURL(editorUrlRegex(verifiedProductPath));
          await expect(legacyPage.getByLabel("Pozycja w katalogu")).toHaveValue("42");
        });
      } finally {
        await legacyContext.close();
      }
    }
  } finally {
    const cleanupPath = productPath ?? (productSaved && createdProductId ? `/admin/products/${createdProductId}` : undefined);
    if (cleanupPath) {
      const acceptDialogs = (dialog: import("@playwright/test").Dialog) => void dialog.accept();
      page.on("dialog", acceptDialogs);
      try {
        await withExpectedNavigation(browserDiagnostics, "delete test product and verify cleanup", async () => {
          await page.goto(cleanupPath);
          const localContentPath = path.resolve(process.cwd(), "data", "lamilialomi-content.local.json");
          await page.getByRole("button", { name: "Usuń produkt" }).click();
          await expect(page).toHaveURL(/\/admin\/products\?deleted=1$/);
          const productId = cleanupPath.split("/").at(-1)!;
          if (fs.existsSync(localContentPath)) {
            const snapshot = JSON.parse(fs.readFileSync(localContentPath, "utf8")) as {
              products?: Array<{ id?: string }>;
            };
            expect(snapshot.products?.some((product) => product.id === productId)).not.toBe(true);
          }
          const uploadDirectory = path.resolve(process.cwd(), "public", "uploads", productId);
          if (fs.existsSync(uploadDirectory)) {
            expect(listFilesRecursively(uploadDirectory)).toEqual([]);
          }
        });
      } finally {
        page.off("dialog", acceptDialogs);
      }
    }
    if (productSaved) {
      for (const request of browserDiagnostics.failedRequests) {
        if (
          request.method === "POST" &&
          new URL(request.url).pathname === "/admin/products/new" &&
          request.error === "net::ERR_ABORTED" &&
          request.disposition === "unresolved"
        ) {
          request.disposition = "expected";
          request.reason = "Next canceled the create Server Action while opening the saved editor; persisted fields were verified after reload and the product was deleted during cleanup.";
        }
      }
    }
    await testInfo.attach("browser-diagnostics.json", {
      body: Buffer.from(JSON.stringify(browserDiagnostics, null, 2)),
      contentType: "application/json",
    });
    console.log(`BROWSER_DIAGNOSTICS ${testInfo.project.name} ${JSON.stringify(browserDiagnostics)}`);
    assertBrowserDiagnosticsClean(browserDiagnostics);
  }
});

test("product editor keeps submitted values after a no-JavaScript save error", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The no-JavaScript form fallback is checked in Chromium.");
  test.setTimeout(60_000);

  await signInAsAdmin(page);
  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  const browserDiagnostics = createBrowserDiagnostics();

  try {
    const noJsPage = await context.newPage();
    collectBrowserDiagnostics(noJsPage, browserDiagnostics);
    await noJsPage.goto("/admin/products/new", { waitUntil: "domcontentloaded", timeout: 15_000 });
    await expect(noJsPage.locator("#product-editor-form")).toBeVisible({ timeout: 15_000 });
    const titleInput = noJsPage.getByLabel("Tytuł");
    const title = `No JS retained ${Date.now()}`;
    const description = "Submitted values survive a server validation error without JavaScript.";
    await titleInput.fill(title, { timeout: 10_000 });
    await noJsPage.getByLabel("Krótki opis").fill(description, { timeout: 10_000 });
    await noJsPage.getByLabel("Adres produktu").fill(`no-js-retained-${Date.now()}`, { timeout: 10_000 });
    await noJsPage.getByLabel("Pozycja w katalogu").fill("73", { timeout: 10_000 });
    await noJsPage.getByLabel("Status").selectOption("published", { timeout: 10_000 });

    const saveButton = noJsPage.getByRole("button", { name: /Zapisz produkt/ });
    await expect(saveButton).toBeVisible();
    const saveButtonBox = await saveButton.boundingBox();
    const viewport = noJsPage.viewportSize();
    expect(saveButtonBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(saveButtonBox!.y + saveButtonBox!.height).toBeLessThanOrEqual(viewport!.height + 1);

    const responsePromise = noJsPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await saveButton.click({ timeout: 10_000 });
    const response = await responsePromise;
    expect(response?.ok()).toBe(true);
    await expect(noJsPage.getByText("Nie udało się zapisać. Twoje wpisane wartości są zachowane.")).toBeVisible();
    await expect(noJsPage.getByLabel("Tytuł")).toHaveValue(title);
    await expect(noJsPage.getByLabel("Krótki opis")).toHaveValue(description);
    await expect(titleInput).not.toHaveAttribute("aria-invalid", "true");
    await expect(noJsPage.getByLabel("Krótki opis")).not.toHaveAttribute("aria-invalid", "true");
    await expect(noJsPage.getByLabel("Adres produktu")).toHaveValue(/no-js-retained-/);
    await expect(noJsPage.getByLabel("Pozycja w katalogu")).toHaveValue("73");
    await expect(noJsPage.getByLabel("Status")).toHaveValue("published");
  } finally {
    await context.close();
    await testInfo.attach("browser-diagnostics.json", {
      body: Buffer.from(JSON.stringify(browserDiagnostics, null, 2)),
      contentType: "application/json",
    });
    console.log(`BROWSER_DIAGNOSTICS no-js ${JSON.stringify(browserDiagnostics)}`);
    assertBrowserDiagnosticsClean(browserDiagnostics);
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

function createBrowserDiagnostics() {
  return {
    consoleErrors: [] as Array<{ message: string; disposition: string; reason?: string }>,
    pageErrors: [] as string[],
    failedRequests: [] as Array<{ method: string; url: string; error: string | null; disposition: string; reason?: string }>,
    failedResponses: [] as Array<{ method: string; url: string; status: number; disposition: string; reason?: string }>,
    pendingNavigationPhases: [] as string[],
  };
}

function collectBrowserDiagnostics(page: Page, diagnostics: ReturnType<typeof createBrowserDiagnostics>) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("status of 503")) {
      diagnostics.consoleErrors.push({
        message: text,
        disposition: "expected",
        reason: "The test deliberately returns HTTP 503 once to verify retained form values after a failed save.",
      });
    } else if (text.includes("status of 415")) {
      diagnostics.consoleErrors.push({
        message: text,
        disposition: "expected",
        reason: "Local upload mode intentionally returns 415 to select the multipart fallback, which the test verifies succeeds.",
      });
    } else {
      diagnostics.consoleErrors.push({ message: text, disposition: "unresolved" });
    }
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText ?? null;
    const url = new URL(request.url());
    const sanitizedUrl = sanitizeRequestUrl(request.url());
    const pendingPhase = diagnostics.pendingNavigationPhases.at(-1);
    if (error === "net::ERR_ABORTED" && pendingPhase && isVerifiedEditorNavigationRequest(request, url)) {
      diagnostics.failedRequests.push({
        method: request.method(),
        url: sanitizedUrl,
        error,
        disposition: "expected",
        reason: `The browser canceled a ${describeEditorNavigationRequest(request, url)} during the explicitly asserted ${pendingPhase} phase.`,
      });
    } else if (error === "csp" && url.pathname.includes("browser_dev_hmr-client")) {
      diagnostics.failedRequests.push({
        method: request.method(),
        url: sanitizedUrl,
        error,
        disposition: "unrelated",
        reason: "The local Next.js development HMR client is blocked by the app CSP; this development-only bundle is not used in Production.",
      });
    } else {
      diagnostics.failedRequests.push({
        method: request.method(),
        url: sanitizedUrl,
        error,
        disposition: "unresolved",
      });
    }
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const request = response.request();
    const url = sanitizeRequestUrl(request.url());
    if (response.status() === 503 && request.method() === "POST" && Boolean(request.headers()["next-action"])) {
      diagnostics.failedResponses.push({
        method: request.method(),
        url,
        status: response.status(),
        disposition: "expected",
        reason: "The test deliberately injects one failed Server Action response to verify the editor retains submitted values.",
      });
      return;
    }
    if (response.status() === 415 && request.method() === "POST" && new URL(request.url()).pathname === "/api/admin/assets") {
      diagnostics.failedResponses.push({
        method: request.method(),
        url,
        status: response.status(),
        disposition: "expected",
        reason: "The local upload endpoint selects the multipart fallback; the upload then succeeds and appears in the editor.",
      });
      return;
    }
    diagnostics.failedResponses.push({
      method: request.method(),
      url,
      status: response.status(),
      disposition: "unresolved",
    });
  });
}

function isVerifiedEditorNavigationRequest(request: import("@playwright/test").Request, url: URL) {
  const isEditorFlowRoute = url.pathname === "/pl/login" && url.searchParams.get("redirectTo") === "/admin" ||
    url.pathname === "/admin" ||
    url.pathname === "/admin/products" ||
    url.pathname === "/admin/products/new" ||
    /^\/admin\/products\/[0-9a-f-]+$/i.test(url.pathname);
  if (!isEditorFlowRoute) return false;

  if (request.isNavigationRequest() && request.method() === "GET") return true;
  if (request.resourceType() !== "fetch") return false;
  if (request.method() === "GET" && url.searchParams.has("_rsc")) return true;
  return request.method() === "POST" && Boolean(request.headers()["next-action"]);
}

function describeEditorNavigationRequest(request: import("@playwright/test").Request, url: URL) {
  if (request.isNavigationRequest()) return "document navigation";
  if (request.method() === "POST" && request.headers()["next-action"]) return "Server Action";
  if (url.searchParams.has("_rsc")) return "Next.js route transition";
  return "editor-flow navigation request";
}

function assertBrowserDiagnosticsClean(diagnostics: ReturnType<typeof createBrowserDiagnostics>) {
  expect(diagnostics.consoleErrors.filter(({ disposition }) => disposition === "unresolved")).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.failedRequests.filter(({ disposition }) => disposition === "unresolved")).toEqual([]);
  expect(diagnostics.failedResponses.filter(({ disposition }) => disposition === "unresolved")).toEqual([]);
}

async function withExpectedNavigation<T>(
  diagnostics: ReturnType<typeof createBrowserDiagnostics>,
  phase: string,
  action: () => Promise<T>,
): Promise<T> {
  diagnostics.pendingNavigationPhases.push(phase);
  try {
    return await action();
  } finally {
    const phaseIndex = diagnostics.pendingNavigationPhases.lastIndexOf(phase);
    if (phaseIndex >= 0) diagnostics.pendingNavigationPhases.splice(phaseIndex, 1);
  }
}

function sanitizeRequestUrl(requestUrl: string) {
  const url = new URL(requestUrl);
  return `${url.origin}${url.pathname}`;
}

async function saveScreenshot(page: Page, filename: string) {
  const directory = path.resolve(process.cwd(), "docs", "verification", "issue-25");
  fs.mkdirSync(directory, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const productId = page.getByText(/^ID: /);
  const productIdBounds = await productId.boundingBox();
  const viewport = page.viewportSize();
  const visibleProductId = productIdBounds && viewport && productIdBounds.y < viewport.height &&
    productIdBounds.y + productIdBounds.height > 0;
  await page.screenshot({
    path: path.join(directory, filename),
    animations: "disabled",
    mask: visibleProductId ? [productId] : [],
    maskColor: "#e6ddd1",
  });
}

async function waitForAdminTransition(page: Page) {
  const transition = page.locator(".admin-page-transition").first();
  await transition.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  });
}

function listFilesRecursively(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFilesRecursively(entryPath) : [entryPath];
  });
}

function makePng() {
  const width = 128;
  const height = 96;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (1 + width * 4);
    scanlines[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      const accent = x > 32 && x < 96 && y > 24 && y < 72;
      scanlines[offset] = accent ? 255 : 196;
      scanlines[offset + 1] = accent ? 255 : 93;
      scanlines[offset + 2] = accent ? 255 : 66;
      scanlines[offset + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function crc32(data: Buffer) {
  let checksum = 0xffffffff;
  for (const byte of data) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function editorUrlRegex(productPath: string) {
  return new RegExp(`${escapeRegex(productPath)}(?:\\?[^#]*)?$`);
}
