import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

test.setTimeout(240_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ll_cookie_consent",
      JSON.stringify({ essential: true, analytics: false }),
    );
  });
});

test("product editor preserves work, saves all statuses, and keeps Save reachable", async ({ page, browser }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const titleText = `UX Product ${suffix}`;
  const slug = `ux-product-${suffix.toLowerCase()}`;
  const shortDescription = "Temporary local product used to verify the complete editor flow.";
  const simulatedFailures: string[] = [];
  let productPath: string | undefined;
  let createdProductId: string | undefined;
  let productSaved = false;

  try {
    await signInAsAdmin(page);
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

    await page.getByRole("button", { name: /Zapisz/ }).click();
    await expect(page.getByText("Zapisano. Zmiany są aktualne.")).toBeVisible();
    productSaved = true;
    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]+\?saved=1$/i);
    productPath = new URL(page.url()).pathname;
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
    page.once("dialog", (dialog) => void dialog.dismiss());
    await productsBackLink.click();
    await expect(page).toHaveURL(editorUrlRegex(productPath));
    await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("38");

    const beforeUnload = page.waitForEvent("dialog");
    const reload = page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    const dialog = await beforeUnload;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    await Promise.race([reload, page.waitForTimeout(2_000)]);
    await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("38");

    await page.getByRole("button", { name: /Zapisz/ }).click();
    await expect(page.getByText("Zapisano. Zmiany są aktualne.")).toBeVisible();
    await page.locator('a[href="/admin/products"]').last().click();
    await expect(page).toHaveURL(/\/admin\/products$/);
    await page.getByRole("link", { name: titleText, exact: false }).click();
    await expect(page).toHaveURL(editorUrlRegex(productPath));
    await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("38");
    await expect(page.getByLabel("Przypomnienie o opinii po (dniach)")).toHaveValue("9");
    await page.reload();
    await expect(page.getByLabel("Adres produktu")).toHaveValue(slug);
    await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("38");
    await expect(page.getByLabel("Przypomnienie o opinii po (dniach)")).toHaveValue("9");

    await page.locator('a[href="/admin/products"]').last().click();
    await expect(page).toHaveURL(/\/admin\/products$/);
    await page.goBack();
    await expect(page).toHaveURL(editorUrlRegex(productPath));
    await page.getByLabel("Pozycja w katalogu").fill("39");
    await expect(page.getByTestId("product-save-bar")).toContainText("Niezapisane zmiany");

    const cancelForwardPromise = page.waitForEvent("dialog");
    void page.goForward().catch(() => null);
    const cancelForwardDialog = await cancelForwardPromise;
    expect(cancelForwardDialog.type()).toBe("confirm");
    await cancelForwardDialog.dismiss();
    await expect(page).toHaveURL(editorUrlRegex(productPath));
    await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("39");

    const acceptForwardPromise = page.waitForEvent("dialog");
    void page.goForward().catch(() => null);
    const acceptForwardDialog = await acceptForwardPromise;
    expect(acceptForwardDialog.type()).toBe("confirm");
    await acceptForwardDialog.accept();
    await expect(page).toHaveURL(/\/admin\/products$/);
    await page.getByRole("link", { name: titleText, exact: false }).click();
    await expect(page).toHaveURL(editorUrlRegex(productPath));
    await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("38");

    await page.getByLabel("Pozycja w katalogu").fill("40");
    await expect(page.getByTestId("product-save-bar")).toContainText("Niezapisane zmiany");
    const backDialogPromise = page.waitForEvent("dialog", { timeout: 5_000 });
    void page.goBack().catch(() => null);
    const backDialog = await backDialogPromise;
    expect(backDialog.type()).toBe("confirm");
    await backDialog.dismiss();
    await expect(page).toHaveURL(editorUrlRegex(productPath));
    await expect(page.getByLabel("Pozycja w katalogu")).toHaveValue("40");
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

    if (testInfo.project.name === "chromium") {
      const noJsContext = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        javaScriptEnabled: false,
      });
      try {
        await noJsContext.addCookies(await page.context().cookies());
        const noJsPage = await noJsContext.newPage();
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
        await legacyPage.goto(productPath);
        await legacyPage.locator('a[href="/admin/products"]').last().click();
        await expect(legacyPage).toHaveURL(/\/admin\/products$/);
        await legacyPage.goBack();
        await expect(legacyPage).toHaveURL(editorUrlRegex(productPath));
        await legacyPage.getByLabel("Pozycja w katalogu").fill("41");

        const cancelLegacyForwardPromise = legacyPage.waitForEvent("dialog", { timeout: 5_000 });
        void legacyPage.goForward().catch(() => null);
        const cancelLegacyForwardDialog = await cancelLegacyForwardPromise;
        expect(cancelLegacyForwardDialog.type()).toBe("confirm");
        await cancelLegacyForwardDialog.dismiss();
        await expect(legacyPage).toHaveURL(editorUrlRegex(productPath));
        await expect(legacyPage.getByLabel("Pozycja w katalogu")).toHaveValue("41");

        const acceptLegacyForwardPromise = legacyPage.waitForEvent("dialog", { timeout: 5_000 });
        void legacyPage.goForward().catch(() => null);
        const acceptLegacyForwardDialog = await acceptLegacyForwardPromise;
        expect(acceptLegacyForwardDialog.type()).toBe("confirm");
        await acceptLegacyForwardDialog.accept();
        await expect(legacyPage).toHaveURL(/\/admin\/products$/);
        await legacyPage.getByRole("link", { name: titleText, exact: false }).click();
        await expect(legacyPage).toHaveURL(editorUrlRegex(productPath));
        await expect(legacyPage.getByLabel("Pozycja w katalogu")).toHaveValue("40");

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
        await expect(legacyPage).toHaveURL(editorUrlRegex(productPath));
        await expect(legacyPage.getByLabel("Pozycja w katalogu")).toHaveValue("42");
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
      } finally {
        page.off("dialog", acceptDialogs);
      }
    }
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

  try {
    const noJsPage = await context.newPage();
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
    await expect(noJsPage.getByLabel("Adres produktu")).toHaveValue(/no-js-retained-/);
    await expect(noJsPage.getByLabel("Pozycja w katalogu")).toHaveValue("73");
    await expect(noJsPage.getByLabel("Status")).toHaveValue("published");
  } finally {
    await context.close();
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

async function saveScreenshot(page: Page, filename: string) {
  const directory = path.resolve(process.cwd(), "artifacts", "issue-25");
  fs.mkdirSync(directory, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: path.join(directory, filename), animations: "disabled" });
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
