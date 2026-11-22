// Reads the real existing home page; creates no accounts/products/media and fulfills no responses.
import { expect, test, type Locator, type Page, type APIResponse, type Request } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { NextCancellationObserver } from "./helpers/next-navigation-cancellations";
import { isLoopbackPlaywrightTarget } from "./local-target";

test.use({ trace: "off", screenshot: "off", video: "off" });

type SafeError = { category: "unexpected-console-error" | "unexpected-page-error"; path: string };
type ImageRecord = {
  role: string; status: "MEASURED" | "MEASURED_VECTOR" | "ABSENT" | "FALLBACK";
  visualSharpness: "PENDING_VISUAL_REVIEW";
  [key: string]: unknown;
};

for (const width of [360, 390, 430, 768]) for (const dpr of [1, 2, 3]) {
  test(`F13-F14 real home branding ${width}px DPR${dpr}`, async ({ browser }, info) => {
    test.skip(process.env.RUN_ISSUE_127_BRANDING_E2E !== "1", "Separate opt-in HTTPS branding campaign; normal local suites count these cases as skipped.");
    test.setTimeout(120_000);
    const base = String(info.project.use.baseURL ?? "");
    if (!isLoopbackPlaywrightTarget(base) || new URL(base).protocol !== "https:") {
      throw new Error("Branding acceptance requires the owned loopback HTTPS application.");
    }
    const origin = new URL(base).origin;
    const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const runId = `branding-${info.project.name}-${width}-dpr${dpr}-${randomUUID().slice(0, 8)}`;
    const projectUse = info.project.use;
    const context = await browser.newContext({ baseURL: origin, viewport: { width, height: projectUse.viewport?.height ?? 900 }, deviceScaleFactor: dpr,
      userAgent: projectUse.userAgent, isMobile: projectUse.isMobile, hasTouch: projectUse.hasTouch,
      locale: projectUse.locale, colorScheme: projectUse.colorScheme, reducedMotion: projectUse.contextOptions?.reducedMotion, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const imagePayloads = observeImagePayloads(page);
    const observer = new NextCancellationObserver({ testedSha, runId, origin });
    await observer.observe(page);
    const errors: SafeError[] = [];
    const httpErrors: Array<{ method: string; path: string; resource: string; status: number }> = [];
    const images: ImageRecord[] = [];
    const screenshots: Array<Record<string, unknown>> = [];
    const browserResponses = new Map<string, { status: number; cache: string[]; length: number | null }>();
    let completed = false;
    let observerFailed = false;
    let network: Awaited<ReturnType<NextCancellationObserver["finish"]>> | null = null;
    page.on("console", (message) => {
      if (message.type() === "error") errors.push({ category: "unexpected-console-error", path: safePath(message.location().url, origin) });
    });
    page.on("pageerror", () => errors.push({ category: "unexpected-page-error", path: safePath(page.url(), origin) }));
    page.on("response", (response) => {
      const request = response.request();
      const headers = response.headers();
      browserResponses.set(hash(response.url()), { status: response.status(), cache: cacheTokens(headers["cache-control"]), length: safeInteger(headers["content-length"]) });
      if (response.status() >= 400) httpErrors.push({ method: request.method(), path: safePath(response.url(), origin), resource: request.resourceType(), status: response.status() });
    });
    await context.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));

    async function capture(phase: string) {
      await page.evaluate(async () => {
        await document.fonts.ready;
        const visible = Array.from(document.images).filter((image) => {
          const box = image.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && box.left < innerWidth && box.right > 0 && getComputedStyle(image).visibility !== "hidden";
        });
        await Promise.all(visible.map((image) => image.decode()));
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      const artifact = `docs/verification/issue-127/${runId}-${phase}.png`;
      await mkdir(path.dirname(path.resolve(artifact)), { recursive: true });
      const image = await page.screenshot({ path: path.resolve(artifact), animations: "disabled" });
      screenshots.push({ path: artifact, sha256: hash(image), testedSha, runId, phase, viewport: page.viewportSize(), dpr: await page.evaluate(() => devicePixelRatio), visualReview: "PENDING" });
    }

    async function measure(role: string, image: Locator, referencePath?: string, targetBudgetBytes?: number) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate(async (element) => { await (element as HTMLImageElement).decode(); });
      const state = await image.evaluate((element) => {
        const image = element as HTMLImageElement;
        const slot = image.getBoundingClientRect();
        return { currentSrc: image.currentSrc, naturalWidth: image.naturalWidth, complete: image.complete, actualDpr: devicePixelRatio, slot: { width: slot.width, height: slot.height }, loading: image.loading, sizes: image.sizes };
      });
      const selected = new URL(state.currentSrc, origin);
      expect(["https:", "http:"]).toContain(selected.protocol);
      // Actual negotiated browser bytes, not an Accept */* replay or density-corrected naturalWidth.
      const payload = imagePayloads.get(state.currentSrc);
      if (!payload) throw new Error("The selected browser image response was not observed.");
      const bytes = await payload.body;
      if (!bytes) throw new Error("The actual browser image response body is unavailable.");
      const decoded = await sharp(bytes).metadata().catch(() => { throw new Error("The browser image payload could not be decoded."); });
      const accept = await payload.accept;
      if (!accept) throw new Error("The actual image request Accept header was not observed.");
      const underlying = new URL(referencePath ?? selected.searchParams.get("url") ?? selected.href, origin);
      const originalResponse = await getImage(page, underlying.href, accept);
      const original = await sharp(await originalResponse.body()).metadata();
      const isFallback = /placeholder/i.test(underlying.pathname);
      if (isFallback) {
        images.push({ role, status: "FALLBACK", source: sourceProjection(selected, origin), decodedFormat: decoded.format,
          slot: state.slot, visualSharpness: "PENDING_VISUAL_REVIEW" });
        return;
      }
      if (decoded.format === "svg") {
        // SVG intrinsic width is a viewport, never evidence of a physical raster pixel ceiling.
        expect(role.startsWith("audience-")).toBe(true);
        expect(original.format).toBe("svg");
        expect(payload.mime).toBe("image/svg+xml");
        expect(safeImageMime(originalResponse.headers()["content-type"])).toBe("image/svg+xml");
        expect(bytes.length).toBeGreaterThan(0); expect(state.complete).toBe(true);
        expect(state.naturalWidth).toBeGreaterThan(0);
        expect(state.slot.width).toBeGreaterThan(0); expect(state.slot.height).toBeGreaterThan(0);
        expect(state.actualDpr).toBe(dpr);
        images.push({ role, status: "MEASURED_VECTOR", source: sourceProjection(selected, origin), originalSource: sourceProjection(underlying, origin),
          representation: "svg-vector", mime: payload.mime, bytes: bytes.length,
          intrinsicSvgViewport: { width: decoded.width ?? null, height: decoded.height ?? null, physicalRasterPixels: "NOT_APPLICABLE" },
          browserDecode: { decodePromise: "resolved", complete: state.complete, reportedNaturalWidth: state.naturalWidth },
          slot: state.slot, dpr: state.actualDpr,
          renderedSlotPhysicalPixels: { width: Math.ceil(state.slot.width * state.actualDpr), height: Math.ceil(state.slot.height * state.actualDpr) },
          resolutionModel: "vector scales to the measured CSS slot; intrinsic SVG viewport is not raster resolution",
          browserResponse: browserResponses.get(hash(state.currentSrc)) ?? null,
          browserPayload: { source: "observed-browser-response-body", status: payload.status, mime: payload.mime, sha256: hash(bytes) },
          originalReferenceVerificationGet: { usesObservedImageAccept: true, status: originalResponse.status(), mime: safeImageMime(originalResponse.headers()["content-type"]), cache: cacheTokens(originalResponse.headers()["cache-control"]) },
          visualSharpness: "PENDING_VISUAL_REVIEW" });
        return;
      }
      expect(decoded.width).toBeGreaterThan(0); expect(original.width).toBeGreaterThan(0);
      const requiredPixels = Math.min(original.width!, Math.ceil(state.slot.width * dpr));
      expect(decoded.width!).toBeGreaterThanOrEqual(requiredPixels);
      if (role.includes("logo") || role === "banner") {
        expect(decoded.format).toBe("webp");
        expect(payload.mime).toBe("image/webp");
        expect(safeImageMime(originalResponse.headers()["content-type"])).toBe("image/webp");
        if (role.includes("logo")) { expect(original.width).toBe(192); expect(bytes.length).toBeLessThanOrEqual(20_000); }
      }
      images.push({ role, status: "MEASURED", source: sourceProjection(selected, origin), originalSource: sourceProjection(underlying, origin),
        decoded: { width: decoded.width, height: decoded.height, format: decoded.format, bytes: bytes.length }, originalWidth: original.width,
        slot: state.slot, dpr, requiredPixels, reportedNaturalWidth: state.naturalWidth, loading: state.loading,
        browserResponse: browserResponses.get(hash(state.currentSrc)) ?? null,
        browserPayload: { source: "observed-browser-response-body", status: payload.status, mime: payload.mime, sha256: hash(bytes) },
        originalReferenceVerificationGet: { usesObservedImageAccept: true, status: originalResponse.status(), mime: safeImageMime(originalResponse.headers()["content-type"]), cache: cacheTokens(originalResponse.headers()["cache-control"]) },
        budget: targetBudgetBytes ? { targetMaxBytes: targetBudgetBytes, withinTarget: bytes.length <= targetBudgetBytes, policy: "product target; quality tradeoff needs review" } : null,
        visualSharpness: "PENDING_VISUAL_REVIEW" });
    }

    try {
      await page.goto("/en", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("localized-route-loading")).toHaveCount(0);
      const headerLogo = page.locator("header").getByRole("link", { name: "LamiliaLomi home", exact: true }).locator("img");
      await expect(headerLogo).toBeVisible();
      await measure("header-logo", headerLogo, "/assets/home/lamilia-lomi-logo-192.webp", 20_000);
      const campaign = page.getByTestId("home-campaign-banner");
      await expect(campaign).toHaveCount(1, { timeout: 15_000 });
      await expect(campaign).toBeVisible();
      await measure("banner", campaign.locator("picture img"), width < 768 ? "/assets/home/campaign-mobile-1200.webp" : "/assets/home/campaign-desktop-1920.webp", 200_000);
      await capture("header-banner");

      // Only the actual home audience links are considered; no invented cards or fixture writes.
      for (const audience of ["kids", "adults"]) {
        const card = page.locator(`main a[href="/en/products?audience=${audience}"]`).filter({ has: page.locator("img, [role=img]") });
        const count = await card.count();
        if (!count) {
          images.push({ role: `audience-${audience}`, status: "ABSENT", visualSharpness: "PENDING_VISUAL_REVIEW" });
          info.annotations.push({ type: "coverage-gap", description: `No real ${audience} audience image exists in this home read model.` });
          continue;
        }
        expect(count).toBe(1);
        const image = card.locator("img");
        if (!await image.count()) {
          await card.scrollIntoViewIfNeeded();
          images.push({ role: `audience-${audience}`, status: "FALLBACK", visualSharpness: "PENDING_VISUAL_REVIEW" });
        } else await measure(`audience-${audience}`, image);
        await capture(`audience-${audience}`);
      }
      await page.evaluate(() => scrollTo(0, 0));
      const trigger = page.getByRole("button", { name: "Open navigation menu", exact: true });
      await trigger.click();
      const menu = page.getByRole("dialog", { name: "Mobile primary navigation", exact: true });
      await expect(menu).toBeVisible();
      await measure("menu-logo", menu.locator("img").first(), "/assets/home/lamilia-lomi-logo-192.webp", 20_000);
      await expect(menu).toBeVisible();
      await capture("menu");
      await menu.getByRole("button", { name: "Close navigation menu", exact: true }).click();
      await expect(menu).not.toBeVisible(); await expect(trigger).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      completed = true;
    } finally {
      // Existing typed observer drains genuine requests; its bounded RSC proof is not a blanket ignore.
      try { network = await observer.finish(); } catch { observerFailed = true; }
      await context.close();
      const sourceMatchesHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() === testedSha &&
        !execFileSync("git", ["status", "--porcelain", "--", "src", "tests", "scripts", "public", "messages", "package.json", "package-lock.json", "next.config.*", "playwright*.ts"], { encoding: "utf8" }).trim();
      const required = ["header-logo", "banner", "menu-logo", "audience-kids", "audience-adults"];
      const coverageGaps = required.filter((role) => !images.some((image) => image.role === role && (image.status === "MEASURED" || (role.startsWith("audience-") && image.status === "MEASURED_VECTOR"))))
        .map((role) => ({ role, status: images.find((image) => image.role === role)?.status ?? "NOT_MEASURED" }));
      const completeImages = coverageGaps.length === 0;
      // Only typed RSC proof retains its controlled query contract. Unknown requests are projected.
      const projectFailure = (request: Record<string, unknown>) => {
        const url = typeof request.url === "string" ? request.url : "";
        const knownErrors = ["net::ERR_ABORTED", "net::ERR_FAILED", "Load request cancelled", "NS_BINDING_ABORTED", "Load failed", "Unknown error", "Failed"];
        return { path: safePath(url, origin), urlSha256: hash(url),
          method: ["GET", "POST", "HEAD", "OPTIONS"].includes(String(request.method)) ? request.method : "other-method",
          resource: ["image", "media", "fetch", "script", "stylesheet", "document", "font", "xhr", "other"].includes(String(request.resource)) ? request.resource : "other-resource",
          category: knownErrors.includes(String(request.error)) ? request.error : "unknown-network-error" };
      };
      const networkEvidence = { failedCount: network?.failedNetworkRequests.length ?? 0, unresolvedCount: network?.unresolved.length ?? 0,
        failures: network?.failedNetworkRequests.map(projectFailure) ?? [], unresolved: network?.unresolved.map(projectFailure) ?? [],
        expectedNextCancellations: network?.expectedNextCancellations ?? [], closedPrefetches: network?.closedPrefetches ?? [] };
      const evidence = { testedSha, runId, sourceMatchesHead, project: info.project.name, browser: browser.browserType().name(), width, dpr,
        metricsChecksComplete: completed && completeImages, coverageGaps, coverage: completeImages ? "COMPLETE_METRICS" : "PARTIAL_REAL_CONTENT", visualSharpness: "PENDING_VISUAL_REVIEW",
        physicalDevice: false, images, screenshots, errors, httpErrors, observerFailed, network: networkEvidence };
      const body = JSON.stringify(evidence, null, 2);
      await writeFile(info.outputPath("branding-evidence.json"), body);
      await info.attach("branding-evidence", { body, contentType: "application/json" });
      expect(observerFailed).toBe(false); expect(errors).toEqual([]); expect(httpErrors).toEqual([]);
      expect(networkEvidence.unresolvedCount).toBe(0);
      expect(completeImages, "All five required real branding images must have COMPLETE_METRICS; see coverageGaps.").toBe(true);
      expect(completed).toBe(true);
      expect(sourceMatchesHead).toBe(true);
    }
  });
}

async function getImage(page: Page, rawUrl: string, observedAccept: string): Promise<APIResponse> {
  const url = new URL(rawUrl, page.url());
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackPlaywrightTarget(url.origin)))) {
    throw new Error("Image verification refuses unsupported transport or URL credentials.");
  }
  let response: APIResponse;
  try { response = await page.request.get(url.href, { headers: { Accept: observedAccept } }); } catch { throw new Error("The actual image response could not be read."); }
  expect(response.ok()).toBe(true);
  return response;
}
function safePath(value: string, base: string) {
  try { const url = new URL(value || base, base); return ["https:", "http:"].includes(url.protocol) ? url.pathname : "[non-http-location]"; }
  catch { return "[invalid-location]"; }
}
function sourceProjection(url: URL, origin: string) {
  const source = new URL(url.searchParams.get("url") ?? url.href, origin);
  const branding = /^\/assets\/home\/(?:lamilia-lomi-logo-192|campaign-mobile-(?:640|960|1200)|campaign-desktop-(?:1280|1920))\.webp$/;
  const sourcePath = branding.test(source.pathname) ? source.pathname : source.pathname.startsWith("/api/media/") ? "/api/media/[asset]" : source.pathname.startsWith("/products/") ? "/products/[public-image]" : source.pathname.startsWith("/uploads/") ? "/uploads/[image]" : "/assets/[image]";
  const number = (key: string, allowed: readonly number[]) => { const raw = url.searchParams.get(key); return raw !== null && /^\d+$/.test(raw) && allowed.includes(Number(raw)) ? Number(raw) : null; };
  return { pathname: url.pathname === "/_next/image" ? "/_next/image" : sourcePath, sourcePath, currentSrcSha256: hash(url.href),
    optimizerWidth: number("w", [32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840]), optimizerQuality: number("q", [75]) };
}
function hash(value: string | Buffer) { return createHash("sha256").update(value).digest("hex"); }
function safeInteger(value: string | undefined) { return value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null; }
function cacheTokens(value: string | undefined) { return value?.toLowerCase().match(/\b(?:public|private|no-store|no-cache|must-revalidate|immutable|max-age=\d+|s-maxage=\d+)\b/g) ?? []; }


type ObservedImagePayload = { body: Promise<Buffer | null>; accept: Promise<string | null>; status: number; mime: string };
function observeImagePayloads(page: Page) {
  // Register before goto. Neither full URLs nor raw Accept values leave this in-memory map.
  const payloads = new Map<string, ObservedImagePayload>();
  page.on("response", (response) => {
    const request = response.request();
    if (request.resourceType() !== "image" || !response.ok()) return;
    const payload = { body: response.body().catch(() => null), accept: request.headerValue("accept").catch(() => null), status: response.status(), mime: safeImageMime(response.headers()["content-type"]) };
    for (let alias: Request | null = request; alias; alias = alias.redirectedFrom()) payloads.set(alias.url(), payload);
  });
  return payloads;
}

function safeImageMime(value: string | undefined) {
  const mime = value?.split(";", 1)[0].trim().toLowerCase();
  return mime && ["image/svg+xml", "image/webp", "image/png", "image/jpeg", "image/avif", "image/gif"].includes(mime) ? mime : "unknown-image-mime";
}
