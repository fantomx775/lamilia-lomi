import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test("PR 44 catalog search uses visible rich-text content", async ({ page }, testInfo) => {
  test.skip(
    !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
    "Catalog search browser evidence requires the loopback local demo backend.",
  );

  test.setTimeout(600_000);
  const releaseContentStoreLock = await acquireLocalContentStoreLock();
  const contentStorePath = path.resolve(process.cwd(), "data", "lamilialomi-content.local.json");
  const hadContentStore = fs.existsSync(contentStorePath);
  const originalContentStore = hadContentStore ? fs.readFileSync(contentStorePath) : undefined;
  const screenshotPath = path.resolve(
    process.env.PR_44_SCREENSHOT_PATH ??
      path.join(process.cwd(), "docs", "verification", "pr-44", "catalog-rich-text-search.png"),
  );
  const browserRunId = process.env.PR_44_BROWSER_RUN_ID ?? `pr-44-catalog-search-${Date.now()}`;
  const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const diagnostics = {
    consoleErrors: [] as string[],
    pageErrors: [] as string[],
    failedNetworkRequests: [] as Array<{
      method: string;
      url: string;
      error: string | null;
      resourceType: string;
      isNavigationRequest: boolean;
      hasNextActionHeader: boolean;
    }>,
    failedResponses: [] as Array<{ method: string; url: string; status: number }>,
  };
  const readerArtworkRequests = new Set<import("@playwright/test").Request>();
  const readerArtworkStatuses = new Map<import("@playwright/test").Request, number>();
  let readerArtworkEndpoint = "";
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });

  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? null;
    diagnostics.failedNetworkRequests.push({
      method: request.method(),
      url: safeUrl(request.url()),
      error: failure,
      resourceType: request.resourceType(),
      isNavigationRequest: request.isNavigationRequest(),
      hasNextActionHeader: Boolean(request.headers()["next-action"]),
    });
    if (request.method() === "GET" && new URL(request.url()).pathname === readerArtworkEndpoint) {
      readerArtworkRequests.delete(request);
    }
  });
  page.on("request", (request) => {
    if (readerArtworkEndpoint && request.method() === "GET" && new URL(request.url()).pathname === readerArtworkEndpoint) {
      readerArtworkRequests.add(request);
    }
  });
  page.on("requestfinished", (request) => {
    if (request.method() === "GET" && new URL(request.url()).pathname === readerArtworkEndpoint) {
      readerArtworkRequests.delete(request);
    }
  });
  page.on("response", (response) => {
    if (response.request().method() === "GET" && new URL(response.url()).pathname === readerArtworkEndpoint) {
      readerArtworkStatuses.set(response.request(), response.status());
    }
    if (response.status() >= 400) {
      diagnostics.failedResponses.push({
        method: response.request().method(),
        url: safeUrl(response.url()),
        status: response.status(),
      });
    }
  });

  try {
    await page.addInitScript(() => {
      window.localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false }));
    });
    await signInAsAdmin(page);

    await page.goto("/admin/products");
    await waitForDocumentFonts(page);
    const firstProductLink = page.locator('a[href^="/admin/products/"]:not([href="/admin/products/new"])').first();
    const productPath = await firstProductLink.getAttribute("href");
    if (!productPath) throw new Error("The local product list did not provide an edit link.");
    readerArtworkEndpoint = `/api/admin/products/${productPath.split("/").at(-1)}/reader-artworks`;
    await page.goto(productPath);
    await waitForDocumentFonts(page);
    const readerArtworkManager = page.getByTestId("reader-artwork-manager");
    await expect(readerArtworkManager.getByText("Nie dodano jeszcze prac.", { exact: true })).toBeVisible();
    await expect.poll(() => readerArtworkRequests.size).toBe(0);
    expect([...readerArtworkStatuses.values()].some((status) => status === 200)).toBe(true);

    const productSlug = await page.getByLabel("Adres produktu").inputValue();
    const productEditor = page.getByRole("textbox", { name: "Długi opis" });
    await productEditor.fill("Catalog split phrase");
    await selectFixtureText(productEditor, "split");
    await page.getByRole("button", { name: "Pogrubienie" }).click();
    await expect(productEditor.locator("strong")).toHaveText("split");

    await selectFixtureText(productEditor, "phrase");
    await page.getByRole("button", { name: "Dodaj lub edytuj link" }).click();
    await page.getByLabel("Adres strony").fill("https://metadata-only.example/catalog");
    await page.getByRole("button", { name: "Zapisz link" }).click();

    const saveActionFinished = page.waitForEvent("requestfinished", (request) => {
      const url = new URL(request.url());
      return request.method() === "POST" &&
        url.pathname === productPath &&
        (Boolean(request.headers()["next-action"]) || request.isNavigationRequest());
    });
    await page.getByRole("button", { name: /Zapisz/ }).first().click();
    await expect(page.getByText("Zapisano. Zmiany są aktualne.")).toBeVisible();
    await saveActionFinished;
    await expect(readerArtworkManager.getByText("Nie dodano jeszcze prac.", { exact: true })).toBeVisible();
    await expect.poll(() => readerArtworkRequests.size).toBe(0);
    expect([...readerArtworkStatuses.values()].every((status) => status === 200)).toBe(true);

    await page.goto(`/en/products?q=${encodeURIComponent("split phrase")}`);
    await waitForDocumentFonts(page);
    const grid = page.getByTestId("product-catalog-grid");
    await expect(grid.locator(`a[href="/en/products/${productSlug}"]`)).toBeVisible();
    await expect(page.getByText("No products found", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });

    await page.goto(`/en/products?q=${encodeURIComponent("metadata-only")}`);
    await waitForDocumentFonts(page);
    await expect(page.getByText("No products found", { exact: true })).toBeVisible();

    console.log(
      `PR44_BROWSER_EVIDENCE ${JSON.stringify({
        testedSha,
        browserRunId,
        screenshotPath,
        consoleErrors: diagnostics.consoleErrors,
        knownHydrationWarnings: diagnostics.consoleErrors.filter(isKnownHydrationCaretWarning),
        pageErrors: diagnostics.pageErrors,
        failedNetworkRequests: diagnostics.failedNetworkRequests,
        expectedNavigationAborts: diagnostics.failedNetworkRequests.filter(isExpectedLoginRedirectAbort),
        failedResponses: diagnostics.failedResponses,
      })}`,
    );
    expect(diagnostics.consoleErrors.filter((message) => !isKnownHydrationCaretWarning(message))).toEqual([]);
    expect(diagnostics.pageErrors).toEqual([]);
    expect(diagnostics.failedNetworkRequests.filter((request) => !isExpectedLoginRedirectAbort(request))).toEqual([]);
    expect(diagnostics.failedResponses).toEqual([]);
  } finally {
    try {
      if (hadContentStore && originalContentStore) {
        fs.writeFileSync(contentStorePath, originalContentStore);
      } else if (fs.existsSync(contentStorePath)) {
        fs.rmSync(contentStorePath);
      }
    } finally {
      releaseContentStoreLock();
    }
  }
});

