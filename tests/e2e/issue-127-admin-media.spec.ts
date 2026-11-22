import { expect, test, type Page, type Request } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { communityFixtures, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

async function captureRetainedGallery(page: Page, filename: string, fixtureProductId: string) {
  const gallery = page.locator("#media-section-gallery");
  await gallery.scrollIntoViewIfNeeded();
  const preview = gallery.getByRole("img").first();
  await expect(preview).toBeVisible();
  // The editor renders a CSS background, not an <img>. Decode that exact source
  // before claiming the reloaded preview is visually ready; never retain its URL.
  await expect.poll(() => preview.evaluate((element) => getComputedStyle(element).backgroundImage)).not.toBe("none");
  const dimensions = await preview.evaluate(async (element) => {
    const source = getComputedStyle(element).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
    if (!source) throw new Error("The retained asset preview has no image source.");
    const image = new Image();
    image.src = source;
    await image.decode();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { width: image.naturalWidth, height: image.naturalHeight };
  });
  expect(dimensions.width).toBeGreaterThan(0);
  expect(dimensions.height).toBeGreaterThan(0);
  await expect(gallery.getByText("Przesłano", { exact: true })).toBeVisible();
  await expect(page.getByTestId("product-save-bar")).toBeVisible();
  await page.screenshot({
    path: filename,
    fullPage: false,
    animations: "disabled",
    caret: "hide",
    // Only random controlled fixture identifiers are masked, should they enter
    // this viewport. Asset filename/preview/state, errors and Save remain visible.
    mask: [page.getByText(`ID: ${fixtureProductId}`, { exact: true }), page.getByLabel("Adres produktu")],
  });
  return dimensions;
}

test("F31 real cloud Save failure retains uploaded bytes for retry and reload", async ({ page }, testInfo) => {
  test.skip(process.env.RUN_ISSUE_127_ADMIN_E2E !== "1", "Requires guarded exclusive local Supabase Auth/DB/Storage.");
  test.setTimeout(180_000);
  const fixtures = await communityFixtures(testInfo);
  const runId = `ux127-admin-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
  const screenshotBase = `ux127-admin-${testInfo.project.name}`;
  const manifestDirectory = path.resolve(".task/ux127/runtime-manifests");
  const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const directory = path.resolve("docs/verification/issue-127");
  const storageTransfers: string[] = [];
  const pageErrors: string[] = [];
  const pendingServerActions = new Set<Request>();
  let lastServerActionActivityAt = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === COMMUNITY_TEST_ORIGIN && request.method() === "POST" && request.headers()["next-action"]) {
      pendingServerActions.add(request);
      lastServerActionActivityAt = Date.now();
    }
    if (url.pathname.startsWith("/storage/v1/upload/resumable") && ["POST", "PATCH"].includes(request.method())) {
      storageTransfers.push(`${request.method()} ${url.pathname}`);
    }
  });
  const finishServerAction = (request: Request) => {
    if (pendingServerActions.delete(request)) lastServerActionActivityAt = Date.now();
  };
  page.on("requestfinished", finishServerAction);
  page.on("requestfailed", finishServerAction);
  let storagePath = "";
  let storageBucket = "";
  let productId = "";
  try {
    const admin = await fixtures.actor("ux127-admin", { admin: true });
    const book = await fixtures.product("UX127 admin media retained", "draft");
    const duplicate = await fixtures.product("UX127 duplicate slug guard", "draft");
    productId = book.id;
    await fixtures.login(page, admin, `/admin/products/${book.id}`);
    await expect(page.locator("#product-editor-form")).toBeVisible();
    const image = await sharp({ create: { width: 850, height: 1100, channels: 3, background: "#b6c4aa" } }).png().toBuffer();
    const targetResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/assets" && response.request().method() === "POST");
    await page.locator("#media-upload-gallery").setInputFiles({ name: "ux127-book.png", mimeType: "image/png", buffer: image });
    const response = await targetResponse;
    expect(response.status()).toBe(200);
    const payload = await response.json();
    const asset = payload.asset as { id: string; storagePath: string; bucket: string };
    storagePath = asset.storagePath;
    storageBucket = asset.bucket;
    expect(storagePath.startsWith(`products/${book.id}/gallery/`)).toBe(true);
    await expect(page.locator('input[name="assetId"]')).toHaveValue(asset.id);
    await expect(page.getByRole("button", { name: /Zapisz/ })).toBeEnabled();
    expect(storageTransfers.length).toBeGreaterThan(0);
    const beforeFailureTransfers = storageTransfers.length;
    expect((await fixtures.service.storage.from(storageBucket).info(storagePath)).error).toBeNull();

    // This is an actual database uniqueness rejection, not an intercepted mock response.
    await page.getByLabel("Adres produktu").fill(duplicate.slug);
    await page.getByRole("button", { name: /Zapisz/ }).click();
    await expect(page.getByTestId("product-save-bar")).toContainText("Zapis nie powi\u00f3d\u0142 si\u0119.");
    await expect(page.locator('input[name="assetId"]')).toHaveValue(asset.id);
    await expect(page.locator('input[name="assetPath"]')).toHaveValue(storagePath);
    expect((await fixtures.service.storage.from(storageBucket).info(storagePath)).error).toBeNull();
    expect((await fixtures.service.from("product_assets").select("id").eq("id", asset.id)).data).toEqual([]);
    await mkdir(directory, { recursive: true });
    const retainedPreview = await captureRetainedGallery(page, path.join(directory, `${screenshotBase}-retained.png`), book.id);

    await page.getByLabel("Adres produktu").fill(book.slug);
    await page.getByRole("button", { name: /Zapisz/ }).click();
    await expect(page.getByTestId("product-save-bar")).toContainText("Zapisano. Zmiany s\u0105 aktualne.");
    expect(storageTransfers.length).toBe(beforeFailureTransfers);
    const persisted = await fixtures.service.from("product_assets").select("id,path").eq("product_id", book.id).eq("id", asset.id).single();
    expect(persisted.error).toBeNull();
    expect(persisted.data?.path).toBe(storagePath);
    // WebKit can schedule a follow-up Server Action immediately after React
    // reports the save result. Let that actual work settle before a full GET
    // reload, so the test does not cancel the request it is measuring.
    await expect.poll(() => pendingServerActions.size === 0 && Date.now() - lastServerActionActivityAt >= 500,
      { timeout: 15_000, message: "Product save Server Actions must settle before persistence reload." }).toBe(true);
    await page.reload();
    await expect(page.locator('input[name="assetId"]')).toHaveValue(asset.id);
    await expect(page.locator('input[name="assetPath"]')).toHaveValue(storagePath);
    expect((await fixtures.service.storage.from(storageBucket).info(storagePath)).error).toBeNull();
    expect(storageTransfers.length).toBe(beforeFailureTransfers);
    expect(pageErrors).toEqual([]);
    const reloadedPreview = await captureRetainedGallery(page, path.join(directory, `${screenshotBase}-reloaded.png`), book.id);
    await mkdir(manifestDirectory, { recursive: true });
    await writeFile(path.join(manifestDirectory, `${runId}.json`), JSON.stringify({ testedSha, runId, status: "PASS",
      checks: ["real Auth admin", "real TUS Storage upload", "real duplicate slug Save failure", "retained object and editor id",
        "retry Save without retransmission", "database readback", "reload persistence", "actual retained and reloaded preview decode"], storageTransfers: beforeFailureTransfers,
      decodedPreviews: { retained: retainedPreview, reloaded: reloadedPreview },
      screenshotPolicy: "Gallery viewport with real fixed controls; only controlled fixture product ID and slug input masked; no error, asset state or Save control masked.",
      browser: testInfo.project.name, viewport: testInfo.project.use.viewport,
      screenshots: ["retained", "reloaded"].map((phase) => ({ path: `docs/verification/issue-127/${screenshotBase}-${phase}.png`, testedSha, runId })) }, null, 2));
  } finally {
    // The shared loader has already proven an exclusive local database and owns this product.
    if (storagePath) {
      expect(fixtures.products).toContain(productId);
      expect(storagePath.startsWith(`products/${productId}/gallery/`)).toBe(true);
      expect((await fixtures.service.storage.from(storageBucket).remove([storagePath])).error).toBeNull();
    }
    await fixtures.cleanup();
  }
});
