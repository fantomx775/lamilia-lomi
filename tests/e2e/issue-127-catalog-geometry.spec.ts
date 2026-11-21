import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSeedContentSnapshot } from "../../src/lib/local-content";
import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test.use({ trace: "off", screenshot: "off", video: "off" });

const sourcePaths = [
  "src",
  "tests",
  "scripts",
  "public",
  "messages",
  "supabase",
  "package.json",
  "package-lock.json",
  "AGENTS.md",
  "next-env.d.ts",
  "next.config.*",
  "postcss.config.*",
  "tailwind.config.*",
  "eslint.config.*",
  "playwright.config.ts",
  "playwright.ux127-local.config.ts",
  "tsconfig.json",
];

function sourceSnapshot() {
  return {
    sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    dirty: execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ...sourcePaths], { encoding: "utf8" }).trim(),
  };
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element | null) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    const visibleControls = [...document.querySelectorAll('[data-testid="catalog-mobile-search"],[data-testid="catalog-desktop-filters"]')].find((element) => element.getBoundingClientRect().height > 0);
    const grid = document.querySelector('[data-testid="product-catalog-grid"]');
    const gridColumns = grid ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length : null;
    return { heading: box(document.querySelector('[data-testid="catalog-heading"]')), categories: box(document.querySelector('[aria-label="Categories"]')), controls: box(visibleControls ?? null), cover: box(document.querySelector('[data-testid="catalog-result-skeleton-cover"]') ?? grid?.querySelector('article a > div') ?? null), gridColumns };
  });
}
function sameGeometry(before: Awaited<ReturnType<typeof geometry>>, after: Awaited<ReturnType<typeof geometry>>) {
  for (const field of ["heading", "categories", "controls", "cover"] as const) {
    if (!before[field] || !after[field]) { expect(after[field]).toEqual(before[field]); continue; }
    for (const dimension of ["x", "y", "width", "height"] as const) expect(Math.abs(before[field]![dimension] - after[field]![dimension]), `${field}.${dimension}`).toBeLessThanOrEqual(1);
  }
}

