import { chromium } from "playwright";
import os from "node:os";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { summarizeGroups } from "./summary.mjs";

const origin = process.env.LL_NAV_PROD_ORIGIN ?? "https://www.lamilialomi.com";
const outputRoot = process.env.LL_NAV_OUTPUT;
const sampleInput = process.env.LL_NAV_SAMPLES ?? "3";
const acceptedTarget = Number(sampleInput);
const maxAttempts = acceptedTarget + 3;
const expectedRunnerSha = process.env.LL_NAV_EXPECT_RUNNER_SHA?.trim();
const runnerSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sourceSha = process.env.LL_NAV_PROD_SOURCE_SHA?.trim();
const vercelDeploymentId = process.env.LL_NAV_VERCEL_DEPLOYMENT_ID;
const githubDeploymentId = process.env.LL_NAV_GITHUB_DEPLOYMENT_ID;
const productSlug = "https-www-amazon-com-dp-b0h8tttsny";
const productTitleMatch = "Cinderella";

if (!outputRoot) throw new Error("Set LL_NAV_OUTPUT to the evidence output directory.");
if (!Number.isInteger(acceptedTarget) || acceptedTarget < 3 || acceptedTarget > 10) {
  throw new Error("LL_NAV_SAMPLES must be an integer from 3 through 10.");
}
if (expectedRunnerSha && runnerSha !== expectedRunnerSha) {
  throw new Error(`Runner SHA mismatch: expected ${expectedRunnerSha}, got ${runnerSha}.`);
}
if (!expectedRunnerSha) throw new Error("Set LL_NAV_EXPECT_RUNNER_SHA to pin the exact local benchmark runner revision.");
if (!sourceSha) throw new Error("Set LL_NAV_PROD_SOURCE_SHA after independently verifying the current Production SHA.");
if (origin !== "https://www.lamilialomi.com") {
  throw new Error("Production benchmark is restricted to https://www.lamilialomi.com.");
}
if (!vercelDeploymentId || !githubDeploymentId) throw new Error("Set the Vercel and GitHub Production deployment IDs after independently verifying the live alias.");

