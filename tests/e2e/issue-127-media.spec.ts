import { expect, test, type Page, type Locator, type Request } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getSeedContentSnapshot } from "../../src/lib/local-content";
import type { ProductAsset } from "../../src/lib/types";
import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("F15-F17 fixed gallery frames, decoded detail and independent MP4 Range/inline playback", async ({ page, browser }, testInfo) => {
  const imagePayloads = observeImagePayloads(page);
  test.skip(!(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)), "Only a verified disposable loopback local-content app may be mutated.");
  test.setTimeout(120_000);
  const release = await acquireLocalContentStoreLock();
  const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const runId = process.env.UX127_MEDIA_RUN_ID ?? `local-media-${randomUUID()}`;
  const screenshots: Array<Record<string, unknown>> = [];
  let completed = false;
  async function capture(target: Page, phase: string) {
    await settleVisibleMedia(target);
    const artifact = `docs/verification/issue-127/media-${testInfo.project.name}-${phase}.png`;
    fs.mkdirSync(path.dirname(path.resolve(artifact)), { recursive: true });
    await target.screenshot({ path: path.resolve(artifact), animations: "disabled" });
    screenshots.push({ path: artifact, testedSha, runId, phase, viewport: target.viewportSize(), dpr: await target.evaluate(() => devicePixelRatio) });
  }
  const store = path.resolve("data/lamilialomi-content.local.json");
  const original = fs.existsSync(store) ? fs.readFileSync(store) : null;
  const mediaDirectory = path.resolve("public/uploads/12712712-7127-4127-8127-127127127127");
  const existed = fs.existsSync(mediaDirectory);
  if (existed) { release(); throw new Error("The exclusive media fixture directory already exists; inspect its ownership before proceeding."); }
  const pageErrors: Array<{ category: "unexpected-page-error"; path: string }> = [];
  const consoleErrors: Array<{ category: "unexpected-console-error"; path: string }> = [];
  const expectedImageFaultConsole: Array<{ category: "controlled-image-resource-error"; path: string }> = [];
  const imageFaultRequests = new WeakSet<Request>();
  let imageFaultActive = false;
  let imageFaultSource = "";
  const failedRequests: Array<{ method: string; path: string; error: string | null; expectedImageFault: boolean }> = [];
  page.on("pageerror", () => pageErrors.push({ category: "unexpected-page-error", path: locationPath(page.url(), String(testInfo.project.use.baseURL)) }));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const base = String(testInfo.project.use.baseURL);
    const safePath = locationPath(message.location().url, base);
    let matchesOwnedImage = false;
    try { matchesOwnedImage = new URL(message.location().url || base, base).searchParams.get("url") === imageFaultSource; }
    catch { /* Malformed locations remain unexpected; no raw input is retained. */ }
    if (imageFaultActive && safePath === "/_next/image" && matchesOwnedImage && /^Failed to load resource:/.test(message.text())) expectedImageFaultConsole.push({ category: "controlled-image-resource-error", path: safePath });
    else consoleErrors.push({ category: "unexpected-console-error", path: safePath });
  });
  page.on("requestfailed", (request) => failedRequests.push({ method: request.method(), path: locationPath(request.url(), String(testInfo.project.use.baseURL)), error: networkErrorCategory(request), expectedImageFault: imageFaultRequests.has(request) }));
  try {
    fs.mkdirSync(mediaDirectory, { recursive: true });
    fs.mkdirSync(path.join(mediaDirectory, "video"), { recursive: true });
    fs.mkdirSync(path.join(mediaDirectory, "cover"), { recursive: true });
    fs.mkdirSync(path.join(mediaDirectory, "gallery"), { recursive: true });
    fs.copyFileSync(path.resolve("tests/e2e/fixtures/issue-127/flower.mp4"), path.join(mediaDirectory, "video", "flower.mp4"));
    fs.writeFileSync(path.join(mediaDirectory, "cover", "cover.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="850" height="1100"><rect width="850" height="1100" fill="#c5d4bd"/><text x="100" y="500" font-size="60">Local video fixture</text></svg>');
    const snapshot = getSeedContentSnapshot();
    const product = structuredClone(snapshot.products[0]);
    product.id = "12712712-7127-4127-8127-127127127127";
    product.slug = "issue-127-video-fixture";
    product.status = "published";
    product.categoryIds = []; product.tagIds = []; product.premiumCodes = [];
    product.translations = [{ ...product.translations[0], locale: "en", title: "Local video playback fixture", shortDescription: "Independent controlled media", longDescription: "" }];
    const media = (kind: "cover" | "video", filename: string, contentType: string): ProductAsset => {
      const id = `ux127-${kind}`;
      return { id, productId: product.id, kind, bucket: "public-media", path: `/api/media/${id}`, storagePath: `/uploads/${product.id}/${kind}/${encodeURIComponent(filename)}`, storageProvider: "local", filename, contentType, sortOrder: 0, isPublic: true, title: kind === "video" ? "flower.mp4" : "Local cover" };
    };
    const gallery: ProductAsset[] = [];
    for (const [index, [width, height]] of [[2000, 2000], [1200, 1800], [1700, 2200]].entries()) {
      const filename = `page-${index}.png`;
      await sharp({ create: { width, height, channels: 3, background: ["#b5c7d6", "#d6c7b5", "#c7d6b5"][index] } }).png().toFile(path.join(mediaDirectory, "gallery", filename));
      gallery.push({ id: `ux127-page-${index}`, productId: product.id, kind: "gallery", bucket: "public-media", path: `/api/media/ux127-page-${index}`, storagePath: `/uploads/${product.id}/gallery/${encodeURIComponent(filename)}`, storageProvider: "local", filename, contentType: "image/png", sortOrder: index + 1, isPublic: true, title: `Controlled page ${index + 1}` });
    }
    product.assets = [media("cover", "cover.svg", "image/svg+xml"), media("video", "flower.mp4", "video/mp4"), ...gallery];
    product.coverAssetId = "ux127-cover"; product.videoAssetId = "ux127-video";
    snapshot.products.push(product);
    fs.mkdirSync(path.dirname(store), { recursive: true }); fs.writeFileSync(store, JSON.stringify(snapshot));
    await page.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
    const range = await page.request.get("/api/media/ux127-video", { headers: { Range: "bytes=0-127" } });
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
      const postSeekFrame = await seekAndPaint(video);
      await testInfo.attach(`${cache}-post-seek-frame`, { body: JSON.stringify({ testedSha, runId, ...postSeekFrame }), contentType: "application/json" });
      expect(await video.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
      await capture(page, `${cache}-video`);
    }
    const opener = page.getByRole("button", { name: /Open image 1/ });
    await opener.scrollIntoViewIfNeeded();
    const thumbnail = opener.locator("img");
    const thumbnailPixels = await selectedPixels(thumbnail, page, imagePayloads);
    const thumbnailWidth = thumbnailPixels.width;
    imageFaultSource = thumbnailPixels.sourcePath;
    expect(thumbnailWidth).toBeGreaterThan(0);
    let releaseDetail!: () => void;
    const detailGate = new Promise<void>((resolve) => { releaseDetail = resolve; });
    let imageFaultInjected = false;
    await page.route("**/_next/image**", async (route) => {
      const source = new URL(route.request().url());
      const width = Number(source.searchParams.get("w"));
      if (width > thumbnailWidth) await detailGate;
      if (!imageFaultInjected && width > thumbnailWidth && source.searchParams.get("url") === imageFaultSource) {
        imageFaultInjected = true; imageFaultActive = true;
        imageFaultRequests.add(route.request()); await route.abort("failed"); return;
      }
      await route.continue();
    });
    try {
      await capture(page, "before-gallery");
      await opener.click();
      const dialog = page.getByRole("dialog", { name: "Image preview" });
      const display = dialog.locator("[data-gallery-display]").first();
      await expect(display).toBeVisible();
      const needsLargerSource = (await dialog.getByTestId("product-gallery-preview-frame").boundingBox())!.width * await page.evaluate(() => devicePixelRatio) > thumbnailWidth;
      if (needsLargerSource) await expect(dialog.getByRole("status")).toContainText("Loading larger preview");
      await capture(page, "pending-gallery");
      releaseDetail();
      if (needsLargerSource) {
        await expect(dialog.getByRole("alert")).toContainText("larger preview could not be loaded");
        expect(imageFaultInjected).toBe(true);
        await capture(page, "controlled-gallery-error");
        imageFaultActive = false;
        await dialog.getByRole("button", { name: "Retry image", exact: true }).click();
      }
      await expect(dialog.getByRole("status")).toHaveCount(0);
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      const detailPixels = await selectedPixels(display, page, imagePayloads);
      const detailWidth = detailPixels.width;
      await testInfo.attach("selected-gallery-bytes", { body: JSON.stringify({ testedSha, runId, thumbnail: thumbnailPixels, detail: detailPixels }), contentType: "application/json" });
      const frame = await dialog.getByTestId("product-gallery-preview-frame").boundingBox();
      const dpr = await page.evaluate(() => devicePixelRatio);
      expect(detailWidth).toBeGreaterThanOrEqual(Math.min(2000, Math.floor(frame!.width * dpr)));
      await capture(page, "after-gallery");
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
    for (const dpr of [2, 3]) {
    const tallContext = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL), viewport: { width: 1024, height: 1366 }, deviceScaleFactor: dpr, ignoreHTTPSErrors: true });
    try {
      await tallContext.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
      const tall = await tallContext.newPage();
      const tallImagePayloads = observeImagePayloads(tall);
      const tallErrors: Array<{ category: "unexpected-page-error"; path: string }> = [];
      tall.on("pageerror", () => tallErrors.push({ category: "unexpected-page-error", path: locationPath(tall.url(), String(testInfo.project.use.baseURL)) }));
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
        const selectedSource = await selectedPixels(selected, tall, tallImagePayloads);
        expect(selectedSource.width).toBeGreaterThanOrEqual(Math.min(2000, Math.floor(frame!.width * dpr)));
        await capture(tall, `tall-dpr${dpr}-gallery`);
        await testInfo.attach(`optimized-tall-DPR${dpr}-selection`, { body: JSON.stringify({ testedSha, runId, viewport: { width: 1024, height: 1366 }, dpr, frameWidth: frame!.width,
          originalWidth: 2000, selectedSource, frameHeightBeforeDecode: before!.height, frameHeightAfterDecode: after!.height, errors: tallErrors }), contentType: "application/json" });
        expect(tallErrors).toEqual([]);
      } finally { releaseThumbnails(); }
    } finally { await tallContext.close(); }
    }
    await testInfo.attach("local-video-first-frame-samples", { body: JSON.stringify({ testedSha, runId, project: testInfo.project.name, samples, pageErrors, consoleErrors, expectedImageFaultConsole, failedRequests }), contentType: "application/json" });
    expect(pageErrors).toEqual([]); expect(consoleErrors).toEqual([]);
    for (const request of failedRequests) {
      expect(request.expectedImageFault).toBe(true); expect(request.method).toBe("GET"); expect(request.path).toBe("/_next/image");
      expect(["net::ERR_FAILED", "Load failed", "Unknown error", "Failed"]).toContain(request.error);
    }
    expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(testedSha);
    completed = true;
  } finally {
    let cleanupVerified = false;
    try {
    if (original) fs.writeFileSync(store, original); else if (fs.existsSync(store)) fs.unlinkSync(store);
    // The exact exclusive path was checked absent above and created by this test.
    fs.rmSync(mediaDirectory, { recursive: true, force: true });
      cleanupVerified = true;
    } finally {
      release();
    const sourceMatchesHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() === testedSha && !execFileSync("git", ["status", "--porcelain", "--", "src", "tests", "scripts", "public", "messages", "package.json", "package-lock.json", "next.config.*"], { encoding: "utf8" }).trim();
    const provenance = { testedSha, runId, cleanupVerified, status: completed && cleanupVerified ? sourceMatchesHead ? "PASS" : "WORKING_TREE" : "FAIL", sourceMatchesHead, project: testInfo.project.name, tool: "Playwright", screenshots };
    const body = JSON.stringify(provenance, null, 2);
    fs.writeFileSync(testInfo.outputPath("media-provenance.json"), body);
    await testInfo.attach("media-provenance", { body, contentType: "application/json" });
    }
  }
});


