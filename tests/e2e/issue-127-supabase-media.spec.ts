import { expect, test, type Request, type Page, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { communityFixtures, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";
import { observeOwnedMediaCdp } from "./helpers/owned-media-diagnostics";
import { NextCancellationObserver } from "./helpers/next-navigation-cancellations";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

/** Real Storage/Auth/DB transport. Supabase fallback images intentionally stay
 * unoptimized; optimized srcset selection is a separate local-demo campaign. */
test("F15-F17 real isolated product media has Range, decoded previews and recoverable pending playback", async ({ page }, testInfo) => {
  test.skip(process.env.RUN_ISSUE_127_PRODUCT_MEDIA_E2E !== "1", "Requires guarded exclusive local Supabase and its owned HTTPS gateway.");
  test.setTimeout(180_000);
  const fixtures = await communityFixtures(testInfo); // Pins the existing strict local Docker/API/DB identity before writes.
  const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const runId = process.env.UX127_MEDIA_RUN_ID ?? `supabase-media-${randomUUID()}`;
  const nextObserver = new NextCancellationObserver({ testedSha, runId, origin: COMMUNITY_TEST_ORIGIN });
  await nextObserver.observe(page);
  let nextSnapshot: Awaited<ReturnType<NextCancellationObserver["finish"]>> | null = null;
  let nextFinalizationFailed = false;
  const screenshots: Array<Record<string, unknown>> = [];
  let completed = false;
  let phase = "fixture-setup";
  async function capture(target: Page, screenshotPhase: string) {
    phase = `capture:${screenshotPhase}`;
    await settleVisibleMedia(target);
    const artifact = `docs/verification/issue-127/supabase-media-${testInfo.project.name}-${screenshotPhase}.png`;
    await mkdir(path.dirname(path.resolve(artifact)), { recursive: true });
    await target.screenshot({ path: path.resolve(artifact), animations: "disabled" });
    screenshots.push({ path: artifact, testedSha, runId, phase: screenshotPhase, viewport: target.viewportSize(), dpr: await target.evaluate(() => devicePixelRatio) });
  }
  const objects: Array<{ bucket: string; path: string }> = [];
  const consoleErrors: Array<{ category: "unexpected-console-error"; path: string }> = [];
  const pageErrors: Array<{ category: "unexpected-page-error"; path: string }> = [];
  type RequestMetadata = { requestId: number; method: string; path: string; resource: string; phaseAtStart: string; navigation: boolean; rsc: boolean; prefetch: boolean;
    urlSha256: string; startedAtEpochMs: number; range: string | null; responseStatus: number | null; contentRange: string | null; identitySample?: Record<string, unknown>; allHeadersRange?: string | null };
  type FailedRequest = RequestMetadata & { error: string | null; phaseAtFailure: string; failedAtEpochMs: number; expectedPause: boolean; expectedFault: boolean;
    redirectChain: RequestMetadata[]; pauseGateRequest: boolean; pauseRequestedAtFailure: boolean; validatedNextPrefetchId?: string;
    pauseWitness?: { atEpochMs: number; sourcePath: string; trusted: true; paused: true } };
  const failed: FailedRequest[] = [];
  const mediaRequests: RequestMetadata[] = [];
  const successfulMedia: Array<Record<string, unknown>> = [];
  const cdpMedia: Array<Record<string, unknown>> = [];
  const diagnosticWork: Promise<void>[] = [];
  let stopCdp: (() => Promise<void>) | null = null;
  let cdpStatus = "NOT_APPLICABLE";
  const inFlight = new Map<Request, RequestMetadata>();
  const requestIdentity = new WeakMap<Request, RequestMetadata>();
  const nativeTimeline: Array<Record<string, unknown>> = [];
  const observerErrors: Array<{ category: "invalid-native-observation" }> = [];
  const lifecycleActions: Array<{ action: string; phase: string; atEpochMs: number }> = [];
  const networkDiagnostics: string[] = [];
  let requestSequence = 0;
  function requestMetadata(request: Request): RequestMetadata {
    const existing = requestIdentity.get(request);
    if (existing) return existing;
    const headers = request.headers();
    const metadata: RequestMetadata = { requestId: ++requestSequence, method: request.method(), path: locationPath(request.url(), COMMUNITY_TEST_ORIGIN),
      resource: request.resourceType(), phaseAtStart: phase, navigation: request.isNavigationRequest(),
      rsc: headers.rsc === "1", prefetch: headers["next-router-prefetch"] === "1" || Boolean(headers["next-router-segment-prefetch"]),
      urlSha256: createHash("sha256").update(request.url()).digest("hex"), startedAtEpochMs: Date.now(),
      range: headers.range ? /^bytes=\d{1,16}-\d{0,16}$/.test(headers.range) ? headers.range : "unknown-range" : null,
      responseStatus: null as number | null, contentRange: null as string | null };
    requestIdentity.set(request, metadata);
    if (request.resourceType() === "media") {
      mediaRequests.push(metadata);
      diagnosticWork.push((async () => {
        const headers = await request.allHeaders();
        metadata.allHeadersRange = headers.range ? /^bytes=\d{1,16}-\d{0,16}$/.test(headers.range) ? headers.range : "unknown-range" : null;
        // This is an explicitly timed sample, not inferred proof that no generation changed.
        metadata.identitySample = projectIdentitySample(await request.frame().evaluate(() => {
          const read = (window as unknown as { __ux127ReadMediaIdentity?: () => Record<string, unknown> }).__ux127ReadMediaIdentity;
          return read ? read() : { status: "identity-not-installed", sampledAtEpochMs: Date.now() };
        }));
      })().catch(() => { metadata.identitySample = { status: "identity-sample-unavailable" }; }));
    }
    return metadata;
  }
  async function drainBeforeReset(reason: string) {
    phase = `drain:${reason}`;
    lifecycleActions.push({ action: "drain-start", phase, atEpochMs: Date.now() });
    // Wait for genuine document/prefetch/script/image work; do not abort it or
    // count this wait as part of click-to-frame latency. Media is observed separately.
    await expect.poll(() => [...inFlight.values()].filter((request) => request.resource !== "media").length,
      { timeout: 20_000, message: "Started non-media document requests must settle before a test-driven reset." }).toBe(0);
    lifecycleActions.push({ action: "drain-complete", phase, atEpochMs: Date.now() });
  }
  async function resetDocument(url: string, label: string) {
    await drainBeforeReset(label);
    phase = label;
    lifecycleActions.push({ action: "goto-requested", phase, atEpochMs: Date.now() });
    await page.goto(url);
    lifecycleActions.push({ action: "goto-committed", phase, atEpochMs: Date.now() });
  }
  async function finalizeNextRequests() {
    if (nextSnapshot || nextFinalizationFailed) return;
    phase = "network:typed-finalization";
    try { nextSnapshot = await nextObserver.finish(); }
    catch { nextFinalizationFailed = true; return; }
    const byHash = new Map<string, string[]>();
    for (const outcome of nextSnapshot.expectedNextCancellations) {
      if (outcome.kind !== "next-prefetch" || typeof outcome.requestUrl !== "string" || typeof outcome.id !== "string") continue;
      const hash = createHash("sha256").update(outcome.requestUrl).digest("hex");
      byHash.set(hash, [...(byHash.get(hash) ?? []), outcome.id]);
    }
    for (const request of failed) {
      if (request.error === "net::ERR_ABORTED" && request.method === "GET" && request.resource === "fetch" && request.rsc && request.prefetch) {
        request.validatedNextPrefetchId = byHash.get(request.urlSha256)?.shift();
      }
    }
    if ([...byHash.values()].some((outcomes) => outcomes.length)) nextFinalizationFailed = true;
    for (const request of failed) {
      if (!request.pauseGateRequest || !request.pauseRequestedAtFailure || request.method !== "GET" || request.path !== ownedVideoPath || request.resource !== "media") continue;
      const witness = nativeTimeline.find((event) => event.event === "pause" && event.trusted === true && event.paused === true && event.connected === true &&
        (event.sourcePath === ownedVideoPath || event.sourcePath === ownedStoragePath) && typeof event.atEpochMs === "number" &&
        event.atEpochMs >= request.startedAtEpochMs && event.atEpochMs < request.failedAtEpochMs);
      if (witness) {
        request.expectedPause = true;
        request.pauseWitness = { atEpochMs: witness.atEpochMs as number, sourcePath: witness.sourcePath as string, trusted: true, paused: true };
      }
    }
  }
  async function networkSnapshot(checkpoint: string) {
    // Paths omit all query/fragment data, including signed Storage tokens. Only
    // two routing-header booleans are retained; never cookies/headers/bodies.
    await Promise.all(diagnosticWork);
    const body = JSON.stringify({ testedSha, runId, checkpoint, phase, consoleErrors, pageErrors, failed, mediaRequests, successfulMedia, cdpStatus, cdpMedia, nativeTimeline, lifecycleActions, observerErrors,
      ownedMedia: { apiPath: ownedVideoPath, storagePath: ownedStoragePath }, nextFinalizationFailed,
      expectedNextCancellations: nextSnapshot?.expectedNextCancellations.filter((outcome) => outcome.kind === "next-prefetch") ?? [],
      closedPrefetches: nextSnapshot?.closedPrefetches ?? [], pending: [...inFlight.values()] }, null, 2);
    const filename = `supabase-media-network-${checkpoint}.json`;
    await writeFile(testInfo.outputPath(filename), body);
    networkDiagnostics.push(filename);
    await testInfo.attach(`supabase-media-network-${checkpoint}`, { body, contentType: "application/json" });
  }
  const delayedRequests = new WeakSet<Request>();
  const faultRequests = new WeakSet<Request>();
  const expectedFaultConsole: Array<{ category: "controlled-media-resource-error"; path: string }> = [];
  let faultActive = false;
  let ownedVideoPath = "";
  let ownedStoragePath = "";
  let pauseConfirmed = false;
  let waitEvents = { waiting: 0, stalled: 0 };
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const consolePath = locationPath(message.location().url, COMMUNITY_TEST_ORIGIN);
    if (faultActive && consolePath === ownedVideoPath && /^Failed to load resource:/.test(message.text())) expectedFaultConsole.push({ category: "controlled-media-resource-error", path: consolePath });
    else consoleErrors.push({ category: "unexpected-console-error", path: consolePath });
  });
  page.on("pageerror", () => pageErrors.push({ category: "unexpected-page-error", path: locationPath(page.url(), COMMUNITY_TEST_ORIGIN) }));
  page.on("request", (request) => inFlight.set(request, requestMetadata(request)));
  page.on("response", (response) => {
    const metadata = requestMetadata(response.request());
    metadata.responseStatus = response.status();
    const contentRange = response.headers()["content-range"];
    metadata.contentRange = contentRange ? /^bytes \d{1,16}-\d{1,16}\/(?:\d{1,16}|\*)$/.test(contentRange) ? contentRange : "unknown-content-range" : null;
  });
  page.on("requestfinished", (request) => {
    const metadata = requestMetadata(request);
    if (metadata.resource === "media") {
      const terminal = { ...metadata, terminal: "finished", finishedAtEpochMs: Date.now(), redirectChain: [] as RequestMetadata[] };
      for (let previous = request.redirectedFrom(); previous; previous = previous.redirectedFrom()) terminal.redirectChain.unshift(requestMetadata(previous));
      diagnosticWork.push((async () => {
        const sizes = await request.sizes();
        successfulMedia.push({ ...terminal, ...requestMetadata(request), responseBodyBytes: sizes.responseBodySize });
      })().catch(() => { successfulMedia.push({ ...terminal, sizesStatus: "unavailable" }); }));
    }
    inFlight.delete(request);
  });
  page.on("requestfailed", (request) => {
    const redirectChain: RequestMetadata[] = [];
    for (let previous = request.redirectedFrom(); previous; previous = previous.redirectedFrom()) redirectChain.unshift({ ...requestMetadata(previous) });
    failed.push({ ...(inFlight.get(request) ?? requestMetadata(request)),
      error: networkErrorCategory(request), phaseAtFailure: phase, failedAtEpochMs: Date.now(), redirectChain,
      expectedPause: false, pauseGateRequest: delayedRequests.has(request), pauseRequestedAtFailure: pauseConfirmed, expectedFault: faultRequests.has(request) });
    inFlight.delete(request);
  });
  try {
    const book = await fixtures.product("Controlled product media preview");
    const rows: Array<Record<string, unknown>> = [];
    async function asset(kind: "cover" | "gallery" | "video", bytes: Buffer, filename: string, index = 0) {
      const id = randomUUID();
      const bucket = kind === "video" ? "public-videos" : "public-media";
      const storagePath = `products/${book.id}/${kind}/${id}-${filename}`;
      const contentType = kind === "video" ? "video/mp4" : "image/png";
      expect(fixtures.products).toContain(book.id);
      expect((await fixtures.service.storage.from(bucket).upload(storagePath, bytes, { contentType, upsert: false })).error).toBeNull();
      objects.push({ bucket, path: storagePath });
      const stored = await fixtures.service.storage.from(bucket).download(storagePath);
      expect(stored.error).toBeNull(); expect(Buffer.from(await stored.data!.arrayBuffer())).toEqual(bytes);
      rows.push({ id, product_id: book.id, kind, bucket, path: storagePath, filename, content_type: contentType,
        size_bytes: bytes.length, title: filename, locale: "en", sort_order: index, is_public: true, is_active: true, storage_provider: "supabase" });
      return id;
    }
    const cover = await asset("cover", await sharp({ create: { width: 850, height: 1100, channels: 3, background: "#c4d1ba" } }).png().toBuffer(), "fixture-cover.png");
    for (const [index, [width, height]] of [[2000, 2000], [1200, 1800], [1700, 2200]].entries()) {
      await asset("gallery", await sharp({ create: { width, height, channels: 3, background: ["#a5b7c6", "#c6b7a5", "#b7c6a5"][index] } }).png().toBuffer(), `fixture-page-${index}.png`, index + 1);
    }
    const video = await asset("video", await readFile(path.resolve("tests/e2e/fixtures/issue-127/flower.mp4")), "fixture-film.mp4");
    expect((await fixtures.service.from("product_assets").insert(rows)).error).toBeNull();
    expect((await fixtures.service.from("products").update({ cover_asset_id: cover, video_asset_id: video }).eq("id", book.id)).error).toBeNull();
    expect((await fixtures.service.from("product_assets").select("id").eq("product_id", book.id)).data).toHaveLength(5);
    await page.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
    const videoPath = `/api/media/${video}`;
    ownedVideoPath = videoPath;
    ownedStoragePath = `/storage/v1/object/sign/public-videos/${objects.find((object) => object.bucket === "public-videos")!.path}`;
    if (testInfo.project.use.browserName !== "webkit" && page.context().browser()?.browserType().name() === "chromium") {
      stopCdp = await observeOwnedMediaCdp(page, [ownedVideoPath, ownedStoragePath], (value) => cdpMedia.push({ ...value, phaseAtReceipt: phase, receivedAtEpochMs: Date.now() }));
      cdpStatus = "OBSERVING";
    }
    await observeNativeMedia(page, [ownedVideoPath, ownedStoragePath], (observation) => {
      if (!observation) observerErrors.push({ category: "invalid-native-observation" });
      else nativeTimeline.push({ ...observation, phaseAtReceipt: phase, receivedAtEpochMs: Date.now() });
    });
    phase = "range-probe";
    const range = await page.request.get(`${COMMUNITY_TEST_ORIGIN}${videoPath}`, { headers: { Range: "bytes=0-127" } });
    expect(range.status()).toBe(206); expect(range.headers()["content-type"]).toContain("video/mp4");
    expect(range.headers()["content-range"]).toMatch(/^bytes 0-127\//); expect((await range.body()).length).toBe(128);
    const timings: Array<{ cache: string; clickToFrameMs: number }> = [];
    for (const cache of ["cold-media", "warm-media"]) {
      await resetDocument(`${COMMUNITY_TEST_ORIGIN}/en/products/${book.slug}`, `${cache}:navigation`);
      phase = `${cache}:video-intent`;
      const player = page.locator("video[data-flipthrough]");
      await player.scrollIntoViewIfNeeded();
      await expect(player).toHaveAttribute("controls", ""); await expect(player).toHaveAttribute("playsinline", "");
      await expect(page.getByText("fixture-film.mp4", { exact: true })).toHaveCount(0);
      await player.evaluate((element) => {
        const video = element as HTMLVideoElement;
        const target = window as unknown as { mediaTiming: { click: number; frame: number | null } };
        target.mediaTiming = { click: 0, frame: null };
        document.querySelector('[data-testid="product-video-play"]')!.addEventListener("click", () => {
          target.mediaTiming.click = performance.now();
          const requestFrame = video.requestVideoFrameCallback;
          if (typeof requestFrame === "function") requestFrame.call(video, () => { target.mediaTiming.frame = performance.now(); });
          else video.addEventListener("timeupdate", () => { target.mediaTiming.frame ??= performance.now(); }, { once: true });
        }, { capture: true, once: true });
      });
      phase = `${cache}:video-play`;
      await page.getByTestId("product-video-play").click();
      await expect.poll(() => player.evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 20_000 }).toBeGreaterThan(0.2);
      await expect.poll(() => page.evaluate(() => (window as unknown as { mediaTiming: { frame: number | null } }).mediaTiming.frame)).not.toBeNull();
      const timing = await page.evaluate(() => (window as unknown as { mediaTiming: { click: number; frame: number } }).mediaTiming);
      expect(timing.click).toBeGreaterThan(0); expect(timing.frame).toBeGreaterThanOrEqual(timing.click);
      timings.push({ cache, clickToFrameMs: timing.frame - timing.click });
      phase = `${cache}:pause-and-seek`;
      const postSeekFrame = await seekAndPaint(player);
      await testInfo.attach(`${cache}-post-seek-frame`, { body: JSON.stringify({ testedSha, runId, ...postSeekFrame }), contentType: "application/json" });
      expect(await player.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
      await capture(page, cache);
    }
    // Delay the actual application media request, then deliberately pause native
    // pending playback. No synthetic response replaces the stored MP4 bytes.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const videoPattern = `${COMMUNITY_TEST_ORIGIN}${videoPath}`;
    await page.route(videoPattern, async (route) => {
      delayedRequests.add(route.request()); await gate;
      try { await route.continue(); }
      catch { if (!pauseConfirmed || !route.request().failure()) throw new Error("Unexpected owned media-route continuation failure."); }
    });
    try {
      await resetDocument(`${COMMUNITY_TEST_ORIGIN}/en/products/${book.slug}`, "pending-playback:navigation");
      await page.locator("video").scrollIntoViewIfNeeded();
      await page.locator("video").evaluate((element) => {
        const events = { waiting: 0, stalled: 0 };
        (window as unknown as { mediaWaitEvents: typeof events }).mediaWaitEvents = events;
        element.addEventListener("waiting", () => { events.waiting += 1; });
        element.addEventListener("stalled", () => { events.stalled += 1; });
      });
      phase = "pending-playback:play";
      await page.getByTestId("product-video-play").click();
      await expect(page.getByRole("status").filter({ hasText: "Preparing video" })).toBeVisible();
      await expect.poll(() => page.evaluate(() => (window as unknown as { mediaWaitEvents: { waiting: number } }).mediaWaitEvents.waiting)).toBeGreaterThan(0);
      pauseConfirmed = true;
      phase = "pending-playback:deliberate-pause";
      await page.getByTestId("product-video-pause").click();
      await expect(page.getByTestId("product-video-play")).toBeVisible();
      waitEvents = await page.evaluate(() => (window as unknown as { mediaWaitEvents: typeof waitEvents }).mediaWaitEvents);
      expect(await page.locator("video").evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
      phase = "pending-playback:resume";
      release();
      await expect(page.getByRole("alert").filter({ hasText: "video could not" })).toHaveCount(0);
      await page.getByTestId("product-video-play").click();
      await expect.poll(() => page.locator("video").evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 20_000 }).toBeGreaterThan(0.2);
      phase = "pending-playback:completed-pause";
      await page.locator("video").evaluate((element) => (element as HTMLVideoElement).pause());
    } finally { release(); await page.unroute(videoPattern); }
    // Controlled transport failure, then real stored-byte recovery. The fault
    // aborts only this owned media request; it never fulfills a replacement MP4.
    faultActive = true;
    await page.route(videoPattern, async (route) => { faultRequests.add(route.request()); await route.abort("failed"); });
    try {
      await resetDocument(`${COMMUNITY_TEST_ORIGIN}/en/products/${book.slug}`, "controlled-fault:navigation");
      await page.locator("video").scrollIntoViewIfNeeded();
      const play = page.getByTestId("product-video-play");
      if (await play.isVisible()) await play.click();
      await expect(page.getByRole("alert").filter({ hasText: "video could not be played" })).toBeVisible();
      await capture(page, "controlled-video-error");
    } finally { await page.unroute(videoPattern); }
    phase = "controlled-fault:retry";
    await page.getByRole("button", { name: "Retry video", exact: true }).click();
    await expect.poll(() => page.locator("video").evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 20_000 }).toBeGreaterThan(0.2);
    await expect(page.getByRole("alert").filter({ hasText: "video could not be played" })).toHaveCount(0);
    faultActive = false;
    await seekAndPaint(page.locator("video"));
    await capture(page, "video-recovered-real-storage");
    expect(failed.some((request) => request.expectedFault)).toBe(true);
    // Observe a genuine tab switch rather than dispatching a fake visibility
    // event. Headless engines that keep it visible are recorded as such.
    const other = await page.context().newPage();
    let backgroundVisibility = "not-observed";
    let pausedOnReturn = false;
    let backgroundStartTime = 0;
    try {
      phase = "tab-switch:starting-video";
      await page.locator("video").evaluate((element) => (element as HTMLVideoElement).play());
      backgroundStartTime = await page.locator("video").evaluate((element) => (element as HTMLVideoElement).currentTime);
      phase = "tab-switch:background";
      await other.goto("about:blank"); await other.bringToFront();
      backgroundVisibility = await page.evaluate(() => document.visibilityState);
      phase = "tab-switch:return";
      await page.bringToFront();
      expect(await page.locator("video").evaluate((element) => Boolean((element as HTMLVideoElement).error))).toBe(false);
      pausedOnReturn = await page.locator("video").evaluate((element) => (element as HTMLVideoElement).paused);
      if (pausedOnReturn) {
        const bounds = await page.locator("video").boundingBox();
        // A trusted gesture on the native play control; no forced autoplay after backgrounding.
        await page.locator("video").click({ position: { x: 20, y: bounds!.height - 18 } });
      }
      await expect.poll(() => page.locator("video").evaluate((element) => (element as HTMLVideoElement).currentTime)).toBeGreaterThan(backgroundStartTime + 0.2);
      await seekAndPaint(page.locator("video"));
      await capture(page, "video-after-tab-return");
    } finally { phase = "tab-switch:close-secondary"; await other.close(); }
    const opener = page.getByRole("button", { name: "Open image 1", exact: true });
    phase = "gallery:thumbnail-intent";
    await opener.scrollIntoViewIfNeeded();
    phase = "gallery:open";
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Image preview" });
    await expect(dialog.getByRole("status")).toHaveCount(0);
    const image = dialog.locator("[data-gallery-display]").first();
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(2000);
    await capture(page, "decoded-gallery");
    await drainBeforeReset("gallery-close");
    phase = "gallery:close";
    await page.keyboard.press("Escape"); await expect(opener).toBeFocused();
    await drainBeforeReset("final-document-teardown");
    await finalizeNextRequests();
    await testInfo.attach("real-storage-media-evidence", { body: JSON.stringify({ testedSha, runId, project: testInfo.project.name, timings, consoleErrors, expectedFaultConsole, pageErrors, failed, backgroundVisibility, pausedOnReturn, backgroundStartTime, waitEvents,
      optimizerSelection: "NOT APPLICABLE to unoptimized authenticated Supabase fallback; tested separately in local-demo optimized image campaign" }), contentType: "application/json" });
    phase = "network:assertions";
    await networkSnapshot("before-assertions");
    expect(pageErrors).toEqual([]); expect(consoleErrors).toEqual([]); expect(observerErrors).toEqual([]); expect(nextFinalizationFailed).toBe(false);
    for (const request of failed) {
      if (request.validatedNextPrefetchId) {
        expect(request.method).toBe("GET"); expect(request.resource).toBe("fetch"); expect(request.rsc && request.prefetch).toBe(true);
        expect(request.error).toBe("net::ERR_ABORTED");
        continue;
      }
      expect(request.expectedPause || request.expectedFault).toBe(true); expect(request.method).toBe("GET"); expect(request.path).toBe(videoPath);
      if (request.expectedPause) {
        expect(request.pauseWitness?.trusted && request.pauseWitness.paused).toBe(true);
        expect(request.pauseWitness!.atEpochMs).toBeLessThan(request.failedAtEpochMs);
      }
      expect(request.expectedFault ? ["net::ERR_FAILED", "Load failed", "Unknown error", "Failed"] : ["net::ERR_ABORTED", "Load request cancelled", "NS_BINDING_ABORTED"]).toContain(request.error);
    }
    expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(testedSha);
    completed = true;
  } finally {
    let cleanupVerified = false;
    try {
      try { await finalizeNextRequests(); await networkSnapshot("finally-before-cleanup"); }
      finally {
      if (stopCdp) { try { await stopCdp(); } catch { observerErrors.push({ category: "invalid-native-observation" }); } stopCdp = null; }
      phase = "fixture-cleanup";
      try {
    for (const bucket of new Set(objects.map((object) => object.bucket))) {
      const owned = objects.filter((object) => object.bucket === bucket).map((object) => object.path);
      if (owned.length) expect((await fixtures.service.storage.from(bucket).remove(owned)).error).toBeNull();
    }
      } finally { await fixtures.cleanup(); }
      cleanupVerified = true;
      }
    } finally {
    const sourceMatchesHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() === testedSha && !execFileSync("git", ["status", "--porcelain", "--", "src", "tests", "scripts", "public", "messages", "package.json", "package-lock.json", "next.config.*"], { encoding: "utf8" }).trim();
    const provenance = { testedSha, runId, cleanupVerified, status: completed && cleanupVerified ? sourceMatchesHead ? "PASS" : "WORKING_TREE" : "FAIL", sourceMatchesHead, project: testInfo.project.name, tool: "Playwright", screenshots, networkDiagnostics };
    const body = JSON.stringify(provenance, null, 2);
    await writeFile(testInfo.outputPath("supabase-media-provenance.json"), body);
    await testInfo.attach("supabase-media-provenance", { body, contentType: "application/json" });
    }
  }
});

