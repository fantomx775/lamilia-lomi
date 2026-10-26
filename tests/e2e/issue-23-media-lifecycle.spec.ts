import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test.setTimeout(240_000);

let releaseContentStoreLock: (() => void) | undefined;

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
    "Issue 23 lifecycle E2E uses synthetic records and requires the loopback app running the local demo backend.",
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

test("replacing a synthetic product cover keeps one active image and retires the previous local object", async ({ page }, testInfo) => {
  const suffix = `issue-23-${testInfo.project.name}-${Date.now()}`;
  const title = `Media lifecycle ${suffix}`;
  const slug = `media-lifecycle-${suffix}`;
  const firstFilename = "issue-23-cover-first.png";
  const replacementFilename = "issue-23-cover-replacement.png";
  const diagnostics = {
    consoleErrors: [] as Array<{ message: string; disposition: string; reason?: string }>,
    pageErrors: [] as string[],
    failedRequests: [] as Array<{ method: string; url: string; error: string | null; disposition: string; reason?: string }>,
    failedResponses: [] as Array<{ method: string; url: string; status: number; disposition: string; reason?: string }>,
  };
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    diagnostics.consoleErrors.push(text.includes("status of 415")
      ? { message: text, disposition: "expected", reason: "The local demo uploader selects its multipart fallback with HTTP 415, then completes the upload." }
      : { message: text, disposition: "unresolved" });
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText ?? null;
    const url = new URL(request.url());
    const abortedNavigation = error === "net::ERR_ABORTED" && request.isNavigationRequest();
    const supersededImage = error === "net::ERR_ABORTED" && url.pathname === "/_next/image";
    const abortedFont = error === "net::ERR_ABORTED" && request.resourceType() === "font";
    const deletedProductNavigation = error === "net::ERR_ABORTED" && /^\/admin\/products\/[0-9a-f-]+$/i.test(url.pathname);
    const completedCreateAction = error === "net::ERR_ABORTED" && request.method() === "POST" &&
      url.pathname === "/admin/products/new" && Boolean(request.headers()["next-action"]);
    diagnostics.failedRequests.push({
      method: request.method(),
      url: safeUrl(request.url()),
      error,
      disposition: abortedNavigation || supersededImage || abortedFont || deletedProductNavigation || completedCreateAction ? "unrelated" : "unresolved",
      ...(abortedNavigation
        ? { reason: "The browser canceled a document request while completing the asserted local admin navigation." }
        : supersededImage
          ? { reason: "Replacing the saved cover canceled obsolete Next image optimizer requests; the new cover preview and saved record were verified after replacement." }
          : abortedFont
            ? { reason: "Document navigation canceled an in-flight font request after the local product state had been verified." }
            : deletedProductNavigation
              ? { reason: "The browser canceled a product-editor document request while the confirmed delete action navigated back to the product list." }
              : completedCreateAction
                ? { reason: "Next canceled the create Server Action request while opening the saved editor; the persisted product and replacement were verified after reload." }
                : {}),
    });
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const request = response.request();
    const expectedLocalFallback = response.status() === 415 && new URL(response.url()).pathname === "/api/admin/assets";
    diagnostics.failedResponses.push({
      method: request.method(),
      url: safeUrl(response.url()),
      status: response.status(),
      disposition: expectedLocalFallback ? "expected" : "unresolved",
      ...(expectedLocalFallback ? { reason: "The local demo uploader selects the multipart fallback, which the test verifies succeeds." } : {}),
    });
  });

  let productId: string | undefined;

  try {
    await signInAsAdmin(page);
    cleanupPreviousSyntheticProducts();
    await page.goto("/admin/products/new");
    productId = await page.locator('#product-editor-form input[name="id"]').inputValue();
    await page.getByLabel("Tytuł").fill(title);
    await page.getByLabel("Krótki opis").fill("Synthetic local product for cover replacement verification.");
    await page.getByLabel("Adres produktu").fill(slug);
    await page.getByLabel("Pozycja w katalogu").fill("83");

    const coverSection = page.locator("#media-section-cover");
    const coverInput = page.locator("#media-upload-cover");
    await coverInput.setInputFiles({ name: firstFilename, mimeType: "image/png", buffer: makePng([205, 67, 75]) });
    await expect(coverSection.getByRole("img", { name: `Podgląd ${firstFilename}` })).toBeVisible();
    await expect(coverSection.getByText("Przesłano", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Zapisz/ }).click();
    await expect(page.getByText("Zapisano. Zmiany są aktualne.")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Zmiany produktu zostały zapisane." })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]+$/i);
    const productPath = new URL(page.url()).pathname;
    productId = productPath.split("/").at(-1);
    await expect(page.getByText("Nie dodano jeszcze prac.", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByText("Nie dodano jeszcze prac.", { exact: true })).toBeVisible({ timeout: 15_000 });

    const contentPath = path.resolve(process.cwd(), "data", "lamilialomi-content.local.json");
    const readSnapshot = () => JSON.parse(fs.readFileSync(contentPath, "utf8")) as {
      products?: Array<{ id?: string; assets?: Array<{ kind?: string; filename?: string; isActive?: boolean; path?: string }> }>;
    };
    const initialProduct = readSnapshot().products?.find((product) => product.id === productId);
    const initialCover = initialProduct?.assets?.find((asset) => asset.kind === "cover" && asset.isActive !== false);
    expect(initialCover?.filename).toBe(firstFilename);
    expect(initialCover?.path).toBeTruthy();
    const initialCoverPath = path.resolve(process.cwd(), "public", initialCover!.path!.replace(/^\/+/, ""));
    expect(fs.existsSync(initialCoverPath)).toBe(true);

    await coverInput.setInputFiles({ name: replacementFilename, mimeType: "image/png", buffer: makePng([43, 126, 191]) });
    await expect(coverSection.getByRole("img", { name: `Podgląd ${replacementFilename}` })).toBeVisible();
    await expect(coverSection.getByText(new RegExp(firstFilename))).toContainText("zostanie usunięty po zapisaniu");

    const evidenceRoot = process.env.ISSUE_23_EVIDENCE_DIR;
    if (evidenceRoot) {
      const evidenceDirectory = path.resolve(process.cwd(), evidenceRoot, testInfo.project.name);
      fs.mkdirSync(evidenceDirectory, { recursive: true });
      await page.screenshot({ path: path.join(evidenceDirectory, "cover-replacement-before-save.png"), fullPage: true, animations: "disabled" });
    }

    await page.getByRole("button", { name: /Zapisz/ }).click();
    await expect(page.getByText("Zapisano. Zmiany są aktualne.")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Zmiany produktu zostały zapisane." })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]+$/i);
    await page.reload();
    await expect(page.getByText("Nie dodano jeszcze prac.", { exact: true })).toBeVisible({ timeout: 15_000 });
    const savedCoverSection = page.locator("#media-section-cover");
    await expect(savedCoverSection.getByRole("img", { name: `Podgląd ${replacementFilename}` })).toBeVisible();
    await expect(savedCoverSection.getByText(firstFilename, { exact: true })).toHaveCount(0);

    const savedProduct = readSnapshot().products?.find((product) => product.id === productId);
    expect(savedProduct).toBeDefined();
    const activeCovers = savedProduct?.assets?.filter((asset) => asset.kind === "cover" && asset.isActive !== false) ?? [];
    expect(activeCovers).toHaveLength(1);
    expect(activeCovers[0].filename).toBe(replacementFilename);
    expect(activeCovers[0].path).not.toBe(initialCover?.path);
    const oldCover = savedProduct?.assets?.find((asset) => asset.kind === "cover" && asset.filename === firstFilename);
    expect(oldCover).toBeUndefined();
    expect(fs.existsSync(initialCoverPath)).toBe(false);

    const unresolvedConsole = diagnostics.consoleErrors.filter((entry) => entry.disposition === "unresolved");
    const unresolvedRequests = diagnostics.failedRequests.filter((entry) => entry.disposition === "unresolved");
    const unresolvedResponses = diagnostics.failedResponses.filter((entry) => entry.disposition === "unresolved");
    expect({ unresolvedConsole, pageErrors: diagnostics.pageErrors, unresolvedRequests, unresolvedResponses }).toEqual({
      unresolvedConsole: [], pageErrors: [], unresolvedRequests: [], unresolvedResponses: [],
    });
  } finally {
    // The browser may already be closed after a timeout or failed navigation.
    // Remove only this locked local fixture even when UI cleanup cannot run.
    if (productId) cleanupSyntheticProduct(productId);
    await testInfo.attach("browser-diagnostics.json", {
      body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
      contentType: "application/json",
    });
  }
});

function cleanupSyntheticProduct(productId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
    throw new Error("Invalid synthetic product ID for local cleanup.");
  }
  const contentPath = path.resolve("data/lamilialomi-content.local.json");
  if (fs.existsSync(contentPath)) {
    const snapshot = JSON.parse(fs.readFileSync(contentPath, "utf8")) as { products?: Array<{ id?: string }> };
    if (snapshot.products?.some(product => product.id === productId)) {
      snapshot.products = snapshot.products.filter(product => product.id !== productId);
      fs.writeFileSync(contentPath, JSON.stringify(snapshot));
    }
  }
  const uploadsRoot = path.resolve("public/uploads");
  const uploadDirectory = path.resolve(uploadsRoot, productId);
  if (path.dirname(uploadDirectory) !== uploadsRoot) throw new Error("Unsafe fixture cleanup path.");
  if (fs.existsSync(uploadDirectory)) fs.rmSync(uploadDirectory, { recursive: true, force: true });
}

