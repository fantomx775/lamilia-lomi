import { expect, test, type ConsoleMessage, type Locator, type Page, type Request, type Response, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { communityFixtures, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";
import { NextCancellationObserver } from "./helpers/next-navigation-cancellations";

// Clean acceptance campaigns only. Injected503, transport abort and denial probes
// remain in their dedicated fault specs; none is relabeled harmless here.
test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });
const widths = [320, 375, 390, 430, 768, 1440] as const;
const longTitle = "UX127Proof A Quiet Collection of Garden Stories and Coloring Pages for Every Creative Afternoon with an ExtraordinarilyLongUnbrokenBookTitleThatMustWrapWithinTheCard";
type NavigationEvidence = Awaited<ReturnType<NextCancellationObserver["finish"]>>;
type Screenshot = { path: string; testedSha: string; runId: string };
type Check = { name: string; status: "PASS"; details: string };

function frozenHead() {
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "tests", "next.config.ts", "next.config.mjs", "playwright.config.ts", "package.json", "package-lock.json"], { encoding: "utf8" }).trim();
  if (dirty) throw new Error("Commit/freeze the exact application and test candidate before capturing primary browser evidence.");
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}
function safeUrl(raw: string) {
  try { const url = new URL(raw); return `${url.protocol}//${url.host}${url.pathname}`; } catch { return "[non-URL source]"; }
}

