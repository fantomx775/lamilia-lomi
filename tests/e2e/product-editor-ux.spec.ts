import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test.setTimeout(180_000);

let releaseContentStoreLock: (() => void) | undefined;

type UploadedAssetFixture = {
  productId: string;
  kind: "cover";
  storagePath: string;
  storageProvider: string;
};

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
  const shortDescription = "Temporary local product used to verify the complete editor flow.";
  const simulatedFailures: string[] = [];
  const browserDiagnostics = createBrowserDiagnostics();
  collectBrowserDiagnostics(page, browserDiagnostics);
  const readerArtworkResponses = new Map<string, Array<{ phase?: string; response: Promise<{ status: number; body: unknown }> }>>();
  const verifiedReaderArtworkReads = browserDiagnostics.verifiedReaderArtworkReads;
  trackReaderArtworkResponses(page, browserDiagnostics, readerArtworkResponses);
  let productPath: string | undefined;
  let createdProductId: string | undefined;
  let createdProductSlug: string | undefined;
  let verifiedProductPath = "";
  let persistedProductId = "";
  let uploadedAsset: UploadedAssetFixture | undefined;
  let testFailed = false;

  try {
    await withExpectedNavigation(browserDiagnostics, "admin login redirect", () => signInAsAdmin(page));
    await withExpectedNavigation(browserDiagnostics, "open new product editor", () => page.goto("/admin/products/new"));
    await expect(page.getByRole("heading", { name: "Nowy produkt" })).toBeVisible();
    await waitForProductEditorReady(page);
    const draftProductId = await page.locator('#product-editor-form input[name="id"]').inputValue();
    createdProductId = draftProductId;
    const suffix = ["issue-25", testInfo.project.name, draftProductId].join("-");
    const titleText = "UX Product " + suffix;
    const slug = "ux-product-" + suffix.toLowerCase();
    createdProductSlug = slug;

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
      if (
        request.method() === "POST" &&
        request.headers()["next-action"] &&
        new URL(request.url()).pathname === "/admin/products/new" &&
        simulatedFailures.length === 0
      ) {
        const requestUrl = sanitizeRequestUrl(request.url());
        simulatedFailures.push(`${request.method()} ${requestUrl}`);
        browserDiagnostics.expectedHttpFailures.push({
          method: request.method(),
          url: requestUrl,
          status: 503,
          serverAction: true,
          reason: "The test deliberately injects one failed Server Action response to verify the editor retains submitted values.",
        });
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

    await withExpectedNavigation(browserDiagnostics, "initial post-create editor hydration", async () => {
      await page.getByRole("button", { name: /Zapisz/ }).click();
      await expect(page.getByText(/^(Zapisano\. Zmiany są aktualne\.|Zapisano zmiany\.)$/)).toBeVisible();
      await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]+$/i);
      productPath = new URL(page.url()).pathname;
      createdProductId = productPath.split("/").at(-1)!;
      await waitForReaderArtworkList(page, createdProductId, readerArtworkResponses, verifiedReaderArtworkReads, browserDiagnostics.pendingNavigationPhases.at(-1));
      verifiedProductPath = productPath;
      persistedProductId = createdProductId;
      expect(persistedProductId).toMatch(/^[0-9a-f-]{36}$/i);
      createdProductId = persistedProductId;
      await expect(page.getByTestId("product-save-bar").getByRole("status"))
        .toHaveText("Wszystkie zmiany są zapisane");
      await waitForAdminTransition(page);
      await expect(page.locator('#product-editor-form input[name="id"]')).toHaveValue(persistedProductId);
      await expect(page.getByLabel("Status")).toHaveValue("draft");
      await expect(page.getByLabel("Adres produktu")).toHaveValue(slug);
      await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("37");
      await expect(page.getByLabel("Przypomnienie o opinii po (dniach)")).toHaveValue("9");

      if (testInfo.project.use.isMobile === true) {
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
      await saveScreenshot(page, testInfo, "product-editor-" + testInfo.project.name + ".png");
    });

    await page.getByLabel("Pozycja w katalogu").fill("38");
    await expect(page.getByRole("status").filter({ hasText: "Zmiany produktu zostały zapisane." })).toHaveCount(0);
    await expect(page.getByTestId("product-save-bar")).toContainText("Niezapisane zmiany");
    const productsBackLink = page.locator('a[href="/admin/products"]').last();
    await withExpectedNavigation(browserDiagnostics, "dismiss unsaved internal navigation", async () => {
      page.once("dialog", (dialog) => void dialog.dismiss());
      await productsBackLink.click();
      await expect(page).toHaveURL(editorUrlRegex(verifiedProductPath));
      await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("38");
    });

    await withExpectedNavigation(browserDiagnostics, "dismiss beforeunload during reload", async () => {
      const beforeUnload = page.waitForEvent("dialog", { timeout: 5_000 });
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
      await waitForReaderArtworkList(page, persistedProductId, readerArtworkResponses, verifiedReaderArtworkReads, browserDiagnostics.pendingNavigationPhases.at(-1));
      await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("38");
      await expect(page.getByLabel("Przypomnienie o opinii po (dniach)")).toHaveValue("9");
      await page.reload();
      await waitForProductEditorReady(page);
      await waitForReaderArtworkList(page, persistedProductId, readerArtworkResponses, verifiedReaderArtworkReads, browserDiagnostics.pendingNavigationPhases.at(-1));
      await expect(page.getByLabel("Adres produktu")).toHaveValue(slug);
      await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("38");
      await expect(page.getByLabel("Przypomnienie o opinii po (dniach)")).toHaveValue("9");
    });

    await withExpectedNavigation(browserDiagnostics, "open products and go Back to editor", async () => {
      await page.locator('a[href="/admin/products"]').last().click();
      await expect(page).toHaveURL(/\/admin\/products$/);
      await page.goBack();
      await expect(page).toHaveURL(editorUrlRegex(verifiedProductPath));
      await waitForReaderArtworkList(page, persistedProductId, readerArtworkResponses, verifiedReaderArtworkReads, browserDiagnostics.pendingNavigationPhases.at(-1));
    });
    await page.getByLabel("Pozycja w katalogu").fill("39");
    await expect(page.getByTestId("product-save-bar")).toContainText("Niezapisane zmiany");

    await withExpectedNavigation(browserDiagnostics, "dismiss unsaved Forward navigation", async () => {
      const cancelForwardPromise = page.waitForEvent("dialog", { timeout: 5_000 });
      void page.goForward().catch(() => null);
      const cancelForwardDialog = await cancelForwardPromise;
      expect(cancelForwardDialog.type()).toBe("confirm");
      await cancelForwardDialog.dismiss();
      await expect(page).toHaveURL(editorUrlRegex(verifiedProductPath));
      await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("39");
    });

    await withExpectedNavigation(browserDiagnostics, "accept Forward navigation and reopen editor", async () => {
      const acceptForwardPromise = page.waitForEvent("dialog", { timeout: 5_000 });
      void page.goForward().catch(() => null);
      const acceptForwardDialog = await acceptForwardPromise;
      expect(acceptForwardDialog.type()).toBe("confirm");
      await acceptForwardDialog.accept();
      await expect(page).toHaveURL(/\/admin\/products$/);
      await page.getByRole("link", { name: titleText, exact: false }).click();
      await expect(page).toHaveURL(editorUrlRegex(verifiedProductPath));
      await waitForReaderArtworkList(page, persistedProductId, readerArtworkResponses, verifiedReaderArtworkReads, browserDiagnostics.pendingNavigationPhases.at(-1));
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
      await waitForReaderArtworkList(page, persistedProductId, readerArtworkResponses, verifiedReaderArtworkReads, browserDiagnostics.pendingNavigationPhases.at(-1));
      await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("38");
      await page.goForward();
      await expect(page).toHaveURL(/\/admin\/products$/);
      await page.goBack();
      await expect(page).toHaveURL(editorUrlRegex(verifiedProductPath));
      await waitForReaderArtworkList(page, persistedProductId, readerArtworkResponses, verifiedReaderArtworkReads, browserDiagnostics.pendingNavigationPhases.at(-1));
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

      await uploadCoverFixture(page, testInfo, browserDiagnostics);
      await expect(page.getByText("Przesłano", { exact: true })).toBeVisible();
      const uploadedPath = await page.locator('#product-editor-form input[name="assetPath"]').last().inputValue();
      const uploadedProvider = await page.locator('#product-editor-form input[name="assetStorageProvider"]').last().inputValue();
      uploadedAsset = {
        productId: persistedProductId,
        kind: "cover",
        storagePath: uploadedPath,
        storageProvider: uploadedProvider,
      };
      expect(uploadedPath).toBe("/uploads/" + persistedProductId + "/cover/ux-cover.png");
      await expect(page.locator('#product-editor-form input[name="assetUploaded"]').last()).toHaveValue("1");
      await page.getByRole("button", { name: "Dodaj rynek" }).click();
      await page.locator('#product-editor-form input[name="amazonUrl"]').last().fill("https://www.amazon.com/dp/B0UXTEST25");
      await page.getByLabel("Status").selectOption("published");
      await page.getByRole("button", { name: /Zapisz/ }).click();
      await expect(page.getByText("Zapisano. Zmiany są aktualne.")).toBeVisible();
      await expect.poll(() => readLocalProduct(persistedProductId)?.status).toBe("published");
      await expect(page.locator("form header").getByText("Opublikowany", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Status")).toHaveValue("published");
      await page.reload();
      await expect(page.getByTestId("product-save-bar")).toBeVisible();
      await waitForReaderArtworkList(page, persistedProductId, readerArtworkResponses, verifiedReaderArtworkReads, browserDiagnostics.pendingNavigationPhases.at(-1));
      await expect(page.getByTestId("product-save-bar").getByRole("button", { name: /Zapisz/ })).toBeEnabled();
      await expect(page.getByLabel("Status")).toHaveValue("published");
      await expect(page.locator("form header").getByText("Opublikowany", { exact: true })).toBeVisible();
      await expect(page.locator('#product-editor-form input[name="assetPath"]').last()).toHaveValue(uploadedPath);
      expect(readLocalProduct(persistedProductId)?.assets).toContainEqual(
        expect.objectContaining({ kind: "cover", path: uploadedPath }),
      );

      const statusSelector = page.locator('#product-editor-form select[name="status"]');
      await statusSelector.selectOption("archived");
      await expect(page.getByTestId("product-save-bar")).toContainText("Niezapisane zmiany");
      await expect(page.locator('#product-editor-form select[name="status"]')).toHaveValue("archived");
      expect(await page.locator("#product-editor-form").evaluate((form) => new FormData(form as HTMLFormElement).get("status"))).toBe("archived");
      await page.getByTestId("product-save-bar").getByRole("button", { name: /Zapisz/ }).click();
      await expect(page.getByText("Zapisano. Zmiany są aktualne.")).toBeVisible();
      await expect.poll(() => readLocalProduct(persistedProductId)?.status).toBe("archived");
      await expect(page.locator("form header").getByText("Zarchiwizowany", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Status")).toHaveValue("archived");
      await page.reload();
      await waitForReaderArtworkList(page, persistedProductId, readerArtworkResponses, verifiedReaderArtworkReads, browserDiagnostics.pendingNavigationPhases.at(-1));
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
        await noJsPage.goto(verifiedProductPath, { waitUntil: "domcontentloaded" });
        const form = noJsPage.locator("#product-editor-form");
        await expect(form).toBeVisible();
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
        await legacyPage.bringToFront();
        collectBrowserDiagnostics(legacyPage, browserDiagnostics);
        const legacyReaderArtworkResponses = new Map<string, Array<{ phase?: string; response: Promise<{ status: number; body: unknown }> }>>();
        trackReaderArtworkResponses(legacyPage, browserDiagnostics, legacyReaderArtworkResponses);
        await withExpectedNavigation(browserDiagnostics, "legacy initial editor hydration", async () => {
          await legacyPage.goto(verifiedProductPath);
          await waitForProductEditorReady(legacyPage);
          await waitForReaderArtworkList(legacyPage, persistedProductId, legacyReaderArtworkResponses, verifiedReaderArtworkReads, browserDiagnostics.pendingNavigationPhases.at(-1));
        });
        await withExpectedNavigation(browserDiagnostics, "legacy browser Back/Forward and internal navigation", async () => {
          await legacyPage.locator('a[href="/admin/products"]').last().click();
          await expect(legacyPage).toHaveURL(/\/admin\/products$/);
          await legacyPage.goBack();
          await expect(legacyPage).toHaveURL(editorUrlRegex(verifiedProductPath));
          await waitForProductEditorReady(legacyPage);
          await waitForReaderArtworkList(legacyPage, persistedProductId, legacyReaderArtworkResponses, verifiedReaderArtworkReads, browserDiagnostics.pendingNavigationPhases.at(-1));
          await expect(legacyPage.getByLabel("Pozycja w katalogu")).toHaveValue("40");
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
          await waitForProductEditorReady(legacyPage);
          await waitForReaderArtworkList(legacyPage, persistedProductId, legacyReaderArtworkResponses, verifiedReaderArtworkReads, browserDiagnostics.pendingNavigationPhases.at(-1));
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
          await waitForProductEditorReady(legacyPage);
          await waitForReaderArtworkList(legacyPage, persistedProductId, legacyReaderArtworkResponses, verifiedReaderArtworkReads, browserDiagnostics.pendingNavigationPhases.at(-1));
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
  } catch (error) {
    testFailed = true;
    throw error;
  } finally {
    const cleanupFailures: unknown[] = [];
    try {
      const savedProductId = createdProductSlug
        ? readLocalProductBySlug(createdProductSlug)?.id
        : undefined;
      const cleanupProductId = savedProductId ?? (createdProductId && readLocalProduct(createdProductId)
        ? createdProductId
        : undefined);
      if (cleanupProductId) {
        createdProductId = cleanupProductId;
        const cleanupPath = productPath ?? "/admin/products/" + cleanupProductId;
        try {
          await withExpectedNavigation(browserDiagnostics, "delete test product and verify cleanup", async () => {
            await deleteProductFixture(page, cleanupProductId, cleanupPath);
          });
        } catch (error) {
          cleanupFailures.push(error);
        }
      }
    } catch (error) {
      cleanupFailures.push(error);
    }

    try {
      if (uploadedAsset) {
        const cleanupResponse = await page.request.delete(
          new URL("/api/admin/assets", new URL(page.url()).origin).href,
          { data: uploadedAsset },
        );
        const cleanupBody = await cleanupResponse.text();
        expect(cleanupResponse.ok(), `Asset cleanup failed: ${cleanupResponse.status()} ${cleanupBody}`).toBe(true);
        expect(JSON.parse(cleanupBody)).toEqual({ ok: true, cleanupDeferred: false });
      }
    } catch (error) {
      cleanupFailures.push(error);
    }

    const cleanupProductId = uploadedAsset?.productId ?? (createdProductSlug
      ? readLocalProductBySlug(createdProductSlug)?.id ?? createdProductId
      : createdProductId);
    if (cleanupProductId) {
      let uploadDirectory: string | undefined;
      try {
        uploadDirectory = productUploadDirectory(cleanupProductId);
      } catch (error) {
        cleanupFailures.push(error);
      }
      if (uploadDirectory) {
        try {
          if (fs.existsSync(uploadDirectory)) {
            expect(listFilesRecursively(uploadDirectory)).toEqual([]);
          }
        } catch (error) {
          cleanupFailures.push(error);
        }
        try {
          fs.rmSync(uploadDirectory, { recursive: true, force: true });
        } catch (error) {
          cleanupFailures.push(error);
        }
      }
    }

    await testInfo.attach("browser-diagnostics.json", {
      body: Buffer.from(JSON.stringify(browserDiagnostics, null, 2)),
      contentType: "application/json",
    });
    resolveReaderArtworkReadProofs(browserDiagnostics);
    console.log(`BROWSER_DIAGNOSTICS ${testInfo.project.name} ${JSON.stringify({
      ...browserDiagnostics,
      verifiedReaderArtworkReads: [...browserDiagnostics.verifiedReaderArtworkReads],
    })}`);
    if (testFailed) {
      if (cleanupFailures.length > 0) {
        console.error(`SECONDARY_CLEANUP_FAILURES ${JSON.stringify(cleanupFailures.map(formatError))}`);
      }
      try {
        assertBrowserDiagnosticsClean(browserDiagnostics);
      } catch (error) {
        console.error(`SECONDARY_BROWSER_DIAGNOSTICS_FAILURE ${formatError(error)}`);
      }
    } else {
      if (cleanupFailures.length > 0) throw cleanupFailures[0];
      assertBrowserDiagnosticsClean(browserDiagnostics);
    }
  }
});

test("product editor keeps submitted values after a no-JavaScript save error", async ({ page, browser }, testInfo) => {
  test.setTimeout(60_000);

  await signInAsAdmin(page);
  await page.goto("/admin/products/new", { waitUntil: "load", timeout: 15_000 });
  const interactiveForm = page.locator("#product-editor-form");
  await expect(interactiveForm).toBeVisible({ timeout: 15_000 });
  const saveButton = page.getByTestId("product-save-bar").getByRole("button", { name: "Zapisz", exact: true });
  await expect(saveButton).toBeVisible();
  const saveButtonBox = await saveButton.boundingBox();
  const viewport = page.viewportSize();
  expect(saveButtonBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(saveButtonBox!.y + saveButtonBox!.height).toBeLessThanOrEqual(viewport!.height + 1);

  const browserDiagnostics = createBrowserDiagnostics();
  let context: import("@playwright/test").BrowserContext | undefined;
  let submittedProductId: string | undefined;
  let submittedSlug: string | undefined;
  let testFailed = false;
  const cleanupFailures: unknown[] = [];

  try {
    context = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      javaScriptEnabled: false,
      storageState: await page.context().storageState(),
      viewport: page.viewportSize(),
      isMobile: testInfo.project.use.isMobile === true,
      hasTouch: testInfo.project.use.hasTouch === true,
      deviceScaleFactor: typeof testInfo.project.use.deviceScaleFactor === "number"
        ? testInfo.project.use.deviceScaleFactor
        : 1,
    });
    const sessionCookies = await context.cookies();
    expect(sessionCookies.map(({ name }) => name)).toContain("ll_demo_session");
    const noJsPage = await context.newPage();
    collectBrowserDiagnostics(noJsPage, browserDiagnostics);
    await noJsPage.goto("/admin/products/new", { waitUntil: "load", timeout: 15_000 });
    await expect(noJsPage).toHaveURL(/\/admin\/products\/new$/);
    const form = noJsPage.locator("#product-editor-form");
    await expect(form).toBeVisible();
    await expect(form).toHaveAttribute("method", "POST");
    submittedProductId = await form.locator('input[name="id"]').inputValue();
    const title = "No JS retained " + Date.now();
    const description = "Submitted values survive a server validation error without JavaScript.";
    const slug = "no-js-retained-" + Date.now();
    submittedSlug = slug;
    await noJsPage.getByLabel("Tytuł").fill(title);
    await noJsPage.getByLabel("Krótki opis").fill(description);
    await noJsPage.getByLabel("Adres produktu").fill(slug);
    await noJsPage.getByLabel("Pozycja w katalogu").fill("73");
    await noJsPage.getByLabel("Status").selectOption("published");

    const saveButton = noJsPage.getByRole("button", { name: "Zapisz produkt", exact: true });
    await expect(saveButton).toBeVisible();
    const saveButtonBox = await saveButton.boundingBox();
    const viewport = noJsPage.viewportSize();
    expect(saveButtonBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(saveButtonBox!.y + saveButtonBox!.height).toBeLessThanOrEqual(viewport!.height + 1);

    const responsePromise = noJsPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await saveButton.click();
    const response = await responsePromise;
    expect(response?.ok()).toBe(true);
    expect(response?.request().method()).toBe("POST");
    const responseHtml = await response!.text();
    expect(responseHtml).toContain("Nie udało się zapisać. Twoje wpisane wartości są zachowane.");
    expect(responseHtml).toContain(description);
    expect(responseHtml).toContain(slug);
    await expect(noJsPage.getByLabel("Tytuł")).toHaveValue(title);
    await expect(noJsPage.getByLabel("Krótki opis")).toHaveValue(description);
    await expect(noJsPage.getByLabel("Tytuł")).not.toHaveAttribute("aria-invalid", "true");
    await expect(noJsPage.getByLabel("Krótki opis")).not.toHaveAttribute("aria-invalid", "true");
    await expect(noJsPage.getByLabel("Adres produktu")).toHaveValue(slug);
    await expect(noJsPage.getByLabel("Pozycja w katalogu")).toHaveValue("73");
    await expect(noJsPage.getByLabel("Status")).toHaveValue("published");
    expect(readLocalProduct(submittedProductId)).toBeUndefined();
  } catch (error) {
    testFailed = true;
    throw error;
  } finally {
    try {
      await context?.close();
    } catch (error) {
      cleanupFailures.push(error);
    }
    const accidentallySavedProduct = (submittedProductId ? readLocalProduct(submittedProductId) : undefined) ??
      (submittedSlug ? readLocalProductBySlug(submittedSlug) : undefined);
    if (accidentallySavedProduct?.id) {
      try {
        await deleteProductFixture(page, accidentallySavedProduct.id);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    try {
      await testInfo.attach("browser-diagnostics.json", {
        body: Buffer.from(JSON.stringify(browserDiagnostics, null, 2)),
        contentType: "application/json",
      });
    } catch (error) {
      cleanupFailures.push(error);
    }
    console.log(`BROWSER_DIAGNOSTICS no-js ${JSON.stringify(browserDiagnostics)}`);
    if (testFailed) {
      if (cleanupFailures.length > 0) {
        console.error(`SECONDARY_CLEANUP_FAILURES ${JSON.stringify(cleanupFailures.map(formatError))}`);
      }
      try {
        assertBrowserDiagnosticsClean(browserDiagnostics);
      } catch (error) {
        console.error(`SECONDARY_BROWSER_DIAGNOSTICS_FAILURE ${formatError(error)}`);
      }
    } else {
      if (cleanupFailures.length > 0) throw cleanupFailures[0];
      assertBrowserDiagnosticsClean(browserDiagnostics);
    }
  }
});

async function signInAsAdmin(page: Page) {
  await page.goto("/en/login?redirectTo=/admin");
  await page.getByLabel("Email").fill("admin@lamilialomi.test");
  await page.getByLabel("Password").fill("demo-password");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.getByRole("button", { name: "Continue" }).click(),
  ]);
}

function createBrowserDiagnostics() {
  return {
    consoleErrors: [] as Array<{
      message: string;
      disposition: string;
      reason?: string;
      networkStatus?: number;
      networkError?: string;
      networkUrl?: string;
    }>,
    pageErrors: [] as string[],
    failedRequests: [] as Array<{
      method: string;
      url: string;
      error: string | null;
      disposition: string;
      reason?: string;
      navigationPhase?: string;
      sourcePage?: string;
      resourceType?: string;
      navigationRequest?: boolean;
      serverAction?: boolean;
    }>,
    failedResponses: [] as Array<{ method: string; url: string; status: number; disposition: string; reason?: string }>,
    expectedHttpFailures: [] as Array<{
      method: string;
      url: string;
      status: number;
      serverAction?: boolean;
      contentTypePrefix?: string;
      reason: string;
    }>,
    pendingNavigationPhases: [] as string[],
    verifiedReaderArtworkReads: new Set<string>(),
  };
}

function collectBrowserDiagnostics(page: Page, diagnostics: ReturnType<typeof createBrowserDiagnostics>) {
  const requestContexts = new WeakMap<import("@playwright/test").Request, { navigationPhase?: string; sourcePage: string }>();
  page.on("request", (request) => {
    const pendingPhase = diagnostics.pendingNavigationPhases.at(-1);
    const currentPageUrl = page.url();
    requestContexts.set(request, {
      ...(pendingPhase ? { navigationPhase: pendingPhase } : {}),
      sourcePage: currentPageUrl.startsWith("http") ? sanitizeRequestUrl(currentPageUrl) : currentPageUrl,
    });
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    const messageUrl = message.location().url;
    const networkUrl = messageUrl?.startsWith("http") ? sanitizeRequestUrl(messageUrl) : undefined;
    const httpStatus = text.match(/^Failed to load resource: the server responded with a status of (\d+)/);
    const networkError = text.match(/^Failed to load resource:\s*(net::[^\s]+)/);
    if (httpStatus) {
      diagnostics.consoleErrors.push({
        message: text,
        disposition: "network",
        networkStatus: Number(httpStatus[1]),
        ...(networkUrl ? { networkUrl } : {}),
      });
    } else if (networkError) {
      diagnostics.consoleErrors.push({
        message: text,
        disposition: "network",
        networkError: networkError[1],
        ...(networkUrl ? { networkUrl } : {}),
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
    const requestContext = requestContexts.get(request);
    const requestPhase = requestContext?.navigationPhase;
    const requestDetails = {
      method: request.method(),
      url: sanitizedUrl,
      error,
      ...(requestPhase ? { navigationPhase: requestPhase } : {}),
      ...(requestContext ? { sourcePage: requestContext.sourcePage } : {}),
      resourceType: request.resourceType(),
      navigationRequest: request.isNavigationRequest(),
      serverAction: Boolean(request.headers()["next-action"]),
    };
    const isCancelled = error === "net::ERR_ABORTED" || error === "Load request cancelled";
    if (isCancelled && request.resourceType() === "font" && requestPhase) {
      diagnostics.failedRequests.push({
        ...requestDetails,
        disposition: "expected",
        reason: `The browser canceled a font fetch during the explicitly asserted ${requestPhase} phase; its destination and page content are verified by that phase.`,
      });
    } else if (
      isCancelled &&
      request.resourceType() === "image" &&
      url.pathname === "/_next/image" &&
      requestPhase === "save edited product, leave, reopen, and reload" &&
      requestContext?.sourcePage.endsWith("/admin/products")
    ) {
      diagnostics.failedRequests.push({
        ...requestDetails,
        disposition: "expected",
        reason: "The browser canceled a pending optimized product-list image when the test immediately reopened the editor; both route destinations and the saved product state are asserted.",
      });
    } else if (
      isCancelled && request.method() === "GET" && request.resourceType() === "fetch" &&
      /^\/api\/admin\/products\/([0-9a-f-]{36})\/reader-artworks$/i.test(url.pathname) &&
      requestPhase && [
        "initial post-create editor hydration",
        "legacy initial editor hydration",
        "legacy browser Back/Forward and internal navigation",
        "save edited product, leave, reopen, and reload",
        "open products and go Back to editor",
        "accept Forward navigation and reopen editor",
        "navigate away, unmount, and traverse history",
        "save and reload edited product states",
      ].includes(requestPhase) &&
      requestContext?.sourcePage === `${url.origin}${url.pathname.replace(/^\/api/, "").replace(/\/reader-artworks$/, "")}`
    ) {
      diagnostics.failedRequests.push({
        ...requestDetails,
        disposition: "pending-reader-artwork-proof",
        reason: `Reader-artwork read canceled during ${requestPhase}; awaiting the phase's successful read and hydrated-control proof.`,
      });
    } else if (
      isCancelled && request.method() === "GET" && request.resourceType() === "fetch" &&
      requestPhase === "delete test product and verify cleanup" &&
      /^\/api\/admin\/products\/[0-9a-f-]{36}\/reader-artworks$/.test(url.pathname) &&
      requestContext?.sourcePage === `${url.origin}${url.pathname.replace(/^\/api/, "").replace(/\/reader-artworks$/, "")}`
    ) {
      diagnostics.failedRequests.push({
        ...requestDetails,
        disposition: "expected",
        reason: "The browser canceled this editor's reader-artwork list while leaving the product being deleted; the phase verifies the redirect and actual product removal.",
      });
    } else if (isCancelled && requestPhase && isVerifiedEditorNavigationRequest(request, url)) {
      diagnostics.failedRequests.push({
        ...requestDetails,
        disposition: "expected",
        reason: `The browser canceled a ${describeEditorNavigationRequest(request, url)} during the explicitly asserted ${requestPhase} phase.`,
      });
    } else if (error === "csp" && url.pathname.includes("browser_dev_hmr-client")) {
      diagnostics.failedRequests.push({
        ...requestDetails,
        disposition: "unrelated",
        reason: "The local Next.js development HMR client is blocked by the app CSP; this development-only bundle is not used in Production.",
      });
    } else {
      diagnostics.failedRequests.push({
        ...requestDetails,
        disposition: "unresolved",
      });
    }
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const request = response.request();
    const url = sanitizeRequestUrl(request.url());
    const contentType = request.headers()["content-type"] ?? "";
    const expectedFailureIndex = diagnostics.expectedHttpFailures.findIndex((expected) =>
      expected.method === request.method() &&
      expected.url === url &&
      expected.status === response.status() &&
      (expected.serverAction === undefined || expected.serverAction === Boolean(request.headers()["next-action"])) &&
      (expected.contentTypePrefix === undefined || contentType.startsWith(expected.contentTypePrefix))
    );
    if (expectedFailureIndex !== -1) {
      const [expectedFailure] = diagnostics.expectedHttpFailures.splice(expectedFailureIndex, 1);
      diagnostics.failedResponses.push({
        method: request.method(),
        url,
        status: response.status(),
        disposition: "expected",
        reason: expectedFailure.reason,
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

function trackReaderArtworkResponses(
  page: Page,
  diagnostics: ReturnType<typeof createBrowserDiagnostics>,
  responses: Map<string, Array<{ phase?: string; response: Promise<{ status: number; body: unknown }> }>>,
) {
  page.on("response", (response) => {
    const request = response.request();
    const match = new URL(response.url()).pathname.match(/^\/api\/admin\/products\/([0-9a-f-]{36})\/reader-artworks$/i);
    if (request.method() !== "GET" || !match) return;
    const records = responses.get(match[1]) ?? [];
    records.push({ phase: diagnostics.pendingNavigationPhases.at(-1), response: response.json().then(
      (body: unknown) => ({ status: response.status(), body }),
      () => ({ status: response.status(), body: null }),
    ) });
    responses.set(match[1], records);
  });
}

function isVerifiedEditorNavigationRequest(request: import("@playwright/test").Request, url: URL) {
  const isEditorFlowRoute = url.pathname === "/en/login" && url.searchParams.get("redirectTo") === "/admin" ||
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
  resolveReaderArtworkReadProofs(diagnostics);
  const unmatchedNetworkConsoleErrors: string[] = [];
  const consumedResponseIndexes = new Set<number>();
  const consumedRequestIndexes = new Set<number>();
  diagnostics.consoleErrors.forEach((consoleError) => {
    if (consoleError.networkStatus !== undefined) {
      const matchingResponseIndex = diagnostics.failedResponses.findIndex((response, index) =>
        !consumedResponseIndexes.has(index) &&
        response.status === consoleError.networkStatus &&
        consoleError.networkUrl !== undefined && response.url === consoleError.networkUrl
      );
      if (matchingResponseIndex === -1) {
        unmatchedNetworkConsoleErrors.push(consoleError.message);
      } else {
        consumedResponseIndexes.add(matchingResponseIndex);
      }
    }
    if (consoleError.networkError) {
      const matchingRequestIndex = diagnostics.failedRequests.findIndex((request, index) =>
        !consumedRequestIndexes.has(index) &&
        request.error === consoleError.networkError &&
        consoleError.networkUrl !== undefined && request.url === consoleError.networkUrl
      );
      if (matchingRequestIndex === -1) {
        unmatchedNetworkConsoleErrors.push(consoleError.message);
      } else {
        consumedRequestIndexes.add(matchingRequestIndex);
      }
    }
  });
  const unresolved = {
    consoleErrors: diagnostics.consoleErrors.filter(({ disposition }) => disposition === "unresolved"),
    pageErrors: diagnostics.pageErrors,
    failedRequests: diagnostics.failedRequests.filter(({ disposition }) => disposition === "unresolved"),
    failedResponses: diagnostics.failedResponses.filter(({ disposition }) => disposition === "unresolved"),
    unmatchedNetworkConsoleErrors,
    expectedHttpFailuresNotObserved: diagnostics.expectedHttpFailures,
  };
  expect(unresolved, JSON.stringify(unresolved, null, 2)).toEqual({
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    failedResponses: [],
    unmatchedNetworkConsoleErrors: [],
    expectedHttpFailuresNotObserved: [],
  });
}

function resolveReaderArtworkReadProofs(diagnostics: ReturnType<typeof createBrowserDiagnostics>) {
  for (const request of diagnostics.failedRequests) {
    if (request.disposition !== "pending-reader-artwork-proof") continue;
    const id = request.url.match(/\/api\/admin\/products\/([0-9a-f-]{36})\/reader-artworks$/i)?.[1];
    const hasReadinessProof = Boolean(id && request.navigationPhase && diagnostics.verifiedReaderArtworkReads.has(`${request.navigationPhase}:${id}`));
    request.disposition = hasReadinessProof ? "expected" : "unresolved";
    request.reason = hasReadinessProof
      ? `The reader-artwork GET was canceled during ${request.navigationPhase}; before continuing, that phase verified a successful HTTP 200 JSON artwork list and the enabled, hydrated editor control.`
      : `The reader-artwork GET was canceled during ${request.navigationPhase} without a successful same-phase list response and hydrated-control proof.`;
  }
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${message} within ${timeoutMs}ms.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
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

function readLocalProduct(productId: string) {
  const contentPath = path.resolve(process.cwd(), "data", "lamilialomi-content.local.json");
  if (!fs.existsSync(contentPath)) return undefined;
  const snapshot = JSON.parse(fs.readFileSync(contentPath, "utf8")) as {
    products?: Array<{ id?: string; status?: string; assets?: Array<{ kind?: string; path?: string }> }>;
  };
  return snapshot.products?.find((product) => product.id === productId);
}

function readLocalProductBySlug(slug: string) {
  const contentPath = path.resolve(process.cwd(), "data", "lamilialomi-content.local.json");
  if (!fs.existsSync(contentPath)) return undefined;
  const snapshot = JSON.parse(fs.readFileSync(contentPath, "utf8")) as {
    products?: Array<{ id?: string; slug?: string }>;
  };
  return snapshot.products?.find((product) => product.slug === slug);
}

async function uploadCoverFixture(
  page: Page,
  testInfo: TestInfo,
  diagnostics: ReturnType<typeof createBrowserDiagnostics>,
) {
  let multipartRequestBodySize: number | undefined;
  let routeContinuationFailure: unknown;
  let multipartRouteStarted = false;
  let signalMultipartRequestStarted!: () => void;
  let releaseMultipartResponse!: () => void;
  let finishMultipartRoute!: () => void;
  const multipartRequestStarted = new Promise<void>((resolve) => {
    signalMultipartRequestStarted = resolve;
  });
  const multipartResponseGate = new Promise<void>((resolve) => {
    releaseMultipartResponse = resolve;
  });
  const multipartRouteCompleted = new Promise<void>((resolve) => {
    finishMultipartRoute = resolve;
  });
  const multipartResponseResult = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST" && request.headers()["content-type"]?.includes("multipart/form-data") === true;
  }, { timeout: 20_000 }).then(
    (response) => ({ response } as const),
    (error: unknown) => ({ error } as const),
  );
  const handler = async (route: import("@playwright/test").Route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["content-type"]?.includes("multipart/form-data")) {
      multipartRouteStarted = true;
      multipartRequestBodySize = request.postDataBuffer()?.length ?? 0;
      signalMultipartRequestStarted();
      try {
        await multipartResponseGate;
        await route.continue();
      } catch (error) {
        routeContinuationFailure = error;
      } finally {
        finishMultipartRoute();
      }
      return;
    }
    await route.continue();
  };
  await page.route("**/api/admin/assets", handler);
  diagnostics.expectedHttpFailures.push({
    method: "POST",
    url: sanitizeRequestUrl(new URL("/api/admin/assets", page.url()).toString()),
    status: 415,
    serverAction: false,
    contentTypePrefix: "application/json",
    reason: "The local upload endpoint rejects JSON metadata with 415 to select the multipart fallback; the multipart upload is then verified successful and visible in the editor.",
  });

  const fixturePath = testInfo.outputPath("ux-cover.png");
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, makePng());
  const fileSelection = page.locator("#media-upload-cover").setInputFiles(fixturePath);

  try {
    await fileSelection;
    await withTimeout(multipartRequestStarted, 15_000, "Asset upload request did not start");
    expect(multipartRequestBodySize).toBeGreaterThan(0);
    await page.getByText("ux-cover.png", { exact: true }).waitFor({ state: "visible" });
    await expect(page.getByText("Przesyłanie…", { exact: true })).toBeVisible();
  } finally {
    releaseMultipartResponse();
    try {
      if (multipartRouteStarted) {
        await withTimeout(multipartRouteCompleted, 15_000, "Asset upload route did not finish");
      }
    } finally {
      await page.unroute("**/api/admin/assets", handler);
    }
  }

  const responseResult = await multipartResponseResult;
  if ("error" in responseResult) throw responseResult.error;
  const response = responseResult.response;
  const responseBody = response.ok() ? "" : await response.text();
  expect(routeContinuationFailure, formatError(routeContinuationFailure)).toBeUndefined();
  expect(response.status(), `Multipart upload failed: ${response.status()} ${responseBody}`).toBe(200);
}

function productUploadDirectory(productId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) {
    throw new Error("The test product ID is not a UUID; refusing to clean an upload directory.");
  }
  const root = path.resolve(process.cwd(), "public", "uploads");
  const directory = path.resolve(root, productId);
  if (!directory.startsWith(root + path.sep)) {
    throw new Error("The test upload directory is outside public/uploads.");
  }
  return directory;
}

async function saveScreenshot(page: Page, testInfo: TestInfo, filename: string) {
  const screenshotPath = testInfo.outputPath(filename);
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const productId = page.getByText(/^ID: /);
  const productIdBounds = await productId.boundingBox();
  const viewport = page.viewportSize();
  const visibleProductId = productIdBounds && viewport && productIdBounds.y < viewport.height &&
    productIdBounds.y + productIdBounds.height > 0;
  await page.screenshot({
    path: screenshotPath,
    animations: "disabled",
    mask: visibleProductId ? [productId] : [],
    maskColor: "#e6ddd1",
  });
  await testInfo.attach(filename, { path: screenshotPath, contentType: "image/png" });
}

async function waitForAdminTransition(page: Page) {
  const transition = page.locator(".admin-page-transition").first();
  await transition.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  });
}

async function deleteProductFixture(page: Page, productId: string, pathName = "/admin/products/" + productId) {
  const acceptDialogs = (dialog: import("@playwright/test").Dialog) => void dialog.accept();
  page.on("dialog", acceptDialogs);
  try {
    await page.goto(pathName, { waitUntil: "networkidle", timeout: 15_000 });
    await waitForProductEditorReady(page);
    await Promise.all([
      page.getByRole("button", { name: "Usuń produkt" }).click(),
    ]);
    await expect(page.getByRole("status").filter({ hasText: "Produkt został usunięty." })).toBeVisible();
    await expect(page).toHaveURL("/admin/products");
    expect(readLocalProduct(productId)).toBeUndefined();
  } finally {
    page.off("dialog", acceptDialogs);
  }
}

async function waitForProductEditorReady(page: Page) {
  await expect(page.locator("#product-editor-form")).toBeVisible();
  await expect(page.locator('#product-editor-form input[type="hidden"][name="longDescription"]')).toBeEnabled({ timeout: 20_000 });
  const saveBar = page.getByTestId("product-save-bar");
  await expect(saveBar).toBeVisible();
  await expect(saveBar.getByRole("button", { name: /Zapisz/ })).toBeEnabled();
}

async function waitForReaderArtworkList(
  page: Page,
  productId: string,
  responses: Map<string, Array<{ phase?: string; response: Promise<{ status: number; body: unknown }> }>>,
  verifiedReads: Set<string>,
  phase?: string,
) {
  const uploadButton = page.getByRole("button", { name: "Wybierz pliki prac czytelniczek" });
  await expect(uploadButton).toBeEnabled({ timeout: 20_000 });
  const records = responses.get(productId) ?? [];
  const matching = records.filter((record) => record.phase === phase);
  const responseRecord = matching.at(-1) ?? (phase ? undefined : records.at(-1));
  expect(responseRecord, `Expected a reader-artwork list response during ${phase ?? "the current editor load"} for ${productId}.`).toBeDefined();
  const result = await responseRecord!.response;
  expect(result.status).toBe(200);
  expect(result.body).toEqual(expect.objectContaining({ artworks: expect.any(Array) }));
  if (phase) verifiedReads.add(`${phase}:${productId}`);
}

function listFilesRecursively(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFilesRecursively(entryPath) : [entryPath];
  });
}

function makePng() {
  const width = 640;
  const height = 640;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (1 + width * 4);
    scanlines[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      const accent = x > 160 && x < 480 && y > 120 && y < 360;
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