const transitions = [
  {
    id: "home_to_catalog",
    label: "Home → Catalog",
    source: { path: "/en", heading: "LamiliaLomi", screenshot: "home" },
    target: { path: "/en/products", heading: "Browse LamiliaLomi books" },
    selector: (page) => page.getByRole("link", { name: "Browse catalog", exact: true }),
  },
  {
    id: "catalog_to_product_detail",
    label: "Catalog → Product Detail",
    source: { path: "/en/products", heading: "Browse LamiliaLomi books", screenshot: "catalog" },
    target: { path: `/en/products/${productSlug}`, headingIncludes: productTitleMatch },
    selector: (page) => page.getByRole("link", { name: /Cinderella/i }),
  },
  {
    id: "product_detail_to_catalog_header",
    label: "Product Detail → Catalog (header navigation)",
    source: { path: `/en/products/${productSlug}`, headingIncludes: productTitleMatch, screenshot: "product-detail" },
    target: { path: "/en/products", heading: "Browse LamiliaLomi books" },
    selector: (page) => page.locator('nav[aria-label="Primary navigation"]:visible').getByRole("link", { name: "Catalog", exact: true }),
  },
  {
    id: "header_to_library_guest",
    label: "Header → Library (guest)",
    source: { path: "/en/products", heading: "Browse LamiliaLomi books", screenshot: "catalog" },
    target: { path: "/en/library", heading: "My Library" },
    selector: (page) => page.locator('nav[aria-label="Primary navigation"]:visible').getByRole("link", { name: "My Library", exact: true }),
  },
  {
    id: "header_to_login_guest",
    label: "Header → Login (guest)",
    source: { path: "/en/products", heading: "Browse LamiliaLomi books", screenshot: "catalog" },
    target: { path: "/en/login", heading: "Log in" },
    selector: (page) => page.locator("header").getByRole("link", { name: "Log in", exact: true }),
  },
];
const devices = [
  { id: "desktop", label: "Chromium desktop", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { id: "pixel7", label: "Pixel 7 emulation", viewport: { width: 412, height: 839 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
];
const runId = `navigation-production-public-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const outDir = path.join(outputRoot, runId);
const screenshotsDir = path.join(outDir, "screenshots");
fs.mkdirSync(screenshotsDir, { recursive: true });
const diagnostics = { consoleErrors: [], pageErrors: [], sameOriginHttpErrors: [], requestFailures: {} };
const rejectedAttempts = [];
const groups = [];
const keyboardChecks = [];
const screenshots = new Set();
let browser;
let healthSnapshot = null;

function installDiagnostics(page) {
  page.on("console", (message) => {
    if (message.type() === "error" && diagnostics.consoleErrors.length < 100) diagnostics.consoleErrors.push({ text: message.text().slice(0, 300), url: message.location().url });
  });
  page.on("pageerror", (error) => { if (diagnostics.pageErrors.length < 100) diagnostics.pageErrors.push(error.message.slice(0, 300)); });
  page.on("response", (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400 && diagnostics.sameOriginHttpErrors.length < 200) {
      diagnostics.sameOriginHttpErrors.push({ path: new URL(response.url()).pathname, status: response.status() });
    }
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText || "request failed";
    diagnostics.requestFailures[reason] = (diagnostics.requestFailures[reason] || 0) + 1;
  });
}

function headingLocator(page, target) {
  if (target.headingIncludes) {
    return page.getByRole("heading", { level: 1, name: new RegExp(target.headingIncludes.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first();
  }
  return page.getByRole("heading", { level: 1, name: target.heading, exact: true });
}

async function waitForHeading(page, target) {
  const heading = headingLocator(page, target);
  await heading.waitFor({ state: "visible", timeout: 45_000 });
  return heading.innerText();
}

async function screenshot(page, deviceId, pageId) {
  const key = `${deviceId}-${pageId}`;
  if (screenshots.has(key)) return;
  await page.screenshot({ path: path.join(screenshotsDir, `${key}.png`), fullPage: true });
  screenshots.add(key);
}

async function freshPage(device) {
  const context = await browser.newContext({ viewport: device.viewport, screen: device.viewport, deviceScaleFactor: device.deviceScaleFactor, isMobile: device.isMobile, hasTouch: device.hasTouch });
  await context.addInitScript(() => { try { localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })); } catch {} });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(45_000);
  installDiagnostics(page);
  return { context, page };
}

async function armMarkers(page, target, targetLink) {
  const marks = { startedAt: null, trusted: false, pressedFeedbackMs: null, loadingUiMs: null, urlMs: null, contentMs: null, contentText: null };
  page.__llNavCurrentMarks = marks;
  if (!page.__llNavBindingInstalled) {
    await page.exposeBinding("__llNavMark", (_source, update) => Object.assign(page.__llNavCurrentMarks, update));
    page.__llNavBindingInstalled = true;
  }
  await targetLink.evaluate((anchor, { targetPath, heading, headingIncludes }) => {
    const feedbackTargets = [anchor, anchor.closest("article")].filter(Boolean);
    const styleSignature = (element) => {
      const style = getComputedStyle(element);
      return [style.transform, style.scale, style.translate, style.boxShadow, style.borderColor, style.backgroundColor, style.color, style.opacity, style.outlineWidth, style.outlineColor].join("|");
    };
    let baselineStyles = new Map(feedbackTargets.map((element) => [element, styleSignature(element)]));
    const captureBaselineStyles = () => {
      baselineStyles = new Map(feedbackTargets.map((element) => [element, styleSignature(element)]));
    };
    anchor.addEventListener("pointerenter", captureBaselineStyles, { capture: true });
    anchor.addEventListener("pointerdown", (event) => {
      if (!event.isTrusted) return;
      const start = performance.now();
      void window.__llNavMark({ startedAt: start, trusted: true });
      let finished = false;
      let pressedRecorded = false;
      let loadingRecorded = false;
      let urlRecorded = false;
      const mark = (key, value) => { if (!finished) void window.__llNavMark({ [key]: Number((value - start).toFixed(1)) }); };
      const visible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const minHeight = element.matches('[data-pending="true"]') ? 0.5 : 4;
        return !element.classList.contains("sr-only") && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) >= 0.1 && rect.width > 4 && rect.height > minHeight && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth && style.clip === "auto" && style.clipPath === "none";
      };
      const loaderSelector = '[aria-busy="true"], [role="status"], [data-testid*="loading"], [data-pending="true"]';
      const priorLoaders = new Set([...document.querySelectorAll(loaderSelector)].filter(visible));
      let previousFrameCandidates = new Map();
      const frame = () => {
        if (finished) return;
        const now = performance.now();
        const frameCandidates = new Map();
        const activeElement = feedbackTargets.find((element) =>
          element.matches(":active") && styleSignature(element) !== baselineStyles.get(element)
        );
        if (activeElement) frameCandidates.set("pressedFeedbackMs", activeElement);
        const loader = [...document.querySelectorAll(loaderSelector)].find((element) => visible(element) && !priorLoaders.has(element));
        if (loader) frameCandidates.set("loadingUiMs", loader);
        if (!urlRecorded && location.pathname === targetPath) {
          urlRecorded = true;
          mark("urlMs", now);
        }
        const h1 = [...document.querySelectorAll("h1")].find((element) => {
          if (!visible(element)) return false;
          const text = element.innerText.trim();
          return headingIncludes ? text.includes(headingIncludes) : text === heading;
        });
        if (h1 && location.pathname === targetPath) frameCandidates.set("contentMs", h1);

        for (const [metric, element] of frameCandidates) {
          const wasVisibleOnPreviousFrame = previousFrameCandidates.get(metric) === element;
          if (!wasVisibleOnPreviousFrame) continue;
          if (metric === "pressedFeedbackMs" && !pressedRecorded) {
            pressedRecorded = true;
            mark(metric, now);
          } else if (metric === "loadingUiMs" && !loadingRecorded) {
            loadingRecorded = true;
            mark(metric, now);
          } else if (metric === "contentMs" && location.pathname === targetPath) {
            finished = true;
            void window.__llNavMark({ contentMs: Number((now - start).toFixed(1)), contentText: element.innerText.trim() });
          }
        }
        previousFrameCandidates = frameCandidates;
        if (finished) return;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }, { once: true, capture: true });
  }, { targetPath: target.path, heading: target.heading, headingIncludes: target.headingIncludes });
  return marks;
}

async function measure(page, device, transition) {
  const link = transition.selector(page);
  await link.waitFor({ state: "visible", timeout: 30_000 });
  const marks = await armMarkers(page, transition.target, link);
  const urlWait = page.waitForURL((url) => url.pathname === transition.target.path, { timeout: 45_000 });
  if (device.isMobile) await link.tap(); else await link.click({ delay: 50 });
  await urlWait;
  const content = await waitForHeading(page, transition.target);
  const deadline = Date.now() + 300;
  while (marks.contentMs === null && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  if (!marks.trusted || !Number.isFinite(marks.urlMs) || !Number.isFinite(marks.contentMs)) throw new Error("Missing trusted pointerdown, destination URL, or visible-content timing marker");
  return {
    clickToFirstVisibleUiMs: [marks.pressedFeedbackMs, marks.loadingUiMs, marks.contentMs].filter(Number.isFinite).sort((a, b) => a - b)[0],
    clickToPressedFeedbackMs: marks.pressedFeedbackMs,
    clickToLoadingUiMs: marks.loadingUiMs,
    clickToUrlMs: marks.urlMs,
    clickToMeaningfulContentMs: marks.contentMs,
    meaningfulContentHeading: marks.contentText || content,
    trustedPointerDown: marks.trusted,
  };
}

async function checkKeyboardNavigation(device) {
  const { context, page } = await freshPage(device);
  try {
    await page.goto(origin + "/en/products", { waitUntil: "domcontentloaded" });
    await waitForHeading(page, { heading: "Browse LamiliaLomi books" });

    const productLink = page.getByRole("link", { name: /Cinderella/i });
    await productLink.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL((url) => url.pathname === `/en/products/${productSlug}`, { timeout: 45_000 });
    const productHeading = await waitForHeading(page, { headingIncludes: productTitleMatch });
    keyboardChecks.push({ device: device.id, transition: "Catalog → Product Detail", key: "Enter", result: productHeading });

    await returnToSource(page, "/en/products", { heading: "Browse LamiliaLomi books" });
    const libraryLink = page.locator('nav[aria-label="Primary navigation"]:visible').getByRole("link", { name: "My Library" });
    await libraryLink.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL((url) => url.pathname === "/en/library", { timeout: 45_000 });
    const libraryHeading = await waitForHeading(page, { heading: "My Library" });
    keyboardChecks.push({ device: device.id, transition: "Header → Library", key: "Enter", result: libraryHeading });
  } finally {
    await context.close().catch(() => {});
  }
}

async function returnToSource(page, route, heading) {
  const returned = page.waitForURL((url) => url.pathname === route, { timeout: 12_000 }).then(() => true).catch(() => false);
  try { await page.goBack({ waitUntil: "domcontentloaded", timeout: 12_000 }); } catch {}
  let method = "history-back";
  if (!(await returned) || new URL(page.url()).pathname !== route) {
    method = "source-reload-fallback";
    await page.goto(origin + route, { waitUntil: "domcontentloaded" });
  }
  await waitForHeading(page, heading);
  return method;
}

async function measureGroup(device, transition) {
  const accepted = [];
  let attempts = 0;
  for (; accepted.length < acceptedTarget && attempts < maxAttempts; attempts += 1) {
    const attempt = attempts + 1;
    let context;
    try {
      ({ context } = await freshPage(device));
      const page = context.pages()[0];
      await page.goto(origin + transition.source.path, { waitUntil: "domcontentloaded" });
      await waitForHeading(page, transition.source);
      await screenshot(page, device.id, transition.source.screenshot);
      const cold = await measure(page, device, transition);
      await screenshot(page, device.id, transition.target.path.split("/").pop() || "home");
      const returnMethod = await returnToSource(page, transition.source.path, transition.source);
      const warm = await measure(page, device, transition);
      accepted.push({ attempt, returnMethod, cold, warm });
    } catch (error) {
      rejectedAttempts.push({ device: device.id, transition: transition.id, attempt, error: String(error?.message || error).slice(0, 300) });
    } finally { if (context) await context.close().catch(() => {}); }
  }
  groups.push({ device: device.id, transition: transition.id, label: transition.label, acceptedPairs: accepted.length, attempts, accepted });
  if (accepted.length < acceptedTarget) throw new Error(`Only ${accepted.length}/${acceptedTarget} accepted pairs for ${device.id} ${transition.id}`);
}

let runError = null;
try {
  browser = await chromium.launch({ headless: true });
  const response = await fetch(origin + "/en", { redirect: "follow" });
  if (!response.ok || new URL(response.url).hostname !== "www.lamilialomi.com") throw new Error(`Production health check failed: ${response.status}`);
  healthSnapshot = {
    status: response.status,
    finalUrl: new URL(response.url).origin + new URL(response.url).pathname,
    headers: Object.fromEntries(["date", "x-vercel-id", "x-vercel-cache", "x-nextjs-cache", "cache-control", "age"].map((name) => [name, response.headers.get(name)])),
  };
  for (const device of devices) for (const transition of transitions) await measureGroup(device, transition);
  for (const device of devices) await checkKeyboardNavigation(device);
} catch (error) {
  runError = String(error?.message || error).slice(0, 500);
} finally {
  if (browser) await browser.close().catch(() => {});
}

const summary = summarizeGroups(groups);
const report = {
  runId,
  checkedAt: new Date().toISOString(),
  origin,
  sourceSha,
  runnerSha,
  vercelDeploymentId,
  githubDeploymentId,
  identityVerification: "sourceSha is the Production application SHA supplied after external verification; runnerSha identifies the local benchmark code; the Production deployment ID and source SHA must be confirmed externally immediately before/after the run",
  productionHealthResponse: healthSnapshot,
  runtime: "read-only anonymous guest navigation against the public Production origin",
  runtimeMetadata: { nodeVersion: process.version, chromiumVersion: browser?.version?.() ?? null, platform: `${os.platform()} ${os.release()}`, memoryAtRunCompletion: { totalBytes: os.totalmem(), freeBytes: os.freemem() } },
  method: {
    cold: "new isolated BrowserContext with fresh client cache and source loaded before activation; Next/server caches are not cleared and Link prefetch may populate the destination",
    warm: "same context after destination, browser Back to source, then repeated activation; source reload fallback is recorded",
    start: "trusted pointerdown on the actual visible semantic destination anchor",
    desktopPressDuration: "Playwright holds the desktop mouse button for 50 ms before release to model a brief physical press and allow a render opportunity; the timer still starts at trusted pointerdown. Pixel 7 uses a normal trusted tap.",
    firstVisibleUi: "minimum of a changed :active style, new visible loading UI, or destination H1 that is present in two consecutive requestAnimationFrame samples; the second sample is a conservative bound after a browser render opportunity, not a direct compositor timestamp",
    visibleFrameConfirmation: "Each candidate must remain the same element and satisfy visibility checks across two consecutive animation-frame callbacks. Timing is recorded on the second callback, which confirms the browser had an intervening render opportunity; a one-frame or transient style-state mutation is not counted as visible feedback.",
    loadingUi: "first new viewport-visible [aria-busy=true], [role=status], [data-testid*=loading], or [data-pending=true] whose computed opacity is at least 0.1; excludes screen-reader-only/clipped/pre-existing indicators",
    content: "first viewport-intersecting destination H1 matching the route expectation",
    repetitions: `${acceptedTarget} accepted cold/warm pairs per device and transition; up to ${maxAttempts} attempts; p95 uses nearest-rank empirical quantile`,
    interactionBoundary: "anonymous GET/navigation only; keyboard checks activate links with Enter; no account sign-in, Admin routes, forms, or writes",
  },
  devices: devices.map(({ id, label, viewport, deviceScaleFactor, isMobile, hasTouch }) => ({ id, label, viewport, deviceScaleFactor, isMobile, hasTouch })),
  transitions: transitions.map(({ id, label, source, target }) => ({ id, label, source, target })),
  blockedScope: ["Header → signed-in Account", "authenticated Admin navigation"],
  groups,
  summary,
  keyboardChecks,
  diagnostics,
  rejectedAttempts,
  runError,
  screenshotsDir: "screenshots",
};
fs.writeFileSync(path.join(outDir, "measurements.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ runId, outDir, sourceSha, runnerSha, vercelDeploymentId, githubDeploymentId, productionHealthResponse: healthSnapshot, summary, keyboardChecks, diagnostics: { consoleErrors: diagnostics.consoleErrors.length, pageErrors: diagnostics.pageErrors.length, sameOriginHttpErrors: diagnostics.sameOriginHttpErrors.length, requestFailures: diagnostics.requestFailures, rejectedAttempts: rejectedAttempts.length, screenshots: [...screenshots] }, runError }, null, 2));
if (runError) {
  console.error(`Production public measurement incomplete; partial evidence was saved: ${runError}`);
  process.exitCode = 1;
}
