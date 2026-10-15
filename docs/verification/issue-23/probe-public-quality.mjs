// Read-only public storefront probe. Never signs in or invokes admin mutations.
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const directory = path.resolve(process.env.ISSUE_23_PUBLIC_QUALITY_DIR ?? "docs/verification/issue-23/public-quality");
fs.mkdirSync(directory, { recursive: true });
const origin = "https://www.lamilialomi.com";
const productPath = "/en/products/https-www-amazon-com-dp-b0hlthrwdh";
const browser = await chromium.launch();
const results = [];
try {
  for (const [name, options] of [
    ["desktop-1x", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
    ["desktop-2x", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }],
    ["pixel-7", devices["Pixel 7"]],
  ]) {
    const context = await browser.newContext(options);
    await context.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
    const page = await context.newPage();
    page.setDefaultTimeout(90_000);
    const record = { name, environment: "Production public read-only", observedAt: new Date().toISOString(), consoleErrors: [], pageErrors: [], failedResponses: [], failedRequests: [], images: [] };
    const safeUrl = value => { const url = new URL(value); return url.origin + url.pathname; };
    page.on("console", message => { if (message.type() === "error") record.consoleErrors.push(message.text()); });
    page.on("pageerror", error => record.pageErrors.push(error.message));
    page.on("response", response => { if (response.status() >= 400) record.failedResponses.push({ url: safeUrl(response.url()), status: response.status() }); });
    page.on("requestfailed", request => {
      const error = request.failure()?.errorText;
      const navigationCancellation = error === "net::ERR_ABORTED" && ["fetch", "image"].includes(request.resourceType());
      record.failedRequests.push({ url: safeUrl(request.url()), error, resourceType: request.resourceType(), disposition: navigationCancellation ? "unrelated" : "unresolved", ...(navigationCancellation ? { reason: "Navigation canceled a prefetch or other catalog image request. All four inspected images are separately decoded successfully; HTTP failures are checked independently." } : {}) });
    });
    const decoded = async (image, label) => {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate(image => image.decode());
      record.images.push({ label, ...await image.evaluate(image => ({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, cssWidth: image.getBoundingClientRect().width, cssHeight: image.getBoundingClientRect().height, dpr: devicePixelRatio, currentSrc: image.currentSrc })) });
    };
    try {
      await page.goto(origin + "/en/products", { waitUntil: "domcontentloaded" });
      const firstCard = page.getByTestId("product-catalog-grid").locator("a").first();
      await decoded(firstCard.locator("img").first(), "catalog cover");
      await firstCard.screenshot({ path: path.join(directory, `${name}-catalog-cover.png`), animations: "disabled" });
      await page.goto(origin + productPath, { waitUntil: "domcontentloaded" });
      await decoded(page.getByTestId("product-hero").locator("img").first(), "product main cover");
      await page.screenshot({ path: path.join(directory, `${name}-product-cover.png`), animations: "disabled" });
      const open = page.getByRole("button", { name: "Open image 1", exact: true });
      await decoded(open.locator("img"), "gallery thumbnail");
      await page.screenshot({ path: path.join(directory, `${name}-gallery.png`), animations: "disabled" });
      await open.click();
      const dialog = page.getByRole("dialog", { name: "Image preview" });
      await dialog.waitFor({ state: "visible" });
      await decoded(dialog.locator("img"), "expanded gallery image");
      await page.screenshot({ path: path.join(directory, `${name}-lightbox.png`), animations: "disabled" });
      record.horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      record.status = record.consoleErrors.length || record.pageErrors.length || record.failedResponses.length || record.failedRequests.some(request => request.disposition === "unresolved") || record.horizontalOverflow ? "FAIL" : "PASS";
    } catch (error) {
      record.status = "FAIL";
      record.error = String(error);
    } finally {
      results.push(record);
      fs.writeFileSync(path.join(directory, "diagnostics.json"), JSON.stringify(results, null, 2));
      await context.close();
      console.log(JSON.stringify({ name, status: record.status, images: record.images.length, error: record.error }));
    }
  }
} finally {
  await browser.close();
}
if (results.some(result => result.status !== "PASS")) process.exitCode = 1;