async function settleVisibleMedia(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const visible = Array.from(document.images).filter((image) => {
      const box = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth && style.visibility !== "hidden" && style.display !== "none";
    });
    await Promise.all(visible.map((image) => image.decode()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function seekAndPaint(locator: Locator) {
  return locator.evaluate(async (element) => {
    const video = element as HTMLVideoElement;
    video.pause();
    const target = Math.min(1, video.duration / 2);
    let frameId: number | undefined;
    let timeoutId = 0;
    let onSeeked!: () => void;
    const seeked = new Promise<void>((resolve) => { onSeeked = resolve; video.addEventListener("seeked", onSeeked, { once: true }); });
    const requestFrame = video.requestVideoFrameCallback;
    const hasFrameCallback = typeof requestFrame === "function";
    const painted = hasFrameCallback ? new Promise<void>((resolve) => {
      const frame = (_time: number, metadata: VideoFrameCallbackMetadata) => {
        if (Math.abs(metadata.mediaTime - target) < 0.12) resolve();
        else frameId = requestFrame.call(video, frame);
      };
      frameId = requestFrame.call(video, frame);
    }) : seeked.then(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const timeout = new Promise<never>((_, reject) => { timeoutId = window.setTimeout(() => reject(new Error("A decoded post-seek frame did not arrive.")), 20000); });
    try {
      video.currentTime = target;
      await Promise.race([Promise.all([seeked, painted]), timeout]);
      if (video.readyState < 2) throw new Error("The post-seek video frame is not decoded.");
      return { method: hasFrameCallback ? "requestVideoFrameCallback" : "seeked-readyState-two-animation-frames", targetTime: target, observedTime: video.currentTime, readyState: video.readyState };
    } finally {
      window.clearTimeout(timeoutId); video.removeEventListener("seeked", onSeeked);
      if (frameId !== undefined) video.cancelVideoFrameCallback?.(frameId);
    }
  });
}

type ObservedImagePayload = { body: Promise<Buffer | null>; status: number };

function observeImagePayloads(page: Page) {
  // Full URLs, redirect aliases and byte buffers exist only inside this test's memory.
  const payloads = new Map<string, ObservedImagePayload>();
  page.on("response", (response) => {
    const request = response.request();
    if (request.resourceType() !== "image" || !response.ok()) return;
    const payload = { body: response.body().catch(() => null), status: response.status() };
    for (let alias: Request | null = request; alias; alias = alias.redirectedFrom()) payloads.set(alias.url(), payload);
  });
  return payloads;
}

async function selectedPixels(locator: Locator, page: Page, payloads: Map<string, ObservedImagePayload>) {
  const source = await locator.evaluate((element) => {
    const image = element as HTMLImageElement;
    return { currentSrc: image.currentSrc, reportedNaturalWidth: image.naturalWidth };
  });
  const selectedUrl = new URL(source.currentSrc);
  expect(selectedUrl.origin).toBe(new URL(page.url()).origin);
  const payload = payloads.get(source.currentSrc);
  if (!payload) throw new Error("The selected browser image response was not observed.");
  const bytes = await payload.body;
  if (!bytes) throw new Error("The observed browser image response body is unavailable.");
  const decoded = await sharp(bytes).metadata().catch(() => { throw new Error("The observed browser image bytes could not be decoded."); });
  expect(decoded.width).toBeGreaterThan(0);
  const numericParameter = (name: string, allowed: readonly number[]) => {
    const value = selectedUrl.searchParams.get(name);
    return value !== null && /^\d+$/.test(value) && allowed.includes(Number(value)) ? Number(value) : null;
  };
  const candidatePath = locationPath(selectedUrl.searchParams.get("url") ?? source.currentSrc, page.url());
  const sourcePath = /^\/uploads\/issue-127-video\/page-[0-2]\.png$/.test(candidatePath) ? candidatePath : "[unexpected-source-path]";
  expect(sourcePath).not.toBe("[unexpected-source-path]");
  // Decode the actual negotiated browser response, never a default-Accept replay.
  // Evidence contains only structured paths and discrete public numeric options.
  return {
    pathname: selectedUrl.pathname === "/_next/image" ? "/_next/image" : sourcePath,
    sourcePath,
    optimizerWidth: numericParameter("w", [32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840]),
    optimizerQuality: numericParameter("q", [75]),
    currentSrcSha256: createHash("sha256").update(source.currentSrc).digest("hex"),
    payloadSource: "observed-browser-response-body", payloadStatus: payload.status,
    payloadSha256: createHash("sha256").update(bytes).digest("hex"),
    reportedNaturalWidth: source.reportedNaturalWidth,
    width: decoded.width!, height: decoded.height!, bytes: bytes.length, format: decoded.format,
  };
}

function locationPath(value: string, base: string) {
  try {
    const location = new URL(value || base, base);
    return location.protocol === "http:" || location.protocol === "https:" ? location.pathname : "[non-http-location]";
  } catch { return "[invalid-location]"; }
}

function networkErrorCategory(request: Request) {
  const value = request.failure()?.errorText;
  const known = ["net::ERR_FAILED", "Load failed", "Unknown error", "Failed", "net::ERR_ABORTED", "Load request cancelled", "NS_BINDING_ABORTED"];
  return value && known.includes(value) ? value : "unknown-network-error";
}