async function observePrimary(page: Page, info: TestInfo, campaign: string) {
  if (info.config.workers !== 1) throw new Error("Primary evidence uses exclusive --workers=1 for deterministic fixture layout and lifecycle.");
  const testedSha = frozenHead();
  if (info.project.use.baseURL !== COMMUNITY_TEST_ORIGIN || process.env.LAMILIA_BACKEND !== "supabase") throw new Error("Primary evidence requires the guarded exclusive local HTTPS Supabase application.");
  const runId = `ux127-primary-${campaign}-${info.project.name}-${randomUUID().slice(0, 8)}`;
  const project = info.project.name.replace(/[^a-z0-9-]/gi, "-");
  const observer = new NextCancellationObserver({ testedSha, runId, origin: COMMUNITY_TEST_ORIGIN });
  const secrets = new Set<string>();
  const sanitize = (message: string) => {
    let text = message;
    for (const value of secrets) if (value) text = text.split(value).join("[redacted]");
    return text.replace(/https?:\/\/[^\s]+/g, (url) => safeUrl(url)).replace(/(token|code|authorization|cookie)=([^\s&]+)/gi, "$1=[redacted]").slice(0, 1500);
  };
  const consoleErrors: Array<{ message: string; url: string }> = [];
  const pageErrors: Array<{ message: string }> = [];
  const activeRequests = new Set<Request>();
  const onRequest = (request: Request) => {
    const headers = request.headers();
    const prefetchedRsc = new URL(request.url()).origin === COMMUNITY_TEST_ORIGIN && request.resourceType() === "fetch" && headers.rsc === "1" && (headers["next-router-prefetch"] === "1" || Boolean(headers["next-router-segment-prefetch"]));
    if (!prefetchedRsc) activeRequests.add(request);
  };
  const onTerminal = (request: Request) => { activeRequests.delete(request); };
  const httpErrors: Array<{ url: string; path: string; method: string; statusCode: number }> = [];
  const onConsole = (message: ConsoleMessage) => { if (message.type() === "error") consoleErrors.push({ message: sanitize(message.text()), url: safeUrl(message.location().url) }); };
  const onPageError = (error: Error) => pageErrors.push({ message: sanitize(error.message) });
  const onResponse = (response: Response) => {
    if (response.status() >= 400) httpErrors.push({ url: safeUrl(response.url()), path: new URL(response.url()).pathname, method: response.request().method(), statusCode: response.status() });
  };
  page.on("request", onRequest); page.on("requestfinished", onTerminal); page.on("requestfailed", onTerminal);
  page.on("console", onConsole); page.on("pageerror", onPageError); page.on("response", onResponse);
  await observer.observe(page);
  await page.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
  const screenshots: Screenshot[] = [];
  const checks: Check[] = [];
  const decodedImages: Array<{ phase: string; images: Array<{ path: string; width: number; height: number }> }> = [];
  const check = (name: string, details: string) => checks.push({ name, status: "PASS", details });

  async function drain() {
    await expect.poll(() => activeRequests.size, { message: "Actual started non-prefetch requests must finish before viewport/route changes", timeout: 15_000 }).toBe(0);
  }

  async function capture(phase: string, mask: Locator[] = []) {
    if (!/^[a-z0-9-]+$/i.test(phase)) throw new Error("Unsafe evidence phase.");
    await page.evaluate(() => document.fonts.ready);
    const images = await page.locator("img").evaluateAll(async (nodes) => {
      const imageElements = nodes.map((element) => {
        if (!(element instanceof HTMLImageElement)) throw new Error("The image locator returned a non-image element.");
        return element;
      });
      const visible = imageElements.filter((element) => {
        const box = element.getBoundingClientRect(); const style = getComputedStyle(element);
        return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth && style.visibility !== "hidden" && style.display !== "none";
      });
      for (const element of visible) {
        await element.decode();
        if (!element.naturalWidth || !element.naturalHeight) throw new Error("Visible screenshot image has no decoded dimensions.");
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return visible.map((element) => { const source = new URL(element.currentSrc || element.src, location.href); return { path: ["http:", "https:"].includes(source.protocol) ? source.pathname : "[inline image]", width: element.naturalWidth, height: element.naturalHeight }; });
    });
    await drain();
    const relative = `docs/verification/issue-127/ux127-primary-${campaign}-${project}-${phase}.png`;
    await mkdir(path.dirname(path.resolve(relative)), { recursive: true });
    await page.screenshot({ path: relative, fullPage: false, animations: "disabled", caret: "hide", mask });
    screenshots.push({ path: relative, testedSha, runId }); decodedImages.push({ phase, images });
  }

  async function destination(expectedUrl: string, name: string) {
    await expect(page).toHaveURL(expectedUrl);
    await observer.assertDestination(page, { expectedUrl, assertions: [{ name, status: "PASS", details: "The actual trusted anchor reached its exact same-origin destination and its visible content assertions passed." }] });
  }

  async function finish(flowPassed: boolean, persistence: { status: "PASS" | "NOT APPLICABLE"; details: string }, responsiveLayouts: string[]) {
    let navigation: NavigationEvidence | undefined;
    let observationFailure: string | undefined;
    try { navigation = await observer.finish(); }
    catch (cause) { observationFailure = sanitize(cause instanceof Error ? cause.message : "Browser observation could not be finalized."); }
    finally { page.off("console", onConsole); page.off("pageerror", onPageError); page.off("response", onResponse); page.off("request", onRequest); page.off("requestfinished", onTerminal); page.off("requestfailed", onTerminal); }
    const headUnchanged = frozenHead() === testedSha;
    const clean = headUnchanged && !observationFailure && navigation?.unresolved.length === 0 && consoleErrors.length === 0 && pageErrors.length === 0 && httpErrors.length === 0;
    const automatedStatus = flowPassed && clean ? "PASS" : "FAIL";
    const browser = {
      status: automatedStatus, tool: "Playwright", testedSha, runId, origin: COMMUNITY_TEST_ORIGIN,
      flows: [campaign], screenshots, responsiveLayouts, persistence,
      // A real visual inspection by QA must replace this before v1 publication.
      screenshotReview: { status: "NOT RUN", details: "Screenshots were captured after actual decode; QA must inspect these exact current-head artifacts visually before publishing the harness record." },
      retestedAfterFixes: false,
      consoleErrors, pageErrors, failedNetworkRequests: navigation?.failedNetworkRequests ?? null,
      expectedNextCancellations: navigation?.expectedNextCancellations ?? null,
      closedPrefetches: navigation?.closedPrefetches ?? null,
      expectedNavigationCancellations: navigation?.expectedNavigationCancellations ?? null,
      expectedLoginRedirects: navigation?.expectedLoginRedirects ?? null,
    };
    const manifest = { schemaVersion: 1, campaign, testedSha, runId, automatedStatus, harnessReady: false,
      remainingManualSteps: ["Inspect the exact screenshots visually", "Confirm this run is the required final retest after fixes", "Commit stable screenshot artifacts and publish the full current-SHA v1 verification record"],
      browser, checks, decodedImages, httpErrors, observationFailure, headUnchanged,
      physicalDevices: { status: "NOT RUN", details: "Playwright Chromium/WebKit with resized viewports is emulation, not a physical iPhone/Android." } };
    const directory = path.resolve(".task/ux127/runtime-manifests"); await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `ux127-primary-${campaign}-${project}.json`), JSON.stringify(manifest, null, 2));
    if (flowPassed) {
      expect(headUnchanged).toBe(true); expect(observationFailure).toBeUndefined(); expect(navigation?.unresolved).toEqual([]);
      expect(consoleErrors).toEqual([]); expect(pageErrors).toEqual([]); expect(httpErrors).toEqual([]);
    }
  }
  return { observer, secrets, check, capture, destination, drain, finish };
}

