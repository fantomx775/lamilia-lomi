import { devices, expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { getSeedContentSnapshot } from "../../src/lib/local-content";
import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test.setTimeout(120_000);

test("versioned public images reach the optimizer and delivered raster pixels cover desktop DPR1/DPR2 and mobile", async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "This scenario creates its own responsive contexts.");
  test.skip(!(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)), "Synthetic-image verification requires the loopback local backend.");
  const release = await acquireLocalContentStoreLock();
  const store = path.resolve("data/lamilialomi-content.local.json");
  let original: Buffer | null | undefined;
  const baseURL = String(testInfo.project.use.baseURL);
  const fixtureId = randomUUID();
  const uploadsRoot = path.resolve("public/uploads");
  const fixtureDirectory = path.resolve(uploadsRoot, fixtureId);
  try {
    original = fs.existsSync(store) ? fs.readFileSync(store) : null;
    if (path.dirname(fixtureDirectory) !== uploadsRoot) throw new Error("Unexpected owned fixture path.");
    // Owned local raster, not customer media or a hosted R2 acceptance fixture.
    const sourceWidth = 2400;
    const raster = await sharp({ create: { width: sourceWidth, height: 3200, channels: 3, background: "#d7b89a" } }).png().toBuffer();
    fs.mkdirSync(fixtureDirectory, { recursive: true });
    fs.writeFileSync(path.join(fixtureDirectory, "source.png"), raster);
    const snapshot = original ? JSON.parse(original.toString()) : getSeedContentSnapshot();
    const product = structuredClone(getSeedContentSnapshot().products[0]);
    const cover = product.assets.find((asset) => asset.kind === "cover")!;
    const gallery = product.assets.find((asset) => asset.kind === "gallery")!;
    product.id = fixtureId;
    product.slug = `issue-23-dpr-${fixtureId}`;
    product.status = "published";
    product.coverAssetId = randomUUID();
    delete product.videoAssetId;
    product.premiumCodes = [];
    product.assets = [cover, gallery].map((asset, index) => ({ ...asset,
      id: index === 0 ? product.coverAssetId : randomUUID(), productId: fixtureId,
      path: `/uploads/${fixtureId}/source.png`, filename: "source.png", contentType: "image/png", sizeBytes: raster.byteLength,
    }));
    snapshot.products.push(product);
    fs.mkdirSync(path.dirname(store), { recursive: true });
    fs.writeFileSync(store, JSON.stringify(snapshot));

    const imageId = product.assets[1].id;
    const optimizerUrl = new URL("/_next/image", baseURL);
    optimizerUrl.searchParams.set("url", `/api/media/${imageId}?v=${imageId}`);
    optimizerUrl.searchParams.set("w", "640");
    optimizerUrl.searchParams.set("q", "75");
    const optimized = await page.request.get(optimizerUrl.toString());
    expect(optimized.status()).toBe(200);
    expect(optimized.headers()["content-type"]).toMatch(/^image\//);
    expect((await sharp(await optimized.body()).metadata()).width).toBe(640);
    optimizerUrl.searchParams.set("url", `/api/community/artworks/${fixtureId}/media`);
    expect((await page.request.get(optimizerUrl.toString())).status()).toBe(400);

    const scenarios = [
      { name: "desktop-dpr1", options: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
      { name: "desktop-dpr2", options: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
      { name: "pixel-7", options: { ...devices["Pixel 7"] } },
    ];
    for (const scenario of scenarios) {
      const context = await browser.newContext({ ...scenario.options, baseURL });
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const imageFailures: number[] = [];
      const transportFailures: Array<{ method: string; path: string; error: string; phase: "flow" | "context_teardown" }> = [];
      let phase: "flow" | "context_teardown" = "flow";
      try {
        const view = await context.newPage();
        view.on("pageerror", (error) => pageErrors.push(error.message));
        view.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
        view.on("requestfailed", (request) => transportFailures.push({
          method: request.method(), path: new URL(request.url()).pathname,
          error: (request.failure()?.errorText ?? "unknown_transport_error").replace(/[?#].*$/, ""), phase,
        }));
        view.on("response", (response) => {
          if (response.request().resourceType() === "image" && response.status() >= 400) imageFailures.push(response.status());
        });
        await view.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
        await view.goto(`/en/products/${product.slug}`);
        const layout = view.getByTestId("product-media-layout");
        await expect(layout).toBeVisible();
        const thumbnail = layout.locator("button img").first();
        await expect(thumbnail).toBeVisible();
        await expect.poll(() => thumbnail.evaluate((image) => image instanceof HTMLImageElement ? image.naturalWidth : 0)).toBeGreaterThan(0);
        const metrics = await thumbnail.evaluate((image) => {
          if (!(image instanceof HTMLImageElement)) throw new Error("Expected a gallery image.");
          return { cssWidth: image.getBoundingClientRect().width, dpr: devicePixelRatio, currentSrc: image.currentSrc };
        });
        const delivered = await context.request.get(metrics.currentSrc);
        expect(delivered.status()).toBe(200);
        const decoded = await sharp(await delivered.body()).metadata();
        expect(decoded.width).toBeGreaterThanOrEqual(Math.min(sourceWidth, Math.ceil(metrics.cssWidth * metrics.dpr)));
        expect(decoded.width).toBeLessThanOrEqual(sourceWidth);
        console.log(JSON.stringify({ scenario: scenario.name, deliveredWidth: decoded.width, sourceWidth, cssWidth: metrics.cssWidth, dpr: metrics.dpr }));
        expect(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await layout.screenshot({ path: testInfo.outputPath(`gallery-${scenario.name}.png`), animations: "disabled", caret: "initial" });
        await view.waitForLoadState("networkidle");
      } finally {
        phase = "context_teardown";
        await context.close();
        const expectedTeardownAborts = transportFailures.filter((failure) => failure.phase === "context_teardown" && failure.error === "net::ERR_ABORTED")
          .map((failure) => ({ ...failure, reason: "The browser context was explicitly closed after the tested flow reached network idle." }));
        const unresolvedTransportFailures = transportFailures.filter((failure) => failure.phase === "flow" || failure.error !== "net::ERR_ABORTED");
        console.log("[MEDIA-QUALITY-DIAGNOSTICS] " + JSON.stringify({ scenario: scenario.name,
          pageErrors, consoleErrors, failedImageResponses: imageFailures, transportFailures, expectedTeardownAborts, unresolvedTransportFailures }));
        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
        expect(imageFailures).toEqual([]);
        expect(unresolvedTransportFailures).toEqual([]);
      }
    }
  } finally {
    try {
      if (original) fs.writeFileSync(store, original);
      else if (original === null) fs.rmSync(store, { force: true });
      if (path.dirname(fixtureDirectory) !== uploadsRoot) throw new Error("Refusing unexpected fixture cleanup path.");
      fs.rmSync(fixtureDirectory, { recursive: true, force: true });
    } finally { release(); }
  }
});