async function observeNativeMedia(page: Page, ownedPaths: string[], receive: (value: Record<string, unknown> | null) => void) {
  const binding = `__ux127Media_${randomUUID().replaceAll("-", "")}`;
  const events = ["play", "playing", "pause", "waiting", "stalled", "abort", "emptied", "loadstart", "loadedmetadata", "loadeddata", "suspend", "canplay", "seeking", "seeked", "error", "ended", "pagehide", "beforeunload", "visibilitychange", "video-detached", "src-change", "load-call", "play-intent", "frame"];
  await page.exposeBinding(binding, (_source, input: unknown) => {
    if (!input || typeof input !== "object") { receive(null); return; }
    const value = input as Record<string, unknown>;
    const numbers = ["atEpochMs", "performanceMs", "timeOrigin", "currentTime", "readyState", "networkState", "errorCode", "generation", "mediaTime"];
    if (!/^doc-[a-f0-9-]{36}$/.test(String(value.documentId)) || !/^element-\d+$/.test(String(value.elementId)) || typeof value.event !== "string" || !events.includes(value.event) ||
      !numbers.every((key) => typeof value[key] === "number" && Number.isFinite(value[key])) ||
      ![0, 1, -1].includes(value.sourceIndex as number) ||
      !["none", "metadata", "auto", "empty", "unknown"].includes(value.preload as string) ||
      !["paused", "connected", "trusted", "documentHidden", "mediaErrorPresent"].every((key) => typeof value[key] === "boolean")) { receive(null); return; }
    // Reconstruct a bounded record; never spread arbitrary browser payloads.
    receive({ event: value.event, documentId: value.documentId, elementId: value.elementId, generation: value.generation, mediaTime: value.mediaTime, atEpochMs: value.atEpochMs, performanceMs: value.performanceMs, timeOrigin: value.timeOrigin,
      currentTime: value.currentTime, readyState: value.readyState, networkState: value.networkState, errorCode: value.errorCode, preload: value.preload, mediaErrorPresent: value.mediaErrorPresent,
      paused: value.paused, connected: value.connected, trusted: value.trusted, documentHidden: value.documentHidden,
      sourcePath: value.sourceIndex === 0 || value.sourceIndex === 1 ? ownedPaths[value.sourceIndex] : "[no-owned-media-source]" });
  });
  await page.addInitScript(({ binding, ownedPaths }) => {
    let lastVideo: HTMLVideoElement | null = null;
    const documentId = `doc-${crypto.randomUUID()}`;
    let sequence = 0;
    const identities = new WeakMap<HTMLVideoElement, { elementId: string; generation: number }>();
    const identity = (video: HTMLVideoElement) => {
      let value = identities.get(video);
      if (!value) { value = { elementId: `element-${++sequence}`, generation: 0 }; identities.set(video, value); }
      return value;
    };
    (window as unknown as { __ux127ReadMediaIdentity: () => Record<string, unknown> }).__ux127ReadMediaIdentity = () => {
      const video = document.querySelector<HTMLVideoElement>("video[data-flipthrough]");
      if (!video) return { status: "no-video", documentId, sampledAtEpochMs: Date.now() };
      let sourceIndex = -1;
      try { sourceIndex = ownedPaths.indexOf(new URL(video.currentSrc || video.src, location.href).pathname); } catch { /* No raw source. */ }
      return { status: "sampled", documentId, ...identity(video), sourceIndex, sampledAtEpochMs: Date.now(), timeOrigin: performance.timeOrigin };
    };
    const emit = (video: HTMLVideoElement, event: string, trusted: boolean, mediaTime = -1) => {
      let sourceIndex = -1;
      try { sourceIndex = ownedPaths.indexOf(new URL(video.currentSrc || video.src, location.href).pathname); } catch { /* No raw URL is sent. */ }
      const payload = { event, documentId, ...identity(video), mediaTime, atEpochMs: Date.now(), performanceMs: performance.now(), timeOrigin: performance.timeOrigin,
        currentTime: video.currentTime, readyState: video.readyState, networkState: video.networkState, errorCode: video.error?.code ?? 0,
        preload: ["none", "metadata", "auto"].includes(video.preload) ? video.preload : video.preload === "" ? "empty" : "unknown",
        mediaErrorPresent: video.error !== null, paused: video.paused, connected: video.isConnected, trusted, documentHidden: document.hidden, sourceIndex };
      const report = (window as unknown as Record<string, (value: unknown) => Promise<void>>)[binding];
      void report(payload).catch(() => { /* A document may be disposed before its binding promise returns. */ });
    };
    const nativeLoad = HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.load = function () {
      if (this instanceof HTMLVideoElement && this.matches("[data-flipthrough]")) {
        identity(this).generation++; emit(this, "load-call", false);
      }
      return nativeLoad.call(this);
    };
    document.addEventListener("click", (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-testid="product-video-play"]')) return;
      const video = document.querySelector<HTMLVideoElement>("video[data-flipthrough]");
      if (video) emit(video, "play-intent", event.isTrusted);
    }, true);
    for (const name of ["play", "playing", "pause", "waiting", "stalled", "abort", "emptied", "loadstart", "loadedmetadata", "loadeddata", "suspend", "canplay", "seeking", "seeked", "error", "ended"]) {
      document.addEventListener(name, (event) => {
        if (event.target instanceof HTMLVideoElement && event.target.matches("[data-flipthrough]")) {
          lastVideo = event.target; emit(lastVideo, name, event.isTrusted);
          const video = lastVideo;
          if (name === "playing" && typeof video.requestVideoFrameCallback === "function") {
            const generation = identity(video).generation;
            const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
              if (identity(video).generation !== generation || !video.isConnected || video.paused) return;
              if (metadata.mediaTime > 0.2) emit(video, "frame", false, metadata.mediaTime);
              else video.requestVideoFrameCallback(onFrame);
            };
            video.requestVideoFrameCallback(onFrame);
          }
        }
      }, true);
    }
    for (const name of ["pagehide", "beforeunload", "visibilitychange"]) {
      (name === "visibilitychange" ? document : window).addEventListener(name, (event: Event) => {
        const video = document.querySelector<HTMLVideoElement>("video[data-flipthrough]") ?? lastVideo;
        if (video) emit(video, name, event.isTrusted);
      });
    }
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLVideoElement && record.target.matches("[data-flipthrough]")) {
          identity(record.target).generation++; emit(record.target, "src-change", false);
        }
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue;
          const removed = node instanceof HTMLVideoElement ? [node] : Array.from(node.querySelectorAll<HTMLVideoElement>("video[data-flipthrough]"));
          for (const candidate of removed) if (identities.has(candidate)) emit(candidate, "video-detached", false);
        }
      }
      const video = document.querySelector<HTMLVideoElement>("video[data-flipthrough]");
      lastVideo = video;
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  }, { binding, ownedPaths });
}

function projectIdentitySample(input: Record<string, unknown>) {
  const number = (key: string) => typeof input[key] === "number" && Number.isFinite(input[key]) ? input[key] : null;
  return {
    status: ["sampled", "no-video", "identity-not-installed"].includes(String(input.status)) ? input.status : "invalid-identity-sample",
    documentId: /^doc-[a-f0-9-]{36}$/.test(String(input.documentId)) ? input.documentId : null,
    elementId: /^element-\d+$/.test(String(input.elementId)) ? input.elementId : null,
    generation: number("generation"), sourceIndex: [-1, 0, 1].includes(input.sourceIndex as number) ? input.sourceIndex : null,
    sampledAtEpochMs: number("sampledAtEpochMs"), timeOrigin: number("timeOrigin"),
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