async function expectDocumentFits(page: Page) {
  const overflow = await page.evaluate(() => ({ width: innerWidth, contentWidth: document.documentElement.scrollWidth }));
  expect(overflow.contentWidth).toBeLessThanOrEqual(overflow.width + 1);
}

async function expectFocusableOutline(control: Locator) {
  await expect(control).toBeFocused();
  const outline = await control.evaluate((element) => ({ width: parseFloat(getComputedStyle(element).outlineWidth), style: getComputedStyle(element).outlineStyle }));
  expect(outline.width).toBeGreaterThanOrEqual(2); expect(outline.style).not.toBe("none");
}

test("clean primary responsive long-title navigation, keyboard and reduced-motion evidence", async ({ page }, info) => {
  test.skip(process.env.RUN_ISSUE_127_BROWSER_EVIDENCE !== "1", "Requires the frozen final candidate and guarded isolated local HTTPS app.");
  test.setTimeout(180_000);
  const evidence = await observePrimary(page, info, "responsive-navigation");
  const fixture = await communityFixtures(info, evidence.observer);
  let passed = false;
  let coverPath: string | undefined;
  try {
    const book = await fixture.product(longTitle);
    const coverId = randomUUID(); coverPath = `products/${book.id}/cover/${coverId}-proof.webp`;
    const coverBytes = await sharp({ create: { width: 850, height: 1100, channels: 3, background: "#b9c7ac" } }).webp({ quality: 90 }).toBuffer();
    expect((await fixture.service.storage.from("public-media").upload(coverPath, coverBytes, { contentType: "image/webp" })).error).toBeNull();
    expect((await fixture.service.from("product_assets").insert({ id: coverId, product_id: book.id, kind: "cover", bucket: "public-media", path: coverPath, filename: "proof.webp", content_type: "image/webp", size_bytes: coverBytes.length, title: "Controlled garden cover", is_public: true, is_active: true, storage_provider: "supabase" })).error).toBeNull();
    expect((await fixture.service.from("products").update({ cover_asset_id: coverId }).eq("id", book.id)).error).toBeNull();
    const catalogUrl = `${COMMUNITY_TEST_ORIGIN}/en/products?q=UX127Proof`;
    await page.goto(catalogUrl);
    const card = page.locator(`#catalog-product-${book.id}`);
    const title = card.locator("[data-product-card-title]");
    await expect(title).toHaveText(longTitle);
    for (const width of widths) {
      await evidence.drain();
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await title.scrollIntoViewIfNeeded();
      await expectDocumentFits(page);
      const titleGeometry = await title.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, viewport: innerWidth, clipped: element.scrollHeight > element.clientHeight + 1, clamp: getComputedStyle(element).webkitLineClamp };
      });
      expect(titleGeometry.left).toBeGreaterThanOrEqual(0); expect(titleGeometry.right).toBeLessThanOrEqual(width + 1);
      expect(titleGeometry.clipped).toBe(false); expect(titleGeometry.clamp).not.toMatch(/^[1-9]\d*$/);
      await expect(page.getByText("Read full title", { exact: true })).toHaveCount(0);
      await evidence.capture(`catalog-w${width}`);
      if (width < 1024) {
        const opener = page.getByRole("button", { name: "Open navigation menu", exact: true });
        await opener.scrollIntoViewIfNeeded();
        const target = await opener.boundingBox(); expect(target!.width).toBeGreaterThanOrEqual(44); expect(target!.height).toBeGreaterThanOrEqual(44);
        await opener.focus(); await page.keyboard.press("Enter");
        const menu = page.getByRole("dialog", { name: "Mobile primary navigation", exact: true });
        await expect(menu).toBeVisible();
        await expectFocusableOutline(menu.getByRole("button", { name: "Close navigation menu", exact: true }));
        expect(await menu.evaluate((element) => element.getAnimations().length)).toBe(0);
        await page.keyboard.press("Tab");
        expect(await menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
        await expectDocumentFits(page);
        if ([320, 390, 768].includes(width)) await evidence.capture(`keyboard-menu-w${width}`);
        await page.keyboard.press("Escape"); await expect(menu).toBeHidden(); await expect(opener).toBeFocused();
        expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
      } else {
        await expect(page.getByRole("navigation", { name: "Primary navigation", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeHidden();
      }
      evidence.check(`responsive ${width}`, "Full controlled long title wraps without clipping or document overflow; actual responsive controls, keyboard focus and reduced-motion menu assertions passed.");
    }
    await evidence.drain();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await card.getByRole("link").focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
    await expectFocusableOutline(card.getByRole("link"));
    const productHref = await card.getByRole("link").getAttribute("href");
    await evidence.drain();
    await card.getByRole("link").click();
    await expect(page.getByTestId("product-hero").getByRole("heading", { name: longTitle, exact: true })).toBeVisible();
    await evidence.destination(new URL(productHref!, COMMUNITY_TEST_ORIGIN).href, "real book destination");
    await evidence.capture("product-after-navigation");
    const back = page.getByRole("link", { name: "Back to catalog", exact: true }); const returnHref = await back.getAttribute("href");
    await evidence.drain();
    await back.click(); await expect(title).toBeVisible();
    await evidence.destination(new URL(returnHref!, COMMUNITY_TEST_ORIGIN).href, "validated catalog return");
    const about = page.getByRole("navigation", { name: "Primary navigation", exact: true }).getByRole("link", { name: "About", exact: true });
    await evidence.drain();
    await about.click(); await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await evidence.destination(`${COMMUNITY_TEST_ORIGIN}/en/about`, "public About destination");
    await evidence.capture("about-clean");
    evidence.check("real anchor journeys", "Controlled catalog -> product -> validated result return -> About rendered successfully; typed observer binds trusted anchor destinations.");
    passed = true;
  } finally {
    try { await evidence.finish(passed, { status: "NOT APPLICABLE", details: "This clean campaign is read-only UI navigation; controlled product creation/cleanup is fixture setup. Mutation persistence is covered by the separate real account-toast campaign and existing domain suites." }, widths.map((width) => `${width}px viewport, Chromium/WebKit emulation as selected by project, reduced motion, keyboard/focus and overflow checked`)); }
    finally {
      if (coverPath) expect((await fixture.service.storage.from("public-media").remove([coverPath])).error).toBeNull();
      await fixture.cleanup();
    }
  }
});

test("clean primary real success toast wraps at320, survives modal keyboard focus and persists its operation", async ({ page }, info) => {
  test.skip(process.env.RUN_ISSUE_127_BROWSER_EVIDENCE !== "1", "Requires real isolated Auth/DB, Club ON and frozen candidate.");
  test.setTimeout(120_000);
  const evidence = await observePrimary(page, info, "toast-modal");
  const fixture = await communityFixtures(info, evidence.observer);
  let passed = false;
  let persistencePassed = false;
  try {
    const actor = await fixture.actor("primary-toast"); evidence.secrets.add(actor.email); evidence.secrets.add(actor.password);
    await page.setViewportSize({ width: 320, height: 900 }); await page.emulateMedia({ reducedMotion: "reduce" });
    await fixture.login(page, actor, "/en/account");
    const panel = page.getByTestId("community-account-panel");
    const username = `ux127_ui_${info.project.name.replace(/[^a-z0-9]/gi, "").slice(0, 10)}`;
    await panel.getByLabel("Public username", { exact: true }).fill(username);
    await panel.getByRole("checkbox", { name: /I confirm that I am 18 years or older/ }).check();
    await panel.getByRole("checkbox", { name: /I accept the current community guidelines/ }).check();
    const joined = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/community/join" && response.request().method() === "POST");
    await panel.getByRole("button", { name: "Join the Coloring Club", exact: true }).click();
    expect((await joined).status()).toBe(201);
    const toast = page.locator("[data-toast-region] [data-toast-id]");
    await expect(toast).toHaveText(/You joined the Coloring Club. Your artwork stays private until approved./);
    await expect(toast).toHaveAttribute("role", "status"); await expect(toast).toHaveAttribute("aria-live", "polite");
    await expectDocumentFits(page);
    const toastBounds = await toast.boundingBox(); expect(toastBounds!.x).toBeGreaterThanOrEqual(0); expect(toastBounds!.x + toastBounds!.width).toBeLessThanOrEqual(321);
    const textBounds = await toast.locator("p").boundingBox(); expect(textBounds!.height).toBeGreaterThan(24);
    expect(await toast.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await toast.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
    await evidence.capture("join-success-w320", [page.getByText(actor.email, { exact: true })]);
    // Opening the real native menu after a real accepted mutation exercises the
    // top-layer/portal lifecycle without a fabricated provider or UI toast hook.
    await page.getByRole("button", { name: "Open navigation menu", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "Mobile primary navigation", exact: true }); await expect(menu).toBeVisible();
    await expect(menu.locator("[data-toast-id]")).toHaveCount(1);
    const closeMenu = menu.getByRole("button", { name: "Close navigation menu", exact: true }); await closeMenu.focus();
    await page.keyboard.press("Shift+Tab");
    const dismiss = toast.getByRole("button", { name: "Dismiss notification", exact: true }); await expectFocusableOutline(dismiss);
    await page.waitForTimeout(6500); // Real elapsed reading time, not a performance metric.
    await expect(toast).toBeVisible(); await expect(toast).not.toHaveAttribute("data-closing");
    await evidence.capture("toast-focused-in-modal-w320");
    await page.keyboard.press("Escape"); await expect(menu).toBeHidden();
    await expect(toast).toBeVisible(); await evidence.capture("toast-after-modal-close-w320", [page.getByText(actor.email, { exact: true })]);
    await dismiss.click(); await expect(toast).toHaveCount(0);
    const membership = await fixture.service.from("community_profiles").select("rules_version,adult_attested_at,opted_in_at").eq("user_id", actor.id).single();
    expect(membership.error).toBeNull(); expect(membership.data?.adult_attested_at).toBeTruthy(); expect(membership.data?.opted_in_at).toBeTruthy();
    await evidence.drain();
    await page.reload(); await expect(panel.getByRole("heading", { name: "Coloring Club profile", exact: true })).toBeVisible();
    const marketing = page.getByRole("checkbox", { name: "I agree to receive marketing emails.", exact: true }); await marketing.check();
    const save = page.getByRole("button", { name: "Save preferences", exact: true });
    const saveOnce = async () => {
      const accepted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/account/marketing-consent" && response.request().method() === "POST");
      await save.click(); const response = await accepted; expect(response.status()).toBe(200); expect(await response.json()).toMatchObject({ ok: true, marketingConsent: true });
      await expect(toast).toContainText("Your marketing preference has been saved.");
      return toast.getAttribute("data-toast-id");
    };
    const firstId = await saveOnce(); const secondId = await saveOnce(); expect(secondId).not.toBe(firstId);
    const preference = await fixture.service.from("profiles").select("marketing_consent").eq("id", actor.id).single(); expect(preference.error).toBeNull(); expect(preference.data?.marketing_consent).toBe(true);
    await toast.getByRole("button", { name: "Dismiss notification", exact: true }).click(); await expect(toast).toHaveCount(0);
    await evidence.drain();
    await page.reload(); await expect(marketing).toBeChecked();
    persistencePassed = true;
    evidence.check("real wrapped toast/modal", "Accepted real community join produced the long polite success at320px, no clipping/overflow, reduced-motion style, operable native-modal portal, focus pause beyond6seconds and survival after modal close.");
    evidence.check("repeated real success and persistence", "Two actual marketing preference POST200 responses produced distinct toast event IDs; isolated DB readback and reload matched true consent. No external messages were sent.");
    passed = true;
  } finally {
    try { await evidence.finish(passed, { status: persistencePassed ? "PASS" : "NOT APPLICABLE", details: persistencePassed ? "Actual isolated community membership and marketing preference were confirmed with direct DB readback plus authenticated page reload; the manifest retains no account identity, credentials or response bodies." : "The flow did not reach completed persistence assertions; automated browser status is FAIL, not verified acceptance." }, ["320px viewport, reduced motion, real native-modal focus and long-toast wrapping checked"]); }
    finally { await fixture.cleanup(); }
  }
});
