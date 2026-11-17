import { expect, test, type Request } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { communityFixtures, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

/** Real Storage/Auth/DB transport. Supabase fallback images intentionally stay
 * unoptimized; optimized srcset selection is a separate local-demo campaign. */
test("F15-F17 real isolated product media has Range, decoded previews and recoverable pending playback", async ({ page }, testInfo) => {
  test.skip(process.env.RUN_ISSUE_127_PRODUCT_MEDIA_E2E !== "1", "Requires guarded exclusive local Supabase and its owned HTTPS gateway.");
  test.setTimeout(180_000);
  const fixtures = await communityFixtures(testInfo); // Pins the existing strict local Docker/API/DB identity before writes.
  const objects: Array<{ bucket: string; path: string }> = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failed: Array<{ method: string; path: string; error: string | null; expectedPause: boolean }> = [];
  const delayedRequests = new WeakSet<Request>();
  let pauseConfirmed = false;
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failed.push({ method: request.method(), path: new URL(request.url()).pathname,
    error: request.failure()?.errorText ?? null, expectedPause: pauseConfirmed && delayedRequests.has(request) }));
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
    const range = await page.request.get(`${COMMUNITY_TEST_ORIGIN}${videoPath}`, { headers: { Range: "bytes=0-127" } });
    expect(range.status()).toBe(206); expect(range.headers()["content-type"]).toContain("video/mp4");
    expect(range.headers()["content-range"]).toMatch(/^bytes 0-127\//); expect((await range.body()).length).toBe(128);
    const timings: Array<{ cache: string; clickToFrameMs: number }> = [];
    for (const cache of ["cold-media", "warm-media"]) {
      await page.goto(`${COMMUNITY_TEST_ORIGIN}/en/products/${book.slug}`);
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
      await page.getByTestId("product-video-play").click();
      await expect.poll(() => player.evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 20_000 }).toBeGreaterThan(0.2);
      await expect.poll(() => page.evaluate(() => (window as unknown as { mediaTiming: { frame: number | null } }).mediaTiming.frame)).not.toBeNull();
      const timing = await page.evaluate(() => (window as unknown as { mediaTiming: { click: number; frame: number } }).mediaTiming);
      expect(timing.click).toBeGreaterThan(0); expect(timing.frame).toBeGreaterThanOrEqual(timing.click);
      timings.push({ cache, clickToFrameMs: timing.frame - timing.click });
      await player.evaluate(async (element) => {
        const video = element as HTMLVideoElement; video.pause();
        await new Promise<void>((resolve) => { video.addEventListener("seeked", () => resolve(), { once: true }); video.currentTime = Math.min(1, video.duration / 2); });
      });
      expect(await player.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
      await mkdir(path.resolve("docs/verification/issue-127"), { recursive: true });
      await page.screenshot({ path: path.resolve(`docs/verification/issue-127/supabase-media-${testInfo.project.name}-${cache}.png`), animations: "disabled" });
    }
    // Delay the actual application media request, then deliberately pause native
    // pending playback. No synthetic response replaces the stored MP4 bytes.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const videoPattern = `${COMMUNITY_TEST_ORIGIN}${videoPath}`;
    await page.route(videoPattern, async (route) => {
      delayedRequests.add(route.request()); await gate;
      try { await route.continue(); }
      catch (error) { if (!pauseConfirmed || !route.request().failure()) throw error; }
    });
    try {
      await page.goto(`${COMMUNITY_TEST_ORIGIN}/en/products/${book.slug}`);
      await page.locator("video").scrollIntoViewIfNeeded();
      await page.getByTestId("product-video-play").click();
      await expect(page.getByRole("status").filter({ hasText: "Preparing video" })).toBeVisible();
      pauseConfirmed = true;
      await page.getByTestId("product-video-pause").click();
      await expect(page.getByTestId("product-video-play")).toBeVisible();
      expect(await page.locator("video").evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
      release();
      await expect(page.getByRole("alert").filter({ hasText: "video could not" })).toHaveCount(0);
      await page.getByTestId("product-video-play").click();
      await expect.poll(() => page.locator("video").evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 20_000 }).toBeGreaterThan(0.2);
      await page.locator("video").evaluate((element) => (element as HTMLVideoElement).pause());
    } finally { release(); await page.unroute(videoPattern); }
    const opener = page.getByRole("button", { name: "Open image 1", exact: true });
    await opener.scrollIntoViewIfNeeded(); await opener.click();
    const dialog = page.getByRole("dialog", { name: "Image preview" });
    await expect(dialog.getByRole("status")).toHaveCount(0);
    const image = dialog.locator("[data-gallery-display]").first();
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(2000);
    await page.keyboard.press("Escape"); await expect(opener).toBeFocused();
    expect(pageErrors).toEqual([]); expect(consoleErrors).toEqual([]);
    for (const request of failed) {
      expect(request.expectedPause).toBe(true); expect(request.method).toBe("GET"); expect(request.path).toBe(videoPath);
      expect(["net::ERR_ABORTED", "Load request cancelled", "NS_BINDING_ABORTED"]).toContain(request.error);
    }
    await testInfo.attach("real-storage-media-evidence", { body: JSON.stringify({ project: testInfo.project.name, timings, consoleErrors, pageErrors, failed,
      optimizerSelection: "NOT APPLICABLE to unoptimized authenticated Supabase fallback; tested separately in local-demo optimized image campaign" }), contentType: "application/json" });
  } finally {
    for (const bucket of new Set(objects.map((object) => object.bucket))) {
      const owned = objects.filter((object) => object.bucket === bucket).map((object) => object.path);
      if (owned.length) expect((await fixtures.service.storage.from(bucket).remove(owned)).error).toBeNull();
    }
    await fixtures.cleanup();
  }
});
