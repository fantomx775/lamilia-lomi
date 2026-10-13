import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const origin = process.env.LL_NAV_PREVIEW_ORIGIN;
const cookieName = process.env.LL_NAV_COOKIE_NAME;
const cookieValue = process.env.LL_NAV_COOKIE_VALUE;
const outputRoot = process.env.LL_NAV_OUTPUT;
if (!origin || !cookieName || !cookieValue || !outputRoot) {
  throw new Error("Set LL_NAV_PREVIEW_ORIGIN, LL_NAV_COOKIE_NAME, LL_NAV_COOKIE_VALUE, and LL_NAV_OUTPUT.");
}

const previewSha = "30cac2578cdaf392f80e259f05ef933ad8bbe2d4";
const productSlug = "https-www-amazon-com-dp-b0h8tttsny";
const acceptedTarget = 5;
const maxAttempts = 8;
const runId = `navigation-after-${previewSha.slice(0, 7)}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const outDir = path.join(outputRoot, runId);
const screenshotsDir = path.join(outDir, "screenshots");
fs.mkdirSync(screenshotsDir, { recursive: true });

const devices = [
  {
    id: "desktop",
    label: "Chromium desktop",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  {
    id: "pixel7",
    label: "Pixel 7 emulation",
    viewport: { width: 412, height: 839 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  },
];

const transitions = [
  {
    id: "home_to_catalog",
    label: "Home -> Catalog",
    source: { path: "/en", h1: "LamiliaLomi" },
    target: { path: "/en/products", h1: "Browse LamiliaLomi books" },
    selector: (page) => page.getByRole("link", { name: "Browse catalog", exact: true }),
  },
  {
    id: "catalog_to_detail",
    label: "Catalog -> Product Detail",
    source: { path: "/en/products", h1: "Browse LamiliaLomi books" },
    target: { path: `/en/products/${productSlug}`, h1: "Cinderella" },
    selector: (page) => page.getByRole("link", { name: /Cinderella/i }),
  },
  {
    id: "detail_to_catalog",
    label: "Product Detail -> Catalog",
    source: { path: `/en/products/${productSlug}`, h1: "Cinderella" },
    target: { path: "/en/products", h1: "Browse LamiliaLomi books" },
    selector: (page) =>
      page
        .locator('nav[aria-label="Primary navigation"]:visible')
        .getByRole("link", { name: "Catalog", exact: true }),
  },
];

const diagnostic = {
  consoleErrors: [],
  pageErrors: [],
  sameOriginHttpErrors: [],
  requestFailures: {},
  observedRequests: 0,
};
const screenshots = new Set();
const rejectedAttempts = [];
const allGroups = [];
const clickClocks = new WeakMap();
const browser = await chromium.launch({ headless: true });

async function waitForHeading(page, text) {
  await page
    .getByRole("heading", { level: 1, name: text })
    .waitFor({ state: "visible", timeout: 60_000 });
}

function installDiagnostics(page) {
  page.on("console", (message) => {
    if (message.type() === "error" && diagnostic.consoleErrors.length < 100) {
      diagnostic.consoleErrors.push({
        text: message.text().slice(0, 300),
        url: message.location().url,
      });
    }
  });
  page.on("pageerror", (error) => {
    if (diagnostic.pageErrors.length < 100) {
      diagnostic.pageErrors.push(error.message.slice(0, 300));
    }
  });
  page.on("response", (response) => {
    diagnostic.observedRequests += 1;
    if (
      response.url().startsWith(origin) &&
      response.status() >= 400 &&
      diagnostic.sameOriginHttpErrors.length < 200
    ) {
      diagnostic.sameOriginHttpErrors.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
    }
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText || "request failed";
    diagnostic.requestFailures[reason] = (diagnostic.requestFailures[reason] || 0) + 1;
  });
}

async function captureScreenshot(page, deviceId, pageId) {
  const key = `${deviceId}-${pageId}`;
  if (screenshots.has(key)) return;
  await page.screenshot({
    path: path.join(screenshotsDir, `${deviceId}-${pageId}.png`),
    fullPage: true,
  });
  screenshots.add(key);
}

async function measureClick(page, device, transition) {
  let clock = clickClocks.get(page);
  if (!clock) {
    clock = { active: null };
    await page.exposeFunction("__llNavPointerDown", (trusted) => {
      if (clock.active && clock.active.startedAt === null) {
        clock.active.startedAt = performance.now();
        clock.active.trusted = Boolean(trusted);
      }
    });
    clickClocks.set(page, clock);
  }
  clock.active = { startedAt: null, trusted: false };
  const active = clock.active;
  const link = transition.selector(page);
  await link.waitFor({ state: "visible", timeout: 30_000 });
  await link.evaluate((element) => {
    element.addEventListener(
      "pointerdown",
      (event) => window.__llNavPointerDown(event.isTrusted),
      { once: true, capture: true },
    );
  });

  const urlPromise = page.waitForURL((url) => url.pathname === transition.target.path, {
    timeout: 60_000,
  });
  if (device.isMobile) {
    await link.tap({ timeout: 30_000 });
  } else {
    await link.click({ timeout: 30_000 });
  }
  await urlPromise;
  if (!active || active.startedAt === null) {
    throw new Error("trusted pointerdown timestamp was not captured");
  }
  const clickToUrlMs = performance.now() - active.startedAt;
  await waitForHeading(page, transition.target.h1);
  const clickToH1Ms = performance.now() - active.startedAt;

  return {
    clickToUrlMs: Number(clickToUrlMs.toFixed(1)),
    clickToH1Ms: Number(clickToH1Ms.toFixed(1)),
    trustedPointerDown: active.trusted,
    finalPath: new URL(page.url()).pathname,
  };
}

async function createContext(device) {
  const context = await browser.newContext({
    viewport: device.viewport,
    screen: device.viewport,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
  });
  await context.addCookies([
    {
      name: cookieName,
      value: cookieValue,
      url: origin,
    },
  ]);
  await context.addInitScript(() => {
    try {
      localStorage.setItem(
        "ll_cookie_consent",
        JSON.stringify({ essential: true, analytics: false }),
      );
    } catch {
      // localStorage is unavailable on non-app origins.
    }
  });
  return context;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length ? Number(sorted[Math.floor(sorted.length / 2)].toFixed(1)) : null;
}

try {
  for (const device of devices) {
    for (const transition of transitions) {
      const accepted = [];
      let attempt = 0;
      for (; accepted.length < acceptedTarget && attempt < maxAttempts; attempt += 1) {
        const attemptNumber = attempt + 1;
        let context = null;
        try {
          context = await createContext(device);
          const page = await context.newPage();
          page.setDefaultTimeout(45_000);
          page.setDefaultNavigationTimeout(45_000);
          installDiagnostics(page);
          await page.goto(origin + transition.source.path, {
            waitUntil: "domcontentloaded",
            timeout: 60_000,
          });
          if (new URL(page.url()).host !== new URL(origin).host) {
            const finalUrl = new URL(page.url());
            throw new Error(`Preview access redirected to ${finalUrl.host}${finalUrl.pathname}`);
          }
          await waitForHeading(page, transition.source.h1);

          const sourceShot =
            transition.source.path === "/en"
              ? "home"
              : transition.source.path === "/en/products"
                ? "catalog"
                : "product-detail";
          await captureScreenshot(page, device.id, sourceShot);

          const cold = await measureClick(page, device, transition);
          if (transition.target.path === "/en/products") {
            await captureScreenshot(page, device.id, "catalog");
          }
          if (transition.target.path.startsWith("/en/products/") && transition.target.path !== "/en/products") {
            await captureScreenshot(page, device.id, "product-detail");
          }

          const backPromise = page
            .waitForURL((url) => url.pathname === transition.source.path, { timeout: 12_000 })
            .then(() => true)
            .catch(() => false);
          try {
            await page.goBack({ waitUntil: "domcontentloaded", timeout: 12_000 });
          } catch {
            // Browser Back can time out for a same-document App Router transition.
          }
          const backRestored = await backPromise;
          let returnMethod = "history-back";
          if (!backRestored || new URL(page.url()).pathname !== transition.source.path) {
            returnMethod = "source-reload-fallback";
            await page.goto(origin + transition.source.path, {
              waitUntil: "domcontentloaded",
              timeout: 60_000,
            });
          }
          if (new URL(page.url()).pathname !== transition.source.path) {
            throw new Error("could not restore source route for warm sample");
          }
          await waitForHeading(page, transition.source.h1);
          const warm = await measureClick(page, device, transition);
          accepted.push({ attempt: attemptNumber, returnMethod, cold, warm });
        } catch (error) {
          const message = String(error.message || error).slice(0, 300);
          rejectedAttempts.push({
            device: device.id,
            transition: transition.id,
            attempt: attemptNumber,
            error: message,
          });
          if (message.includes("Preview access redirected")) throw error;
        } finally {
          if (context) await context.close().catch(() => {});
        }
      }
      allGroups.push({
        device: device.id,
        transition: transition.id,
        label: transition.label,
        acceptedPairs: accepted.length,
        attempts: attempt,
        accepted,
      });
      if (accepted.length < acceptedTarget) {
        throw new Error(`Only ${accepted.length}/${acceptedTarget} accepted pairs for ${device.id} ${transition.id}`);
      }
    }
  }
} finally {
  await browser.close();
}

const baseline = {
  desktop: {
    home_to_catalog: { cold: 4269.9, warm: 2519.1 },
    catalog_to_detail: { cold: 2340.0, warm: 2529.3 },
    detail_to_catalog: { cold: 4448.7, warm: 3768.4 },
  },
  pixel7: {
    home_to_catalog: { cold: 2254.0, warm: 2904.1 },
    catalog_to_detail: { cold: 7877.8, warm: 16403.9 },
    detail_to_catalog: { cold: 3639.0, warm: 3265.9 },
  },
};

const summary = allGroups.map((group) => {
  const coldH1 = group.accepted.map((sample) => sample.cold.clickToH1Ms);
  const warmH1 = group.accepted.map((sample) => sample.warm.clickToH1Ms);
  const coldUrl = group.accepted.map((sample) => sample.cold.clickToUrlMs);
  const warmUrl = group.accepted.map((sample) => sample.warm.clickToUrlMs);
  const prior = baseline[group.device][group.transition];
  const coldMedian = median(coldH1);
  const warmMedian = median(warmH1);
  return {
    device: group.device,
    transition: group.transition,
    acceptedPairs: group.acceptedPairs,
    coldClickToH1MedianMs: coldMedian,
    warmClickToH1MedianMs: warmMedian,
    coldClickToUrlMedianMs: median(coldUrl),
    warmClickToUrlMedianMs: median(warmUrl),
    baselineColdClickToH1MedianMs: prior.cold,
    baselineWarmClickToH1MedianMs: prior.warm,
    coldDeltaPercent: Number((((coldMedian - prior.cold) / prior.cold) * 100).toFixed(1)),
    warmDeltaPercent: Number((((warmMedian - prior.warm) / prior.warm) * 100).toFixed(1)),
    coldRawMs: coldH1,
    warmRawMs: warmH1,
    sourceReturnFallbacks: group.accepted.filter((sample) => sample.returnMethod !== "history-back").length,
  };
});

const report = {
  runId,
  checkedAt: new Date().toISOString(),
  previewUrl: origin,
  previewSha,
  baselineRunId: "navigation-baseline-2026-10-13T22-12-38-127Z",
  browser: "Playwright Chromium headless",
  throttling: "none",
  method: {
    cold: "fresh isolated BrowserContext per trial; Next Link prefetch left enabled",
    warm: "same context after cold navigation and browser Back; source reload fallback flagged",
    start: "trusted mouse/touch pointerdown on semantic link",
    url: "destination pathname committed",
    content: "first visible expected destination H1",
    repetitions: "5 accepted cold/warm pairs per device and route; up to 8 attempts",
  },
  devices: devices.map(({ id, label, viewport, deviceScaleFactor, isMobile, hasTouch }) => ({
    id,
    label,
    viewport,
    deviceScaleFactor,
    isMobile,
    hasTouch,
  })),
  groups: allGroups,
  summary,
  diagnostic,
  rejectedAttempts,
  screenshotsDir,
};
fs.writeFileSync(path.join(outDir, "measurements.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      runId,
      outDir,
      summary,
      diagnostics: {
        consoleErrors: diagnostic.consoleErrors.length,
        pageErrors: diagnostic.pageErrors.length,
        sameOriginHttpErrors: diagnostic.sameOriginHttpErrors.length,
        requestFailures: diagnostic.requestFailures,
        rejectedAttempts: rejectedAttempts.length,
        screenshots: [...screenshots],
      },
    },
    null,
    2,
  ),
);
