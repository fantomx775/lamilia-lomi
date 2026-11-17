import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getSeedContentSnapshot } from "../../src/lib/local-content";
import type { ProductAsset } from "../../src/lib/types";
import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test("F15-F17 fixed gallery frames, decoded detail and independent MP4 Range/inline playback", async ({ page, browser }, testInfo) => {
  test.skip(!(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)), "Only a verified disposable loopback local-content app may be mutated.");
  test.setTimeout(120_000);
  const release = await acquireLocalContentStoreLock();
  const store = path.resolve("data/lamilialomi-content.local.json");
  const original = fs.existsSync(store) ? fs.readFileSync(store) : null;
  const mediaDirectory = path.resolve("public/uploads/issue-127-video");
  const existed = fs.existsSync(mediaDirectory);
  if (existed) { release(); throw new Error("The exclusive video fixture directory already exists; inspect its ownership before proceeding."); }
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: Array<{ method: string; url: string; error: string | null }> = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("requestfailed", (request) => failedRequests.push({ method: request.method(), url: new URL(request.url()).origin + new URL(request.url()).pathname, error: request.failure()?.errorText ?? null }));
  try {
    fs.mkdirSync(mediaDirectory, { recursive: true });
    fs.copyFileSync(path.resolve("tests/e2e/fixtures/issue-127/flower.mp4"), path.join(mediaDirectory, "flower.mp4"));
    fs.writeFileSync(path.join(mediaDirectory, "cover.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="850" height="1100"><rect width="850" height="1100" fill="#c5d4bd"/><text x="100" y="500" font-size="60">Local video fixture</text></svg>');
    const snapshot = getSeedContentSnapshot();
    const product = structuredClone(snapshot.products[0]);
    product.id = "12712712-7127-4127-8127-127127127127";
    product.slug = "issue-127-video-fixture";
    product.status = "published";
    product.categoryIds = []; product.tagIds = []; product.premiumCodes = [];
    product.translations = [{ ...product.translations[0], locale: "en", title: "Local video playback fixture", shortDescription: "Independent controlled media", longDescription: "" }];
    const media = (kind: "cover" | "video", filename: string, contentType: string): ProductAsset => ({ id: `ux127-${kind}`, productId: product.id, kind, bucket: "public-media", path: `/uploads/issue-127-video/${filename}`, filename, contentType, sortOrder: 0, isPublic: true, title: kind === "video" ? "flower.mp4" : "Local cover" });
    const gallery: ProductAsset[] = [];
    for (const [index, [width, height]] of [[2000, 2000], [1200, 1800], [1700, 2200]].entries()) {
      const filename = `page-${index}.png`;
      await sharp({ create: { width, height, channels: 3, background: ["#b5c7d6", "#d6c7b5", "#c7d6b5"][index] } }).png().toFile(path.join(mediaDirectory, filename));
      gallery.push({ id: `ux127-page-${index}`, productId: product.id, kind: "gallery", bucket: "public-media", path: `/uploads/issue-127-video/${filename}`, filename, contentType: "image/png", sortOrder: index + 1, isPublic: true, title: `Controlled page ${index + 1}` });
    }
    product.assets = [media("cover", "cover.svg", "image/svg+xml"), media("video", "flower.mp4", "video/mp4"), ...gallery];
    product.coverAssetId = "ux127-cover"; product.videoAssetId = "ux127-video";
    snapshot.products.push(product);
    fs.mkdirSync(path.dirname(store), { recursive: true }); fs.writeFileSync(store, JSON.stringify(snapshot));
    await page.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
    const range = await page.request.get("/uploads/issue-127-video/flower.mp4", { headers: { Range: "bytes=0-127" } });
    expect(range.status()).toBe(206); expect(range.headers()["content-range"]).toMatch(/^bytes 0-127\//);
    expect((await range.body()).byteLength).toBe(128);
    const samples: Array<{ cache: string; clickToFrameMs: number }> = [];
    for (const cache of ["cold", "warm"]) {
      await page.goto("/en/products/issue-127-video-fixture");
      const video = page.locator("video[data-flipthrough]");
      await video.scrollIntoViewIfNeeded();
      await expect(video).toHaveAttribute("playsinline", "");
      await expect(video).toHaveAttribute("controls", "");
      await expect(page.getByText("flower.mp4", { exact: true })).toHaveCount(0);
      await video.evaluate((element) => {
        const player = element as HTMLVideoElement;
        const state = window as unknown as { ux127VideoTiming: { started: number; frame: number | null } };
        state.ux127VideoTiming = { started: 0, frame: null };
        document.querySelector('[data-testid="product-video-play"]')!.addEventListener("click", () => {
          state.ux127VideoTiming.started = performance.now();
          const requestFrame = player.requestVideoFrameCallback;
          if (typeof requestFrame === "function") requestFrame.call(player, () => { state.ux127VideoTiming.frame = performance.now(); });
          else player.addEventListener("timeupdate", () => { state.ux127VideoTiming.frame ??= performance.now(); }, { once: true });
        }, { once: true, capture: true });
      });
      await page.getByRole("button", { name: /Play Inside the book/ }).click();
      await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(0.2);
      await expect.poll(() => page.evaluate(() => (window as unknown as { ux127VideoTiming: { frame: number | null } }).ux127VideoTiming.frame)).not.toBeNull();
      const timing = await page.evaluate(() => (window as unknown as { ux127VideoTiming: { started: number; frame: number } }).ux127VideoTiming);
      expect(timing.started).toBeGreaterThan(0); expect(timing.frame).toBeGreaterThanOrEqual(timing.started);
      samples.push({ cache, clickToFrameMs: timing.frame - timing.started });
      await video.evaluate(async (element) => {
        const player = element as HTMLVideoElement; player.pause();
        await new Promise<void>((resolve) => { player.addEventListener("seeked", () => resolve(), { once: true }); player.currentTime = Math.min(1, player.duration / 2); });
      });
      expect(await video.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
      fs.mkdirSync(path.resolve("docs/verification/issue-127"), { recursive: true });
      await page.screenshot({ path: path.resolve(`docs/verification/issue-127/media-${testInfo.project.name}-${cache}-video.png`), animations: "disabled" });
    }
    const opener = page.getByRole("button", { name: /Open image 1/ });
    await opener.scrollIntoViewIfNeeded();
    const thumbnail = opener.locator("img");
    const thumbnailWidth = await thumbnail.evaluate((element) => (element as HTMLImageElement).naturalWidth);
    expect(thumbnailWidth).toBeGreaterThan(0);
    let releaseDetail!: () => void;
    const detailGate = new Promise<void>((resolve) => { releaseDetail = resolve; });
    await page.route("**/_next/image**", async (route) => {
      const width = Number(new URL(route.request().url()).searchParams.get("w"));
      if (width > thumbnailWidth) await detailGate;
      await route.continue();
    });
    try {
      await page.screenshot({ path: path.resolve(`docs/verification/issue-127/media-${testInfo.project.name}-before-gallery.png`), animations: "disabled" });
      await opener.click();
      const dialog = page.getByRole("dialog", { name: "Image preview" });
      const display = dialog.locator("[data-gallery-display]").first();
      await expect(display).toBeVisible();
      const needsLargerSource = (await dialog.getByTestId("product-gallery-preview-frame").boundingBox())!.width * await page.evaluate(() => devicePixelRatio) > thumbnailWidth;
      if (needsLargerSource) await expect(dialog.getByRole("status")).toContainText("Loading larger preview");
      await page.screenshot({ path: path.resolve(`docs/verification/issue-127/media-${testInfo.project.name}-pending-gallery.png`), animations: "disabled" });
      releaseDetail();
      await expect(dialog.getByRole("status")).toHaveCount(0);
      const detailWidth = await display.evaluate((element) => (element as HTMLImageElement).naturalWidth);
      const frame = await dialog.getByTestId("product-gallery-preview-frame").boundingBox();
      const dpr = await page.evaluate(() => devicePixelRatio);
      expect(detailWidth).toBeGreaterThanOrEqual(Math.min(2000, Math.floor(frame!.width * dpr)));
      await page.screenshot({ path: path.resolve(`docs/verification/issue-127/media-${testInfo.project.name}-after-gallery.png`), animations: "disabled" });
      await dialog.getByRole("button", { name: "Next image" }).click();
      await expect(dialog.getByText("2 of 3")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(opener).toBeFocused();
    } finally { releaseDetail(); await page.unroute("**/_next/image**"); }
    for (const button of await page.getByRole("button", { name: /^Open image/ }).all()) {
      const frame = await button.locator("span").first().boundingBox();
      expect(frame!.width / frame!.height).toBeCloseTo(8.5 / 11, 2);
    }
    // The original 640px sizes claim underfetched on this tall DPR3 viewport:
    // actual preview width is768CSSpx, so1920px is below min(2000,768*3).
    // This separate local-demo campaign uses actual Next optimization; the real
    // Supabase fallback campaign intentionally keeps its auth path unoptimized.
    const tallContext = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL), viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 3, ignoreHTTPSErrors: true });
    try {
      await tallContext.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
      const tall = await tallContext.newPage();
      const tallErrors: string[] = [];
      tall.on("pageerror", (error) => tallErrors.push(error.message));
      let releaseThumbnails!: () => void;
      const thumbnailGate = new Promise<void>((resolve) => { releaseThumbnails = resolve; });
      await tall.route("**/_next/image**", async (route) => { await thumbnailGate; await route.continue(); });
      try {
        await tall.goto("/en/products/issue-127-video-fixture", { waitUntil: "domcontentloaded" });
        const first = tall.getByRole("button", { name: "Open image 1", exact: true });
        await first.scrollIntoViewIfNeeded();
        const before = await first.locator("span").first().boundingBox();
        releaseThumbnails();
        await expect.poll(() => first.locator("img").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        const after = await first.locator("span").first().boundingBox();
        expect(after!.height).toBeCloseTo(before!.height, 1);
        await first.click();
        const preview = tall.getByRole("dialog", { name: "Image preview" });
        await expect(preview.getByRole("status")).toHaveCount(0);
        const frame = await preview.getByTestId("product-gallery-preview-frame").boundingBox();
        expect(frame!.width).toBeGreaterThan(640);
        const selected = preview.locator("[data-gallery-display]").first();
        await expect.poll(() => selected.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThanOrEqual(Math.min(2000, Math.floor(frame!.width * 3)));
        await tall.screenshot({ path: path.resolve(`docs/verification/issue-127/media-${testInfo.project.name}-tall-dpr3-gallery.png`), animations: "disabled" });
        await testInfo.attach("optimized-tall-DPR3-selection", { body: JSON.stringify({ viewport: { width: 1024, height: 1366 }, dpr: 3, frameWidth: frame!.width,
          originalWidth: 2000, selectedWidth: await selected.evaluate((element) => (element as HTMLImageElement).naturalWidth), frameHeightBeforeDecode: before!.height, frameHeightAfterDecode: after!.height, errors: tallErrors }), contentType: "application/json" });
        expect(tallErrors).toEqual([]);
      } finally { releaseThumbnails(); }
    } finally { await tallContext.close(); }
    await testInfo.attach("local-video-first-frame-samples", { body: JSON.stringify({ project: testInfo.project.name, samples, pageErrors, consoleErrors, failedRequests }), contentType: "application/json" });
    expect(pageErrors).toEqual([]); expect(consoleErrors).toEqual([]); expect(failedRequests).toEqual([]);
  } finally {
    if (original) fs.writeFileSync(store, original); else if (fs.existsSync(store)) fs.unlinkSync(store);
    // The exact exclusive path was checked absent above and created by this test.
    fs.rmSync(mediaDirectory, { recursive: true, force: true }); release();
  }
});
