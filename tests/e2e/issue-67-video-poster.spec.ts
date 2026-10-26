import { devices, expect, test, webkit, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createServer, type Server } from "node:http";

import { getSeedContentSnapshot } from "../../src/lib/local-content";
import { serializeRichTextDocument } from "../../src/lib/rich-text";
import type { ProductAsset } from "../../src/lib/types";
import frog from "./fixtures/issue-60/frog-prince-public.json";
import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test.setTimeout(180_000);

type BrowserDiagnostics = {
  engine: string;
  consoleErrors: string[];
  pageErrors: string[];
  failedResponses: Array<{ url: string; status: number }>;
  failedRequests: Array<{ method: string; url: string; error: string | null; range: string | null }>;
};

test("Issue 67 shows a native cover poster and plays the real flip-through video", async ({ page }, testInfo) => {
  test.skip(!(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)), "The real public video fixture runs against disposable local content.");

  const release = await acquireLocalContentStoreLock();
  const store = path.resolve("data/lamilialomi-content.local.json");
  const originalStore = fs.existsSync(store) ? fs.readFileSync(store) : null;
  const mediaDirectory = path.resolve("public/uploads/issue-67-browser");
  const evidenceDirectory = path.resolve(process.env.ISSUE_67_SCREENSHOT_DIR ?? "test-results/issue-67-screenshots");
  const runId = process.env.ISSUE_67_RUN_ID ?? `issue-67-${Date.now()}`;
  const diagnostics: BrowserDiagnostics[] = [];
  let videoServer: Server | undefined;
  let webkitBrowser: Awaited<ReturnType<typeof webkit.launch>> | undefined;
  let webkitPlaybackVerified = false;

  const recordDiagnostics = (target: Page, engine: string) => {
    const result: BrowserDiagnostics = {
      engine,
      consoleErrors: [],
      pageErrors: [],
      failedResponses: [],
      failedRequests: [],
    };
    diagnostics.push(result);
    target.on("console", (message) => {
      if (message.type() === "error") result.consoleErrors.push(message.text());
    });
    target.on("pageerror", (error) => result.pageErrors.push(error.message));
    target.on("response", (response) => {
      if (response.status() >= 400) {
        result.failedResponses.push({
          url: new URL(response.url()).origin + new URL(response.url()).pathname,
          status: response.status(),
        });
      }
    });
    target.on("requestfailed", (request) => {
      result.failedRequests.push({
        method: request.method(),
        url: new URL(request.url()).origin + new URL(request.url()).pathname,
        error: request.failure()?.errorText ?? null,
        range: request.headers()["range"] ?? null,
      });
    });
    return result;
  };

  const saveScreenshot = async (target: Page, name: string) => {
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    await target.addStyleTag({ content: "nextjs-portal { display: none; }" });
    await target.screenshot({
      path: path.join(evidenceDirectory, `${name}.png`),
      fullPage: false,
      animations: "disabled",
    });
  };

  try {
    if (!frog.video) throw new Error("The public Frog Prince fixture has no video asset.");

    const snapshot = getSeedContentSnapshot();
    const sourceProduct = structuredClone(snapshot.products[0]);
    const productId = "67676767-6767-4676-8676-676767676767";
    const product = {
      ...sourceProduct,
      id: productId,
      slug: "issue-67-frog-prince-video",
      status: "published" as const,
      categoryIds: [],
      tagIds: [],
      premiumCodes: [],
      coverAssetId: "issue-67-cover",
      videoAssetId: "issue-67-video",
      translations: [{
        locale: "en" as const,
        title: frog.title,
        shortDescription: frog.shortDescription,
        longDescription: serializeRichTextDocument({ type: "doc", content: [] }),
      }],
      assets: [] as ProductAsset[],
    };

    fs.mkdirSync(mediaDirectory, { recursive: true });
    const coverFile = path.join(mediaDirectory, "cover.png");
    if (!fs.existsSync(coverFile)) {
      const coverResponse = await fetch(frog.cover.path, { signal: AbortSignal.timeout(90_000) });
      if (!coverResponse.ok) throw new Error(`Public cover fixture download returned ${coverResponse.status}`);
      fs.writeFileSync(coverFile, Buffer.from(await coverResponse.arrayBuffer()));
    }
    const videoFile = path.join(mediaDirectory, "source.mp4");
    if (!fs.existsSync(videoFile)) {
      const videoResponse = await fetch(frog.video.path, { signal: AbortSignal.timeout(90_000) });
      if (!videoResponse.ok) throw new Error(`Public video fixture download returned ${videoResponse.status}`);
      fs.writeFileSync(videoFile, Buffer.from(await videoResponse.arrayBuffer()));
    }

    const galleryAssets: ProductAsset[] = [];
    for (const [index, image] of frog.images.entries()) {
      const filename = `page-${index + 1}.png`;
      const imageFile = path.join(mediaDirectory, filename);
      if (!fs.existsSync(imageFile)) {
        const imageResponse = await fetch(image.path, { signal: AbortSignal.timeout(90_000) });
        if (!imageResponse.ok) throw new Error(`Public gallery fixture returned ${imageResponse.status}`);
        fs.writeFileSync(imageFile, Buffer.from(await imageResponse.arrayBuffer()));
      }

      galleryAssets.push({
        id: `issue-67-gallery-${index + 1}`,
        productId,
        kind: "gallery",
        bucket: "public-media",
        path: `/uploads/issue-67-browser/${filename}`,
        filename: image.alt ?? filename,
        contentType: "image/png",
        sortOrder: index + 1,
        isPublic: true,
        title: image.alt,
      });
    }

    const localPosterPath = "/uploads/issue-67-browser/cover.png";
    const posterAsset: ProductAsset = {
      id: "issue-67-cover",
      productId,
      kind: "cover",
      bucket: "public-media",
      path: localPosterPath,
      filename: frog.cover.alt ?? "cover.png",
      contentType: "image/png",
      sortOrder: 0,
      isPublic: true,
      title: frog.cover.alt,
    };

    const videoSize = fs.statSync(videoFile).size;
    videoServer = createServer((request, response) => {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Math.min(Number(range[2]), videoSize - 1) : videoSize - 1;
      if (start > end || start >= videoSize) {
        response.writeHead(416, { "Content-Range": `bytes */${videoSize}` });
        response.end();
        return;
      }
      response.writeHead(range ? 206 : 200, {
        "Content-Type": "video/mp4",
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${videoSize}` } : {}),
      });
      fs.createReadStream(videoFile, { start, end }).pipe(response);
    });
    await new Promise<void>((resolve) => videoServer!.listen(0, "127.0.0.1", resolve));
    const address = videoServer.address();
    if (!address || typeof address === "string") throw new Error("The local video range server did not bind.");

    const videoAsset: ProductAsset = {
      id: "issue-67-video",
      productId,
      kind: "video",
      bucket: "public-media",
      path: `http://127.0.0.1:${address.port}/video.mp4`,
      filename: frog.video.title,
      contentType: "video/mp4",
      sortOrder: 0,
      isPublic: true,
      title: frog.video.title,
    };
    product.assets = [posterAsset, ...galleryAssets, videoAsset];
    snapshot.products.push(product);
    fs.mkdirSync(path.dirname(store), { recursive: true });
    const saveProduct = () => fs.writeFileSync(store, JSON.stringify(snapshot));
    saveProduct();

    await page.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
    if (testInfo.project.name === "chromium") await page.setViewportSize({ width: 1440, height: 900 });
    const desktopOrPixelDiagnostics = recordDiagnostics(page, testInfo.project.name);
    await page.goto(`/en/products/${product.slug}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: frog.title })).toBeVisible();
    await page.evaluate(async () => { await document.fonts.ready; });

    const video = page.locator("video");
    const insideBook = page.locator('section[aria-labelledby="inside-book-title"]');
    const bothMediaLayout = insideBook.getByTestId("product-media-layout");
    await expect(bothMediaLayout).toHaveAttribute("data-layout", "gallery-video");
    await expect(bothMediaLayout.getByRole("button", { name: /Open image/ })).toHaveCount(4);
    await expect.poll(() => bothMediaLayout.locator("img").evaluateAll((images) =>
      images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
    ), { timeout: 45_000 }).toBe(true);
    const expectedColumnCount = testInfo.project.name === "chromium" ? 2 : 1;
    await expect.poll(() => bothMediaLayout.evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length,
    )).toBe(expectedColumnCount);
    await expect(video).toHaveAttribute("controls", "");
    await expect(video).toHaveAttribute("playsinline", "");
    await expect(video).toHaveAttribute("preload", "none");
    await expect(video).toHaveAttribute("poster", localPosterPath);
    await expect(page.getByText("Flip-through · 8 sec", { exact: true })).toHaveCount(0);

    const posterResponse = await page.request.get(new URL(localPosterPath, String(testInfo.project.use.baseURL)).toString());
    expect(posterResponse.status()).toBe(200);
    expect(posterResponse.headers()["content-type"]).toContain("image/png");
    await video.evaluate(async (element) => {
      const posterImage = new Image();
      posterImage.src = (element as HTMLVideoElement).poster;
      await posterImage.decode();
    });
    expect(await video.evaluate((element) => (element as HTMLVideoElement).paused && (element as HTMLVideoElement).currentTime === 0)).toBe(true);

    const playerBounds = await video.boundingBox();
    expect(playerBounds).not.toBeNull();
    expect(playerBounds!.width / playerBounds!.height).toBeCloseTo(16 / 9, 1);
    await video.scrollIntoViewIfNeeded();
    await saveScreenshot(page, `video-poster-${testInfo.project.name}`);

    await video.evaluate(async (element) => {
      await (element as HTMLVideoElement).play();
    });
    await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 20_000 }).toBeGreaterThan(0.2);
    await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).seekable.length), { timeout: 20_000 }).toBeGreaterThan(0);
    await saveScreenshot(page, `video-playing-${testInfo.project.name}`);
    await video.evaluate((element) => (element as HTMLVideoElement).pause());
    await video.evaluate(async (element) => {
      const player = element as HTMLVideoElement;
      const targetTime = Math.min(1, player.duration / 2);
      await new Promise<void>((resolve) => {
        player.addEventListener("seeked", () => resolve(), { once: true });
        player.currentTime = targetTime;
      });
    });
    expect(await video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    product.assets = product.assets.filter((asset) => asset.kind !== "video");
    product.videoAssetId = "";
    saveProduct();
    await page.reload({ waitUntil: "domcontentloaded" });
    const imagesOnlyLayout = page.getByTestId("product-media-layout");
    await expect(imagesOnlyLayout).toHaveAttribute("data-layout", "gallery");
    await expect(imagesOnlyLayout).not.toHaveClass(/grid/);
    await expect(imagesOnlyLayout.getByRole("button", { name: /Open image/ })).toHaveCount(4);
    await expect(imagesOnlyLayout.locator("video")).toHaveCount(0);

    product.assets = product.assets.filter((asset) => asset.kind !== "gallery");
    product.assets.push(videoAsset);
    product.videoAssetId = videoAsset.id;
    saveProduct();
    await page.reload({ waitUntil: "domcontentloaded" });
    const videoOnlyLayout = page.getByTestId("product-media-layout");
    await expect(videoOnlyLayout).toHaveAttribute("data-layout", "video");
    await expect(videoOnlyLayout).not.toHaveClass(/grid/);
    await expect(videoOnlyLayout.locator("video")).toBeVisible();
    await expect(videoOnlyLayout.getByRole("button", { name: /Open image/ })).toHaveCount(0);

    product.assets = product.assets.filter((asset) => asset.kind !== "video");
    product.videoAssetId = "";
    saveProduct();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('section[aria-labelledby="inside-book-title"]')).toHaveCount(0);
    await expect(page.getByTestId("product-media-layout")).toHaveCount(0);

    product.assets = [posterAsset, ...galleryAssets, videoAsset];
    product.videoAssetId = videoAsset.id;
    saveProduct();

    if (testInfo.project.name === "chromium") {
      webkitBrowser = await webkit.launch();
      const webkitContext = await webkitBrowser.newContext({ ...devices["iPhone 13"] });
      const webkitPage = await webkitContext.newPage();
      const webkitDiagnostics = recordDiagnostics(webkitPage, "webkit-iphone-13");
      await webkitPage.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
      await webkitPage.goto(new URL(`/en/products/${product.slug}`, String(testInfo.project.use.baseURL)).toString(), { waitUntil: "domcontentloaded" });
      await webkitPage.evaluate(async () => { await document.fonts.ready; });
      const webkitMediaLayout = webkitPage.getByTestId("product-media-layout");
      await expect(webkitMediaLayout).toHaveAttribute("data-layout", "gallery-video");
      await webkitMediaLayout.scrollIntoViewIfNeeded();
      await expect.poll(() => webkitMediaLayout.locator("img").evaluateAll((images) =>
        images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
      ), { timeout: 45_000 }).toBe(true);
      const webkitVideo = webkitPage.locator("video");
      await expect(webkitVideo).toHaveAttribute("poster", localPosterPath);
      await expect(webkitVideo).toHaveAttribute("controls", "");
      await expect(webkitPage.getByText("Flip-through · 8 sec", { exact: true })).toHaveCount(0);
      await expect.poll(() => webkitVideo.evaluate((element) => (element as HTMLVideoElement).poster), { timeout: 15_000 }).toContain("/uploads/issue-67-browser/cover.png");
      await webkitVideo.evaluate(async (element) => {
        const posterImage = new Image();
        posterImage.src = (element as HTMLVideoElement).poster;
        await posterImage.decode();
      });
      expect(await webkitVideo.evaluate((element) => (element as HTMLVideoElement).paused && (element as HTMLVideoElement).currentTime === 0)).toBe(true);
      await webkitVideo.scrollIntoViewIfNeeded();
      await saveScreenshot(webkitPage, "video-poster-webkit-iphone");
      await webkitVideo.evaluate(async (element) => {
        await (element as HTMLVideoElement).play();
      });
      await expect.poll(() => webkitVideo.evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 20_000 }).toBeGreaterThan(0.2);
      expect(await webkitVideo.evaluate((element) => (element as HTMLVideoElement).error)).toBeNull();
      expect(await webkitVideo.evaluate((element) => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
      webkitPlaybackVerified = true;
      await saveScreenshot(webkitPage, "video-playing-webkit-iphone");
      await webkitVideo.evaluate((element) => (element as HTMLVideoElement).pause());
      expect(await webkitPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await webkitContext.close();
      expect(webkitDiagnostics.consoleErrors).toEqual([]);
      expect(webkitDiagnostics.pageErrors).toEqual([]);
      expect(webkitDiagnostics.failedResponses).toEqual([]);
      // WebKit cancels and replaces native media reads while probing and
      // starting playback. Successful time progression above is still required;
      // only GETs for this owned video server are classified, with a valid
      // byte-range header when present (the first native probe can omit it).
      const expectedVideoFetchCancellation = (item: BrowserDiagnostics["failedRequests"][number]) =>
        webkitPlaybackVerified && item.method === "GET" && item.url === videoAsset.path &&
        item.error === "Load request cancelled" && (item.range === null || /^bytes=\d+-\d*$/.test(item.range));
      expect(webkitDiagnostics.failedRequests.filter((item) => !expectedVideoFetchCancellation(item))).toEqual([]);
    }

    expect(desktopOrPixelDiagnostics.consoleErrors).toEqual([]);
    expect(desktopOrPixelDiagnostics.pageErrors).toEqual([]);
    expect(desktopOrPixelDiagnostics.failedResponses).toEqual([]);
    expect(desktopOrPixelDiagnostics.failedRequests.filter((item) => !item.error?.includes("ERR_ABORTED"))).toEqual([]);
  } finally {
    if (webkitBrowser) await webkitBrowser.close();
    videoServer?.closeAllConnections();
    if (videoServer) await new Promise<void>((resolve, reject) => videoServer!.close((error) => error ? reject(error) : resolve()));
    if (originalStore) fs.writeFileSync(store, originalStore);
    else if (fs.existsSync(store)) fs.unlinkSync(store);
    fs.mkdirSync(path.dirname(evidenceDirectory), { recursive: true });
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync(path.join("test-results", `issue-67-diagnostics-${runId}-${testInfo.project.name}.json`), JSON.stringify({ runId, diagnostics }, null, 2));
    release();
  }
});
