import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";
import { isLocalDemoAppTarget } from "./local-target";

const productSlug = "moon-garden-coloring-book";
const premiumCode = "LOMI-BOOK-2026";

test.describe("Issue 31 local QR and premium workflow", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
      "Issue 31 local QR coverage requires a loopback app running the local demo backend.",
    );
    await page.addInitScript(() => {
      if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
        window.localStorage.setItem(
          "ll_cookie_consent",
          JSON.stringify({ essential: true, analytics: false }),
        );
      }
    });
  });

  test("a QR scan survives registration and verification, unlocks My Library, and denies anonymous downloads", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const consoleErrors: string[] = [];
    const failedRequests: Array<{ method: string; url: string; errorText: string }> = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("requestfailed", (request) => {
      failedRequests.push(
        {
          method: request.method(),
          url: request.url(),
          errorText: request.failure()?.errorText ?? "unknown",
        },
      );
    });
    await page.context().clearCookies();

    await page.goto(
      `/api/unlock/en/${productSlug}?code=${encodeURIComponent(premiumCode)}`,
    );
    await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`));
    await expect(page.getByRole("button", { name: "Essential", exact: true })).toBeHidden();
    await expect(page).not.toHaveURL(/LOMI-BOOK-2026|premiumCode|[?&]code=/i);

    const unlockSection = page.getByTestId("product-unlock-section");
    await expect(unlockSection.getByLabel("Premium code")).toHaveValue(premiumCode);
    await unlockSection.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/en/register\\?returnTo=%2Fen%2Fproducts%2F${productSlug}$`),
    );
    await expect(page.locator('input[name="code"]')).toHaveValue(premiumCode);

    await page.getByLabel("Email").fill(`issue31-qr-${testInfo.project.name}@example.test`);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("checkbox", { name: /Terms/ }).check();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`));
    await expect(page.getByTestId("unlock-verification-state")).toBeVisible();

    await page.getByRole("button", { name: "Mark demo email as verified" }).click();
    await expect(page.getByTestId("unlock-code-state")).toBeVisible();
    await expect(page.getByLabel("Premium code")).toHaveValue(premiumCode);
    await page.getByRole("button", { name: "Unlock premium content" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/en/products/${productSlug}\\?unlocked=1#premium$`),
    );
    await expect(page.getByTestId("unlock-success-state")).toBeVisible();
    await expect(page).not.toHaveURL(/LOMI-BOOK-2026|premiumCode|[?&]code=/i);
    await page.getByTestId("unlock-success-state").scrollIntoViewIfNeeded();
    await saveEvidenceScreenshot(page, testInfo, "qr-product-unlocked");

    await page.getByRole("link", { name: "Go to My Library" }).click();
    await expect(page).toHaveURL(/\/en\/library$/);
    await expect(page.getByTestId("library-page")).toContainText("Moon Garden");
    await page.evaluate(() => window.scrollTo(0, 0));
    await saveEvidenceScreenshot(page, testInfo, "qr-my-library");

    await page.goto(
      `/api/unlock/en/${productSlug}?code=${encodeURIComponent(premiumCode)}`,
    );
    await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`));
    await expect(page.getByTestId("unlock-success-state")).toBeVisible();
    await expect(page).not.toHaveURL(/LOMI-BOOK-2026|premiumCode|[?&]code=/i);

    await page.context().clearCookies();
    const anonymousDownload = await page.request.get(
      "/api/downloads/asset-moon-premium-pdf?locale=en",
      { headers: { accept: "application/json" } },
    );
    expect(anonymousDownload.status()).toBe(401);
    await expect(anonymousDownload.json()).resolves.toMatchObject({
      ok: false,
      reason: "guest",
    });
    expect(consoleErrors, "browser console errors").toEqual([]);
    expect(
      failedRequests.filter(({ method, url, errorText }) => {
        if (errorText !== "net::ERR_ABORTED") return true;
        const failedUrl = new URL(url);
        return !(
          (method === "POST" && failedUrl.pathname === "/en/register" && failedUrl.searchParams.has("returnTo")) ||
          (method === "GET" && failedUrl.pathname === "/en/library" && failedUrl.searchParams.has("_rsc"))
        );
      }),
      "unexpected browser request failures",
    ).toEqual([]);
  });
});

async function saveEvidenceScreenshot(
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
  name: string,
) {
  const folder = path.resolve(process.cwd(), "docs", "verification", "issue-31");
  await mkdir(folder, { recursive: true });
  const suffix = testInfo.project.name === "mobile" ? "mobile" : "desktop";
  const filename = `${name}-${suffix}.png`;
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const screenshot = await page.screenshot({ fullPage: false, animations: "disabled" });
  await writeFile(path.join(folder, filename), screenshot);
  return filename;
}
