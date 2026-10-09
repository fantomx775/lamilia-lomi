import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

test.setTimeout(300_000);

const imageFixtures = [
  { name: "01-red.png", rgb: [230, 42, 52] },
  { name: "02-green.png", rgb: [30, 160, 90] },
  { name: "03-blue.png", rgb: [35, 90, 210] },
  { name: "04-yellow.png", rgb: [240, 180, 35] },
  { name: "05-purple.png", rgb: [175, 45, 190] },
] as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ll_cookie_consent",
      JSON.stringify({ essential: true, analytics: false }),
    );
  });
});

test("admin reorders gallery previews through upload, save, reload, and edit", async ({ page }, testInfo) => {
  page.setDefaultNavigationTimeout(180_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  const expectedNavigationCancellations: string[] = [];
  const mainFrameNavigations: Array<{ at: number; url: string }> = [];
  const unexpectedHttpFailures: string[] = [];
  const localUploadFallbacks: string[] = [];
  let productUpdateSavePending = false;
  let productDeletePending = false;
  let adminLoginPending = false;
  let adminLoginVerified = false;
  let productId = "";
  let productPath: string | undefined;
  let flowFailure: unknown;
  let cleanupFailure: unknown;
  let createSaveNavigationPending = false;

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations.push({ at: Date.now(), url: frame.url() });
  });
  page.on("requestfailed", (request) => {
    const at = Date.now();
    const failure = request.failure()?.errorText ?? "request failed";
    let frameUrl = "unavailable";
    try {
      frameUrl = request.frame().url();
    } catch {
      // Some browser-owned requests have no page frame.
    }
    const detail = {
      method: request.method(),
      url: request.url(),
      failure,
      resourceType: request.resourceType(),
      isNavigationRequest: request.isNavigationRequest(),
      pageUrl: page.url(),
      frameUrl,
      failedAt: new Date(at).toISOString(),
    };
    const recentNavigation = [...mainFrameNavigations].reverse().find((event) => at - event.at <= 5_000);
    const failedUrl = new URL(request.url());
    const exactLoginPost = request.method() === "POST" && failedUrl.pathname === "/pl/login" &&
      failedUrl.search === "?redirectTo=/admin";
    const expectedAdminLoginCancellation = exactLoginPost && (adminLoginPending || adminLoginVerified);
    const exactNextDevChunk = request.method() === "GET" && request.resourceType() === "script" &&
      failedUrl.pathname.startsWith("/_next/static/chunks/") && failedUrl.pathname.endsWith(".js");
    const createActionPost = request.method() === "POST" && failedUrl.pathname === "/admin/products/new" &&
      Boolean(request.headers()["next-action"]);
    const nextFlightFetch = request.method() === "GET" && request.resourceType() === "fetch" &&
      failedUrl.searchParams.has("_rsc");
    const expectedCreateSaveCancellation = createSaveNavigationPending && (createActionPost || nextFlightFetch);
    const productMutationAction = request.method() === "POST" && failedUrl.pathname === `/admin/products/${productId}` &&
      Boolean(request.headers()["next-action"]);
    const expectedVerifiedUpdateSaveCancellation = productUpdateSavePending && productMutationAction;
    const expectedVerifiedProductDeleteCancellation = productDeletePending && productMutationAction;
    if (failure === "net::ERR_ABORTED" && (
      (recentNavigation && exactNextDevChunk) ||
      expectedAdminLoginCancellation ||
      expectedCreateSaveCancellation ||
      expectedVerifiedUpdateSaveCancellation ||
      expectedVerifiedProductDeleteCancellation
    )) {
      const cancellation = JSON.stringify({
        ...detail,
        adjacentMainFrameNavigation: recentNavigation?.url ?? page.url(),
        reason: expectedAdminLoginCancellation
          ? "the login action was followed by an asserted redirect to /admin"
          : expectedCreateSaveCancellation
          ? "product create save navigated to the created editor"
          : expectedVerifiedUpdateSaveCancellation
            ? "the update save response was followed by an asserted reload of the persisted gallery order"
            : expectedVerifiedProductDeleteCancellation
              ? "the product delete response was followed by an asserted navigation and cleanup check"
              : "expected browser navigation",
      });
      expectedNavigationCancellations.push(cancellation);
      console.log("Expected navigation cancellation: " + cancellation);
    } else {
      requestFailures.push(JSON.stringify(detail));
    }
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const request = response.request();
    const entry = request.method() + " " + response.status() + " " + response.url();
    if (
      response.status() === 415 &&
      request.method() === "POST" &&
      new URL(response.url()).pathname === "/api/admin/assets"
    ) {
      localUploadFallbacks.push(entry);
      return;
    }
    unexpectedHttpFailures.push(entry);
  });

  try {
    await page.goto("/pl/login?redirectTo=/admin");
    await page.getByLabel("E-mail").fill("admin@lamilialomi.test");
    await page.getByLabel("Hasło").fill("demo-password");
    adminLoginPending = true;
    try {
      await Promise.all([
        page.waitForURL((url) => url.pathname === "/admin"),
        page.getByRole("button", { name: "Kontynuuj" }).click(),
      ]);
      adminLoginVerified = true;
    } finally {
      adminLoginPending = false;
    }

    await page.goto("/admin/products/new");
    await expect(page.getByRole("heading", { name: "Nowy produkt" })).toBeVisible();
    await page.getByLabel("Tytuł").fill(
      "E2E Image Order " + Date.now() + " " + testInfo.project.name,
    );
    await page.getByLabel("Krótki opis").fill("Disposable product for real browser image ordering verification.");
    productId = await page.locator('#product-editor-form input[name="id"]').inputValue();
    expect(productId).toMatch(/^[0-9a-f-]{36}$/i);

    await page.locator("#media-upload-gallery").setInputFiles(
      imageFixtures.slice(0, 4).map((fixture, index) => ({
        name: fixture.name,
        mimeType: "image/png",
        buffer: makePng(fixture.rgb, index),
      })),
    );
    await expect(page.getByText("Przesłano", { exact: true })).toHaveCount(4);

    let expectedOrder = imageFixtures.slice(0, 4);
    await expect.poll(() => readGallerySignature(page)).toEqual(signatureFor(expectedOrder));
    await assertArrowTargets(page, expectedOrder.map((fixture) => fixture.name), testInfo);
    await expect(page.getByRole("button", { name: "Przenieś 01-red.png wyżej" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Przenieś 04-yellow.png niżej" })).toBeDisabled();
    await capture(page, testInfo, "01-four-images-uploaded");

    for (const nextOrder of [
      [imageFixtures[0], imageFixtures[1], imageFixtures[3], imageFixtures[2]],
      [imageFixtures[0], imageFixtures[3], imageFixtures[1], imageFixtures[2]],
      [imageFixtures[3], imageFixtures[0], imageFixtures[1], imageFixtures[2]],
    ]) {
      await page.getByRole("button", { name: "Przenieś 04-yellow.png wyżej" }).click();
      expectedOrder = nextOrder;
      await expect.poll(() => readGallerySignature(page)).toEqual(signatureFor(expectedOrder));
    }
    await expect(page.getByRole("button", { name: "Przenieś 04-yellow.png wyżej" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Przenieś 01-red.png wyżej" })).toBeEnabled();
    await capture(page, testInfo, "02-fourth-image-moved-to-first");

    for (const nextOrder of [
      [imageFixtures[0], imageFixtures[3], imageFixtures[1], imageFixtures[2]],
      [imageFixtures[0], imageFixtures[1], imageFixtures[3], imageFixtures[2]],
      [imageFixtures[0], imageFixtures[1], imageFixtures[2], imageFixtures[3]],
    ]) {
      await page.getByRole("button", { name: "Przenieś 04-yellow.png niżej" }).click();
      expectedOrder = nextOrder;
      await expect.poll(() => readGallerySignature(page)).toEqual(signatureFor(expectedOrder));
    }
    await expect(page.getByRole("button", { name: "Przenieś 04-yellow.png niżej" })).toBeDisabled();

    await page.locator("#media-upload-gallery").setInputFiles({
      name: imageFixtures[4].name,
      mimeType: "image/png",
      buffer: makePng(imageFixtures[4].rgb, 4),
    });
    await expect(page.getByText("Przesłano", { exact: true })).toHaveCount(5);
    expectedOrder = [...imageFixtures];
    await expect.poll(() => readGallerySignature(page)).toEqual(signatureFor(expectedOrder));
    await page.getByRole("button", { name: "Przenieś 05-purple.png wyżej" }).click();
    expectedOrder = [imageFixtures[0], imageFixtures[1], imageFixtures[2], imageFixtures[4], imageFixtures[3]];
    await expect.poll(() => readGallerySignature(page)).toEqual(signatureFor(expectedOrder));
    await page.getByRole("button", { name: "Przenieś 05-purple.png wyżej" }).click();
    expectedOrder = [imageFixtures[0], imageFixtures[1], imageFixtures[4], imageFixtures[2], imageFixtures[3]];
    await expect.poll(() => readGallerySignature(page)).toEqual(signatureFor(expectedOrder));
    await capture(page, testInfo, "03-fifth-image-uploaded-and-reordered");

    const removedImage = page.getByRole("img", { name: "Podgląd 02-green.png" });
    await removedImage.locator("xpath=..").getByRole("button", { name: "Usuń", exact: true }).click();
    await expect(page.getByRole("img", { name: "Podgląd 02-green.png" })).toHaveCount(0);
    expectedOrder = [imageFixtures[0], imageFixtures[4], imageFixtures[2], imageFixtures[3]];
    await expect.poll(() => readGallerySignature(page)).toEqual(signatureFor(expectedOrder));
    await assertArrowTargets(page, expectedOrder.map((fixture) => fixture.name), testInfo);
    await expect(page.getByRole("button", { name: "Przenieś 01-red.png wyżej" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Przenieś 04-yellow.png niżej" })).toBeDisabled();
    await assertSubmittedGalleryOrder(page, expectedOrder.map((fixture) => fixture.name));
    await capture(page, testInfo, "04-image-removed-and-order-ready-to-save");

    createSaveNavigationPending = true;
    try {
      await Promise.all([
        page.waitForURL((url) => /^\/admin\/products\/[0-9a-f-]+\?saved=1$/i.test(url.pathname + url.search)),
        page.getByRole("button", { name: /Zapisz/ }).click(),
      ]);
    } finally {
      createSaveNavigationPending = false;
    }
    productPath = new URL(page.url()).pathname;
    await expect(page.getByText("Zapisano zmiany.", { exact: true })).toBeVisible();
    await expect.poll(() => readGallerySignature(page)).toEqual(signatureFor(expectedOrder));
    await assertSubmittedGalleryOrder(page, expectedOrder.map((fixture) => fixture.name));
    await capture(page, testInfo, "05-saved-product");

    await page.reload();
    await expect(page.getByRole("heading", { name: /Edycja: E2E Image Order/ })).toBeVisible();
    await expect.poll(() => readGallerySignature(page)).toEqual(signatureFor(expectedOrder));
    await capture(page, testInfo, "06-saved-product-reloaded");

    // Reopen the editor and exercise arrows on previously uploaded assets.
    await page.goto(productPath);
    await expect.poll(() => readGallerySignature(page)).toEqual(signatureFor(expectedOrder));
    await expect(page.getByRole("button", { name: "Przenieś 01-red.png wyżej" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Przenieś 04-yellow.png niżej" })).toBeDisabled();
    await page.getByRole("button", { name: "Przenieś 04-yellow.png wyżej" }).click();
    expectedOrder = [imageFixtures[0], imageFixtures[4], imageFixtures[3], imageFixtures[2]];
    await expect.poll(() => readGallerySignature(page)).toEqual(signatureFor(expectedOrder));
    await capture(page, testInfo, "07-existing-image-moved-in-editor");
    await page.getByRole("button", { name: "Przenieś 04-yellow.png niżej" }).click();
    expectedOrder = [imageFixtures[0], imageFixtures[4], imageFixtures[2], imageFixtures[3]];
    await expect.poll(() => readGallerySignature(page)).toEqual(signatureFor(expectedOrder));
    const editUrlBeforeSave = page.url();
    productUpdateSavePending = true;
    try {
      await page.getByRole("button", { name: /Zapisz/ }).click();
      await expect(page.getByTestId("product-save-bar")).toContainText("Zapisano. Zmiany są aktualne.");
      expect(page.url()).toBe(editUrlBeforeSave);
      await page.reload();
      await expect.poll(() => readGallerySignature(page)).toEqual(signatureFor(expectedOrder));
      await capture(page, testInfo, "08-existing-image-order-saved-again");
    } finally {
      productUpdateSavePending = false;
    }
  } catch (error) {
    flowFailure = error;
    try {
      const previewDiagnostics = await page.getByRole("img", { name: /^Podgląd / }).evaluateAll((previews) =>
        previews.map((preview) => {
          const style = getComputedStyle(preview);
          const rect = preview.getBoundingClientRect();
          return {
            label: preview.getAttribute("aria-label"),
            computedBackgroundImage: style.backgroundImage,
            inlineBackgroundImage: (preview as HTMLElement).style.backgroundImage,
            bounds: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            className: preview.className,
            outerHTML: preview.outerHTML,
          };
        }),
      );
      const diagnosticPath = testInfo.outputPath(testInfo.project.name + "-failure-state.png");
      await page.screenshot({ path: diagnosticPath, fullPage: true });
      preserveScreenshot(testInfo, testInfo.project.name + "-failure-state.png", diagnosticPath);
      await testInfo.attach("failure-state.png", { path: diagnosticPath, contentType: "image/png" });
      await testInfo.attach("gallery-preview-failure-diagnostics.json", {
        body: JSON.stringify(previewDiagnostics, null, 2),
        contentType: "application/json",
      });
      console.log("Gallery failure preview diagnostics: " + JSON.stringify(previewDiagnostics));
    } catch (diagnosticError) {
      console.log("Could not capture failure-state preview diagnostics: " + String(diagnosticError));
    }
  } finally {
    try {
      if (!productPath) {
        const match = page.url().match(/\/admin\/products\/([0-9a-f-]+)(?:\?|$)/i);
        if (match) productPath = "/admin/products/" + match[1];
      }

      if (productPath) {
        const acceptDialogs = (dialog: import("@playwright/test").Dialog) => void dialog.accept();
        page.on("dialog", acceptDialogs);
        try {
          await page.goto(productPath);
          const deleteProduct = page.getByRole("button", { name: "Usuń produkt", exact: true });
          await expect(deleteProduct).toBeVisible();
          await expect(deleteProduct).toBeEnabled();
          productDeletePending = true;
          try {
            await Promise.all([
              page.waitForURL((url) => url.pathname === "/admin/products" && url.searchParams.get("deleted") === "1"),
              deleteProduct.click(),
            ]);
          } finally {
            productDeletePending = false;
          }
        } finally {
          page.off("dialog", acceptDialogs);
        }
      } else if (productId && page.url().includes("/admin/products/new")) {
        for (const fixture of imageFixtures) {
          const preview = page.getByRole("img", { name: "Podgląd " + fixture.name });
          if (await preview.count()) {
            await preview.locator("xpath=..").getByRole("button", { name: "Usuń", exact: true }).click();
            await expect(preview).toHaveCount(0);
          }
        }
      }

      await verifyDisposableProductRemoved(productId);
    } catch (error) {
      cleanupFailure = error;
    }

    await testInfo.attach("browser-console-and-network.txt", {
      body: [
        "Project: " + testInfo.project.name,
        "Viewport: " + JSON.stringify(page.viewportSize()),
        "Browser console errors: " + (consoleErrors.join("\n") || "none"),
        "Page errors: " + (pageErrors.join("\n") || "none"),
        "Unexpected failed requests: " + (requestFailures.join("\n") || "none"),
        "Expected exact navigation cancellations: " + (expectedNavigationCancellations.join("\n") || "none"),
        "Main-frame navigation events: " +
          (mainFrameNavigations.map((event) => new Date(event.at).toISOString() + " " + event.url).join("\n") || "none"),
        "Unexpected HTTP failures: " + (unexpectedHttpFailures.join("\n") || "none"),
        "Expected local upload fallback (415 then multipart retry): " +
          (localUploadFallbacks.join("\n") || "none"),
      ].join("\n\n"),
      contentType: "text/plain",
    });
  }

  if (flowFailure) throw flowFailure;
  if (cleanupFailure) throw cleanupFailure;
  const expectedUpload415Message = "Failed to load resource: the server responded with a status of 415 (Unsupported Media Type)";
  const expectedUpload415ConsoleErrors = consoleErrors.filter((message) => message === expectedUpload415Message);
  const unexpectedConsoleErrors = consoleErrors.filter((message) => message !== expectedUpload415Message);
  expect(expectedUpload415ConsoleErrors.length).toBeLessThanOrEqual(localUploadFallbacks.length);
  expect(unexpectedConsoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(requestFailures).toEqual([]);
  expect(unexpectedHttpFailures).toEqual([]);
  expect(localUploadFallbacks.length).toBeLessThanOrEqual(5);
});

async function readGallerySignature(page: Page) {
  return page.getByRole("img", { name: /^Podgląd / }).evaluateAll(async (previews) =>
    Promise.all(previews.map(async (preview) => {
      const label = preview.getAttribute("aria-label") ?? "";
      const background = getComputedStyle(preview).backgroundImage;
      const match = background.match(/^url\(["']?(.*?)["']?\)$/);
      if (!match) return { label, rgb: null };

      const image = new Image();
      image.src = match[1];
      try {
        await image.decode();
      } catch {
        return { label, rgb: null };
      }
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create a canvas for gallery preview checks.");
      context.drawImage(image, 0, 0);
      const pixel = context.getImageData(16, 16, 1, 1).data;
      return { label, rgb: [pixel[0], pixel[1], pixel[2]] };
    })),
  );
}

async function readSubmittedGalleryOrder(page: Page) {
  return page.locator('#product-editor-form input[name="assetId"]').evaluateAll((assetIds) => {
    const assets = assetIds.map((assetId) => {
      const fields = Object.fromEntries(
        Array.from(assetId.parentElement?.querySelectorAll("input") ?? []).map((input) => [
          input.name,
          input.value,
        ]),
      );
      return {
        filename: fields.assetFilename,
        kind: fields.assetKind,
        sortOrder: Number(fields.assetSortOrder),
      };
    });
    return assets
      .filter((asset) => asset.kind === "gallery")
      .map(({ filename, sortOrder }) => ({ filename, sortOrder }));
  });
}

async function assertSubmittedGalleryOrder(page: Page, expectedFilenames: string[]) {
  await expect.poll(async () => {
    const submitted = await readSubmittedGalleryOrder(page);
    const sortOrders = submitted.map((asset) => asset.sortOrder);
    return {
      filenames: submitted.map((asset) => asset.filename),
      sortOrders,
      strictlyIncreasing: sortOrders.every((order, index) => index === 0 || order > sortOrders[index - 1]),
    };
  }).toMatchObject({ filenames: expectedFilenames, strictlyIncreasing: true });
}

async function assertArrowTargets(page: Page, filenames: string[], testInfo: TestInfo) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Playwright did not provide a viewport.");
  const diagnostics: Array<Record<string, unknown>> = [];
  const enabledMisses: Array<Record<string, unknown>> = [];

  for (const filename of filenames) {
    for (const direction of ["wyżej", "niżej"]) {
      const button = page.getByRole("button", { name: "Przenieś " + filename + " " + direction });
      await button.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
      await expect(button).toBeVisible();
      const bounds = await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        const hitElement = hit instanceof Element ? hit : null;
        return {
          disabled: (element as HTMLButtonElement).disabled,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          center: { x, y },
          receivesCenterHit: hit === element || Boolean(hit && element.contains(hit)),
          topHit: hitElement
            ? {
                tag: hitElement.tagName,
                className: typeof hitElement.className === "string" ? hitElement.className : "",
                ariaLabel: hitElement.getAttribute("aria-label"),
                text: hitElement.textContent?.trim().slice(0, 120) ?? "",
                outerHTML: hitElement.outerHTML.slice(0, 400),
              }
            : null,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        };
      });
      const diagnostic = { ...bounds, filename, direction };
      diagnostics.push(diagnostic);
      if (!bounds.receivesCenterHit) {
        console.log("Arrow center hit diagnostic: " + JSON.stringify(diagnostic));
        if (!bounds.disabled) enabledMisses.push(diagnostic);
      }

      expect(bounds.width, filename + " " + direction + " arrow width").toBeGreaterThanOrEqual(32);
      expect(bounds.height, filename + " " + direction + " arrow height").toBeGreaterThanOrEqual(32);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.receivesCenterHit === false)) {
    await testInfo.attach("arrow-target-diagnostics.json", {
      body: JSON.stringify(diagnostics, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({
      path: testInfo.outputPath(testInfo.project.name + "-arrow-target-diagnostics.png"),
      fullPage: true,
    });
    preserveScreenshot(
      testInfo,
      testInfo.project.name + "-arrow-target-diagnostics.png",
      testInfo.outputPath(testInfo.project.name + "-arrow-target-diagnostics.png"),
    );
  }
  expect(enabledMisses, "enabled arrow buttons should receive a center hit").toEqual([]);
}

function signatureFor(fixtures: ReadonlyArray<(typeof imageFixtures)[number]>) {
  return fixtures.map((fixture) => ({
    label: "Podgląd " + fixture.name,
    rgb: [...fixture.rgb],
  }));
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = testInfo.outputPath(testInfo.project.name + "-" + name + ".png");
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });
  preserveScreenshot(testInfo, testInfo.project.name + "-" + name + ".png", screenshotPath);
}

function preserveScreenshot(testInfo: TestInfo, filename: string, sourcePath: string) {
  const evidenceRoot = process.env.PLAYWRIGHT_IMAGE_ORDER_EVIDENCE_DIR;
  if (!evidenceRoot) return;

  const projectDirectory = path.join(evidenceRoot, testInfo.project.name);
  fs.mkdirSync(projectDirectory, { recursive: true });
  const destination = path.join(projectDirectory, filename);
  fs.copyFileSync(sourcePath, destination);
  console.log("Screenshot evidence: " + destination);
}

async function verifyDisposableProductRemoved(productId: string) {
  if (!productId) return;

  const contentPath = path.resolve(process.cwd(), "data", "lamilialomi-content.local.json");
  if (fs.existsSync(contentPath)) {
    const snapshot = JSON.parse(fs.readFileSync(contentPath, "utf8")) as {
      products?: Array<{ id?: string }>;
    };
    expect(snapshot.products?.some((product) => product.id === productId)).not.toBe(true);
  }

  const uploadDirectory = path.resolve(process.cwd(), "public", "uploads", productId);
  if (fs.existsSync(uploadDirectory)) {
    const remainingFiles = listFilesRecursively(uploadDirectory);
    expect(remainingFiles, "uploaded media for disposable product should be removed").toEqual([]);
  }
}

function listFilesRecursively(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFilesRecursively(entryPath) : [entryPath];
  });
}

function makePng(rgb: readonly number[], variant: number) {
  const width = 128;
  const height = 96;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (1 + width * 4);
    scanlines[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      const border = x < 8 || y < 8 || x >= width - 8 || y >= height - 8;
      scanlines[offset] = border ? Math.min(255, rgb[0] + 30) : rgb[0];
      scanlines[offset + 1] = border ? Math.min(255, rgb[1] + 30) : rgb[1];
      scanlines[offset + 2] = border ? Math.min(255, rgb[2] + 30) : rgb[2];
      scanlines[offset + 3] = 255;
      if (x > 32 + variant * 4 && x < 64 + variant * 4 && y > 28 && y < 68) {
        scanlines[offset] = 255;
        scanlines[offset + 1] = 255;
        scanlines[offset + 2] = 255;
      }
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
