import { devices, expect, test } from "@playwright/test";

const fullWidthSizes =
  "(min-width: 1280px) 600px, (min-width: 1024px) calc(50vw - 40px), (min-width: 640px) calc(50vw - 32px), calc(50vw - 22px)";
const withVideoSizes =
  "(min-width: 1280px) 335px, (min-width: 1024px) calc(28.75vw - 33px), (min-width: 640px) calc(50vw - 32px), calc(50vw - 22px)";

const scenarios = [
  {
    name: "desktop-dpr1",
    options: {
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    },
  },
  {
    name: "desktop-dpr2",
    options: {
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    },
  },
  {
    name: "pixel-7",
    options: { ...devices["Pixel 7"] },
  },
];

test("product gallery renders at desktop DPR1, desktop DPR2, and Pixel 7 sizes", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "This test creates its own responsive browser contexts.");

  const consoleErrors: string[] = [];
  const unrelatedConsoleErrors: Array<{ message: string; disposition: "unrelated"; reason: string }> = [];
  const failedNetworkRequests: string[] = [];
  const abortedImageCandidates: string[] = [];
  const loadedImageUrls: string[] = [];
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

  for (const scenario of scenarios) {
    const scenarioConsoleErrors: string[] = [];
    const consoleCaptureTasks: Promise<void>[] = [];
    const context = await browser.newContext(scenario.options);
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      consoleCaptureTasks.push(
        Promise.all(message.args().map(async (argument) => {
          try {
            const value = await argument.jsonValue();
            return typeof value === "string" ? value : JSON.stringify(value);
          } catch {
            return argument.toString();
          }
        })).then((arguments_) => {
          scenarioConsoleErrors.push([message.text(), ...arguments_].join("\n"));
        }),
      );
    });
    page.on("pageerror", (error) => scenarioConsoleErrors.push("pageerror: " + error.message));
    page.on("requestfailed", (request) => {
      const errorText = request.failure()?.errorText ?? "";
      if (errorText === "net::ERR_ABORTED" && request.url().includes("/_next/image?")) {
        abortedImageCandidates.push(scenario.name + ": " + request.url());
        return;
      }
      failedNetworkRequests.push(scenario.name + ": " + request.url() + " " + errorText);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        failedNetworkRequests.push(scenario.name + ": HTTP " + response.status() + " " + response.url());
      }
    });
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "ll_cookie_consent",
        JSON.stringify({ essential: true, analytics: false }),
      );
    });
    const documentResponse = await page.goto(
      baseUrl + "/en/products/moon-garden-coloring-book",
      { waitUntil: "domcontentloaded" },
    );
    const responseHtml = await documentResponse?.text();
    console.log("[ISSUE23-HYDRATION] " + scenario.name + " rawHtmlContainsCaretColor=" + Boolean(responseHtml?.includes("caret-color")));

    const layout = page.getByTestId("product-media-layout");
    await expect(layout).toBeVisible();
    const layoutType = await layout.getAttribute("data-layout");
    const expectedSizes = layoutType === "gallery-video" ? withVideoSizes : fullWidthSizes;
    const thumbnail = page.getByRole("button", { name: "Open image 1" }).locator("img");
    await expect(thumbnail).toBeVisible();
    await expect(thumbnail).toHaveAttribute("sizes", expectedSizes);
    await expect.poll(() =>
      thumbnail.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);

    const metrics = await thumbnail.evaluate((image) => ({
      cssWidth: image.getBoundingClientRect().width,
      devicePixelRatio: window.devicePixelRatio,
      naturalWidth: (image as HTMLImageElement).naturalWidth,
      currentSrc: (image as HTMLImageElement).currentSrc,
      sizes: (image as HTMLImageElement).sizes,
    }));
    loadedImageUrls.push(scenario.name + ": " + metrics.currentSrc);
    console.log(JSON.stringify({ scenario: scenario.name, ...metrics }));

    const pageWidth = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(pageWidth.document).toBeLessThanOrEqual(pageWidth.viewport);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await layout.screenshot({
      path: testInfo.outputPath("gallery-" + scenario.name + ".png"),
      animations: "disabled",
    });
    await page.waitForTimeout(150);
    await Promise.all(consoleCaptureTasks);
    const rawResponseContainsCaretColor = Boolean(responseHtml?.includes("caret-color"));
    const unrelatedHydrationErrors = scenarioConsoleErrors.filter((message) =>
      !rawResponseContainsCaretColor &&
      message.includes("A tree hydrated but some attributes") &&
      message.includes("caret-color"),
    );
    unrelatedConsoleErrors.push(
      ...unrelatedHydrationErrors.map(() => ({
        message: scenario.name + ": React hydration diff reports caret-color absent from the raw HTML",
        disposition: "unrelated" as const,
        reason: "The server response contains no caret-color attribute, while React's captured hydration diff reports that exact injected style on the premium form inputs.",
      })),
    );
    consoleErrors.push(
      ...scenarioConsoleErrors
        .filter((message) => !unrelatedHydrationErrors.includes(message))
        .map((message) => scenario.name + ": " + message),
    );
    await context.close();
  }

  console.log("[ISSUE23-CONSOLE-DIAGNOSTIC] " + JSON.stringify(unrelatedConsoleErrors));
  console.log("[ISSUE23-IMAGE-CANDIDATES-ABORTED] " + JSON.stringify(abortedImageCandidates));
  expect(abortedImageCandidates.filter((url) => loadedImageUrls.includes(url))).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedNetworkRequests).toEqual([]);
});