async function signInAsAdmin(page: Page) {
  await page.goto("/en/login?returnTo=/admin");
  await waitForDocumentFonts(page);
  await page.getByLabel("Email").fill("admin@lamilialomi.test");
  await page.getByLabel("Password").fill("demo-password");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.getByRole("button", { name: "Continue" }).click(),
  ]);
}

async function waitForDocumentFonts(page: Page) {
  const loadedGeistFaces = await page.evaluate(async () => {
    const loaded = await document.fonts.load("16px Geist", "LamiliaLomi");
    await document.fonts.ready;
    return loaded.filter((face) => face.family === "Geist").length;
  });
  expect(loadedGeistFaces).toBeGreaterThan(0);
}

function safeUrl(value: string) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function isKnownHydrationCaretWarning(message: string) {
  return message.includes("A tree hydrated") && message.includes("caret-color");
}

function isExpectedLoginRedirectAbort(request: {
  method: string;
  url: string;
  error: string | null;
  hasNextActionHeader: boolean;
}) {
  return (
    request.method === "POST" &&
    request.url.endsWith("/en/login") &&
    request.error === "net::ERR_ABORTED" &&
    request.hasNextActionHeader
  );
}

/** Select exact fixture text for the real toolbar/save/search flow.
 * This tests catalog search; keyboard editing has separate browser coverage.
 */
async function selectFixtureText(editor: Locator, text: string) {
  await editor.evaluate((element, target) => {
    (element as HTMLElement).focus();
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) nodes.push(node as Text);
    const start = nodes.map((item) => item.textContent).join("").indexOf(target);
    if (start < 0) throw new Error("Missing fixture text to select.");
    const boundary = (offset: number): [Text, number] => {
      for (const item of nodes) {
        if (offset <= item.length) return [item, offset];
        offset -= item.length;
      }
      throw new Error("Fixture text selection exceeded editor content.");
    };
    const range = document.createRange();
    range.setStart(...boundary(start));
    range.setEnd(...boundary(start + target.length));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (selection?.toString() !== target) throw new Error("Fixture text selection did not match.");
  }, text);
}