test("R5 F10 actual 0/1/7-category shell and 3/4/5-column results keep measured geometry", async ({ page }, info) => {
  test.skip(process.env.RUN_ISSUE_127_CATALOG_GEOMETRY_E2E !== "1", "Requires exclusive verified local-demo dev app with catalogue result delay enabled.");
  test.setTimeout(240_000);
  if (info.config.workers !== 1) throw new Error("Catalog fixture requires --workers=1.");
  const loadingDelayMs = Number(process.env.LAMILIA_TEST_CATALOG_LOADING_DELAY_MS);
  if (!Number.isSafeInteger(loadingDelayMs) || loadingDelayMs < 1000) {
    throw new Error("Configure the existing dev-only catalogue result delay in app and runner for observable pending; never use a Production delay.");
  }
  if (!(await isLocalDemoAppTarget(page, info.project.use.baseURL))) throw new Error("Refusing to change a content fixture outside verified local-demo mode.");
  const sourceAtStart = sourceSnapshot();
  if (sourceAtStart.dirty) throw new Error("Catalog geometry evidence requires a clean tracked source/config tree.");
  const testedSha = sourceAtStart.sha;
  const runId = process.env.UX127_RUN_ID?.trim() || `catalog-geometry-${testedSha.slice(0, 12)}-${randomUUID()}`;
  const browserDiagnostics = {
    runId,
    testedSha,
    consoleErrors: [] as string[],
    pageErrors: [] as string[],
    failedRequests: [] as Array<Record<string, unknown>>,
    committedRouteCancellations: [] as Array<Record<string, unknown>>,
    catalogRequests: [] as Array<Record<string, unknown>>,
    catalogCaseResults: [] as Array<Record<string, unknown>>,
    unclassifiedRequestFailures: [] as Array<Record<string, unknown>>,
    serverErrors: [] as string[],
    sourceIntegrity: null as null | {
      testedSha: string;
      finishedSha: string;
      cleanAtStart: boolean;
      cleanAtFinish: boolean;
      matchesHead: boolean;
    },
  };
  let currentCase = "setup";
  let currentPhase = "setup";
  const requestMetadata = new WeakMap<object, Record<string, unknown>>();
  page.on("console", (message) => {
    if (message.type() === "error") browserDiagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserDiagnostics.pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    const headers = request.headers();
    const metadata: Record<string, unknown> = {
      case: currentCase,
      phase: currentPhase,
      method: request.method(),
      pathname: url.pathname,
      hasSearchQuery: url.searchParams.has("q"),
      searchQuery: url.searchParams.get("q"),
      resourceType: request.resourceType(),
      isNavigationRequest: request.isNavigationRequest(),
      isRscRequest: headers.rsc === "1",
      isPrefetchRequest: headers["next-router-prefetch"] === "1",
      isHmrRefresh: headers["next-hmr-refresh"] === "1",
    };
    requestMetadata.set(request, metadata);
    if (metadata.pathname === "/en/products" && metadata.hasSearchQuery && metadata.isRscRequest) {
      browserDiagnostics.catalogRequests.push(metadata);
    }
  });
  page.on("response", (response) => {
    const metadata = requestMetadata.get(response.request());
    if (metadata) Object.assign(metadata, { responseStatus: response.status(), contentType: response.headers()["content-type"] ?? null });
  });
  page.on("requestfinished", (request) => {
    const metadata = requestMetadata.get(request);
    if (metadata) metadata.finished = true;
  });
  page.on("requestfailed", (request) => {
    const metadata = requestMetadata.get(request) ?? {};
    const failure = request.failure()?.errorText ?? "request failed";
    browserDiagnostics.failedRequests.push({
      ...metadata,
      failure,
      observedDuring: { case: currentCase, phase: currentPhase },
      urlAtFailure: page.url(),
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      browserDiagnostics.serverErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  await page.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
  const release = await acquireLocalContentStoreLock();
  const filename = path.resolve("data/lamilialomi-content.local.json");
  const previous = fs.existsSync(filename) ? fs.readFileSync(filename) : undefined;
  try {
    for (const categoryCount of [0, 1, 7]) for (const desktopColumns of [3, 4, 5] as const) {
      const snapshot = getSeedContentSnapshot();
      snapshot.products = snapshot.products.slice(0, 2);
      snapshot.categories = Array.from({ length: categoryCount }, (_, index) => ({ id: `ux127-category-${index}`, slug: `ux127-category-${index}`, sortOrder: index, translations: [{ locale: "en", name: `Category ${index + 1}` }] }));
      for (const product of snapshot.products) product.categoryIds = snapshot.categories.slice(0, 1).map((item) => item.id);
      snapshot.catalogSettings.desktopColumns = desktopColumns;
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, JSON.stringify(snapshot), "utf8");
      for (const width of [390, 768, 1024, 1440]) {
        currentCase = `c${categoryCount}-cols${desktopColumns}-w${width}`;
        currentPhase = "navigation";
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(`/en/products?ux127case=${categoryCount}-${desktopColumns}-${width}`, { waitUntil: "commit" });
        await expect(page.getByTestId("product-catalog-opening")).toHaveCount(0);
        const grid = page.getByTestId("product-catalog-grid");
        await expect(grid).toBeVisible();
        await expect(grid.locator("article")).toHaveCount(2);
        await expect(page.getByTestId("catalog-category-list")).toHaveCount(categoryCount ? 1 : 0);
        if (categoryCount) await expect(page.locator('[data-testid^="catalog-category-ux127-category-"]')).toHaveCount(categoryCount);
        await page.evaluate(() => document.fonts.ready);
        const before = await geometry(page);
        const expectedGridColumns = width >= 1280 ? desktopColumns : width >= 1024 ? 3 : width >= 640 ? 2 : 1;
        expect(before.gridColumns, `configured catalog columns at ${width}px`).toBe(expectedGridColumns);
        const phase = `r5-c${categoryCount}-cols${desktopColumns}-w${width}`;
        await page.screenshot({
          path: info.outputPath(`${phase}-before.png`),
          animations: "disabled",
          caret: "initial",
          style: "nextjs-portal { display: none !important; }",
        });
        // Native documents resolve critical content before sending it. Enhanced
        // GET transitions keep the actual result grid and shell while pending.
        const form = page.getByTestId(width < 768 ? "catalog-mobile-search" : "catalog-desktop-filters");
        const initialProductTitle = snapshot.products[0].translations.find((item) => item.locale === "en")!.title;
        const productTitle = snapshot.products[1].translations.find((item) => item.locale === "en")!.title;
        await expect(grid).toContainText(initialProductTitle);
        await expect(grid).toContainText(productTitle);
        const searchInput = form.getByRole("textbox", { name: "Search catalog" });
        await searchInput.fill(productTitle);
        const submitted = await geometry(page);
        expect(submitted.gridColumns, `catalog columns while submitting at ${width}px`).toBe(expectedGridColumns);
        const pendingIndicator = form.locator('[data-catalog-form-pending="true"]');
        currentPhase = "catalog-submit";
        const pendingFeedback = expect(pendingIndicator).toBeVisible();
        const results = page.getByTestId("catalog-results-region");
        const busyFeedback = expect(results).toHaveAttribute("aria-busy", "true");
        await searchInput.press("Enter");
        await Promise.all([pendingFeedback, busyFeedback]);
        currentPhase = "catalog-pending";
        await expect(grid).toBeVisible();
        await expect(grid.locator("article")).toHaveCount(2);
        await expect(grid).toContainText(initialProductTitle);
        await expect(grid).toContainText(productTitle);
        await expect(page.getByTestId("product-catalog-loading")).toHaveCount(0);
        const pending = await geometry(page);
        expect(pending.gridColumns, `catalog columns while pending at ${width}px`).toBe(expectedGridColumns);
        sameGeometry(submitted, pending);
        await page.screenshot({
          path: info.outputPath(`${phase}-pending.png`),
          animations: "disabled",
          caret: "initial",
          style: "nextjs-portal { display: none !important; }",
        });
        await expect(results).not.toHaveAttribute("aria-busy", "true");
        await expect(pendingIndicator).toHaveCount(0);
        await expect(grid).toBeVisible();
        await expect(grid.locator("article")).toHaveCount(1);
        await expect(grid).toContainText(productTitle);
        await expect(grid).not.toContainText(initialProductTitle);
        await expect(page.getByTestId("product-catalog-loading")).toHaveCount(0);
        await expect(searchInput).toBeFocused();
        currentPhase = "catalog-settled";
        const final = await geometry(page);
        expect(final.gridColumns, `catalog columns after query at ${width}px`).toBe(expectedGridColumns);
        sameGeometry(pending, final);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({
          path: info.outputPath(`${phase}-after.png`),
          animations: "disabled",
          caret: "initial",
          style: "nextjs-portal { display: none !important; }",
        });
        await info.attach(`${phase}-bounds.json`, {
          body: JSON.stringify({ runId, testedSha, case: currentCase, before, submitted, pending, final }),
          contentType: "application/json",
        });
        await expect(page.getByTestId("product-catalog-opening")).toHaveCount(0);
        const finalUrl = new URL(page.url());
        const queryResultCommitted =
          finalUrl.pathname === "/en/products" &&
          finalUrl.searchParams.get("q") === productTitle &&
          await grid.locator("article").count() === 1 &&
          await grid.getByText(productTitle, { exact: true }).count() > 0 &&
          await grid.getByText(initialProductTitle, { exact: true }).count() === 0 &&
          !(await results.getAttribute("aria-busy"));
        browserDiagnostics.catalogCaseResults.push({
          case: currentCase,
          pathname: finalUrl.pathname,
          searchQuery: finalUrl.searchParams.get("q"),
          queryResultCommitted,
          resultArticleCount: await grid.locator("article").count(),
          searchedProductVisible: (await grid.getByText(productTitle, { exact: true }).count()) > 0,
          initialProductAbsent: (await grid.getByText(initialProductTitle, { exact: true }).count()) === 0,
          resultsBusy: await results.getAttribute("aria-busy"),
        });
        expect(finalUrl.pathname).toBe("/en/products");
        expect(finalUrl.searchParams.get("q")).toBe(productTitle);
        expect(queryResultCommitted).toBe(true);
      }
    }
  } finally {
    if (previous) fs.writeFileSync(filename, previous);
    else if (fs.existsSync(filename)) fs.unlinkSync(filename);
    release();
    const sourceAtFinish = sourceSnapshot();
    browserDiagnostics.sourceIntegrity = {
      testedSha,
      finishedSha: sourceAtFinish.sha,
      cleanAtStart: true,
      cleanAtFinish: !sourceAtFinish.dirty,
      matchesHead: sourceAtFinish.sha === testedSha && !sourceAtFinish.dirty,
    };
    for (const failure of browserDiagnostics.failedRequests) {
      const result = browserDiagnostics.catalogCaseResults.find((candidate) => candidate.case === failure.case);
      const queryRequests = browserDiagnostics.catalogRequests.filter((request) =>
        request.case === failure.case && request.searchQuery === failure.searchQuery,
      );
      const observedDuring = failure.observedDuring as { case?: unknown; phase?: unknown } | undefined;
      const isCommittedCatalogRscCancellation =
        failure.failure === "net::ERR_ABORTED" &&
        failure.phase === "catalog-submit" &&
        failure.method === "GET" &&
        failure.pathname === "/en/products" &&
        failure.hasSearchQuery === true &&
        typeof failure.searchQuery === "string" &&
        failure.resourceType === "fetch" &&
        failure.isNavigationRequest === false &&
        failure.isRscRequest === true &&
        failure.isPrefetchRequest === false &&
        failure.isHmrRefresh === false &&
        failure.responseStatus === 200 &&
        failure.contentType === "text/x-component" &&
        observedDuring?.case === failure.case &&
        observedDuring?.phase === "catalog-pending" &&
        queryRequests.length === 1 &&
        result?.queryResultCommitted === true &&
        result.searchQuery === failure.searchQuery;
      if (!result || !isCommittedCatalogRscCancellation) {
        browserDiagnostics.unclassifiedRequestFailures.push(failure);
        continue;
      }
      browserDiagnostics.committedRouteCancellations.push({
        ...failure,
        disposition: "query-result-committed",
        resultEvidence: {
          query: result.searchQuery,
          articleCount: result.resultArticleCount,
          searchedProductVisible: result.searchedProductVisible,
          initialProductAbsent: result.initialProductAbsent,
          resultsBusy: result.resultsBusy,
        },
        reason: "The browser reported an aborted RSC response, and the same case then committed this exact query, rendered its unique seeded product, removed the initial product, and cleared pending state. No other request failure is classified by this rule.",
      });
    }
    await info.attach("browser-diagnostics.json", {
      body: JSON.stringify(browserDiagnostics, null, 2),
      contentType: "application/json",
    });
  }
  expect(browserDiagnostics.consoleErrors).toEqual([]);
  expect(browserDiagnostics.pageErrors).toEqual([]);
  expect(browserDiagnostics.unclassifiedRequestFailures).toEqual([]);
  expect(browserDiagnostics.serverErrors).toEqual([]);
  expect(browserDiagnostics.sourceIntegrity).toMatchObject({
    testedSha: browserDiagnostics.testedSha,
    finishedSha: browserDiagnostics.testedSha,
    cleanAtStart: true,
    cleanAtFinish: true,
    matchesHead: true,
  });
});