async function signInAsAdmin(page: Page) {
  await page.goto("/en/login?redirectTo=/admin");
  await page.getByLabel("Email").fill("admin@lamilialomi.test");
  await page.getByLabel("Password").fill("demo-password");
  const loginActionFinished = page.waitForEvent("requestfinished", (request) => {
    const url = new URL(request.url());
    return request.method() === "POST" &&
      url.pathname === "/en/login" &&
      (Boolean(request.headers()["next-action"]) || request.isNavigationRequest());
  });
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.getByRole("button", { name: "Continue" }).click(),
    loginActionFinished,
  ]);
}

function cleanupPreviousSyntheticProducts() {
  const contentPath = path.resolve(process.cwd(), "data", "lamilialomi-content.local.json");
  if (!fs.existsSync(contentPath)) return;
  const snapshot = JSON.parse(fs.readFileSync(contentPath, "utf8")) as {
    products?: Array<{ id?: string; slug?: string }>;
  };
  const ids = (snapshot.products ?? [])
    .filter((product) => product.id && product.slug?.startsWith("media-lifecycle-issue-23-"))
    .map((product) => product.id!);

  for (const id of ids) {
    cleanupSyntheticProduct(id);
  }
}

function safeUrl(value: string) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function makePng(rgb: readonly number[]) {
  const width = 640;
  const height = 640;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (1 + width * 4);
    scanlines[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 4;
      const accent = x > 160 && x < 480 && y > 160 && y < 480;
      scanlines[offset] = accent ? 255 : rgb[0];
      scanlines[offset + 1] = accent ? 255 : rgb[1];
      scanlines[offset + 2] = accent ? 255 : rgb[2];
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
