import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { createDemoSession, serializeDemoSession } from "@/lib/auth";
import { isLocalDemoAppTarget } from "./local-target";

const productSlug = "moon-garden-coloring-book";
const screenshotDirectory = join(tmpdir(), "lamilialomi-premium-ux");

test("unlocked premium and account fit narrow mobile widths", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
    "This responsive regression uses the local demo account and seed product.",
  );

  mkdirSync(screenshotDirectory, { recursive: true });
  await page.addInitScript(() => {
    window.localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false }));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([{
    name: "ll_demo_session",
    value: serializeDemoSession(createDemoSession({ email: "demo@lamilialomi.test" })),
    url: String(testInfo.project.use.baseURL),
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await page.goto("/en/account");
  await expect(page).toHaveURL(/\/en\/account/);
  await expect(page.getByText("Email verified")).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: "My Library" })).toHaveCount(0);
  const mobileMenuButton = page.getByRole("button", { name: "Open navigation menu", exact: true });
  await expect(mobileMenuButton).toBeVisible();
  await mobileMenuButton.click();
  const mobileNavigation = page.getByRole("dialog", { name: "Mobile primary navigation", exact: true });
  const libraryLink = mobileNavigation.getByRole("link", { name: "My Library", exact: true });
  await expect(libraryLink).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(mobileNavigation).not.toBeVisible();
  await expect(page.getByText("Role", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Communication preferences" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "I agree to receive marketing emails." })).toBeChecked();
  await expect(page.getByText("Account management")).toBeVisible();
  await expect(page.locator("details")).not.toHaveAttribute("open", "");
  await expect(page.getByRole("heading", { name: "Join the Coloring Club" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByRole("main").last().screenshot({ path: join(screenshotDirectory, "account-390.png") });
  await mobileMenuButton.click();
  await expect(mobileNavigation.getByRole("button", { name: "Log out", exact: true })).toBeVisible();
  await libraryLink.click();
  await expect(page).toHaveURL(/\/en\/library$/);
  await expect(page.getByRole("heading", { name: "My Library" })).toBeVisible();

  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/en/products/${productSlug}#premium`);
    await expect(page.getByTestId("unlock-success-state")).toBeVisible();
    await expect(page.getByTestId("premium-download-links")).toBeVisible();

    const downloadLink = page.getByTestId("premium-download-links").getByRole("link").first();
    const longFilename = `${"MoonGardenPremiumPrintableFile_".repeat(5)}.pdf`;
    const filename = downloadLink.locator("span");
    await page.addStyleTag({
      content: `[data-testid="premium-download-links"] a:first-child > span::after { content: ${JSON.stringify(longFilename)}; }`,
    });
    await expect.poll(() => filename.evaluate((element) => getComputedStyle(element, "::after").content))
      .toBe(JSON.stringify(longFilename));
    await expect.poll(() => filename.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(downloadLink).toBeVisible();
    const libraryLink = page.getByTestId("unlock-success-state")
      .getByRole("link", { name: "Go to My Library", exact: true });
    await expect(filename).toBeVisible();
    await expect(libraryLink).toBeVisible();
    const geometry = await page.evaluate(() => {
      const section = document.querySelector('[data-testid="product-unlock-section"]');
      const download = section?.querySelector('[data-testid="premium-download-links"] a');
      const fileName = download?.querySelector("span");
      const library = [...(section?.querySelectorAll("a") ?? [])]
        .find((link) => link.textContent?.trim() === "Go to My Library");
      const box = (element: Element | undefined | null) => {
        if (!element?.isConnected || !element.getClientRects().length) return null;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        download: box(download),
        filename: box(fileName),
        library: box(library),
      };
    });
    if (!geometry.download) throw new Error("Premium download link has no visible layout box.");
    if (!geometry.filename) throw new Error("Premium filename has no visible layout box.");
    if (!geometry.library) throw new Error("Library link has no visible layout box.");
    const { download: bounds, filename: filenameBounds, library: libraryBounds } = geometry;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(bounds.y).toBeGreaterThanOrEqual(libraryBounds.y + libraryBounds.height);
    expect(filenameBounds.y).toBeGreaterThanOrEqual(bounds.y);
    expect(filenameBounds.y + filenameBounds.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    await page.getByTestId("product-unlock-section").screenshot({ path: join(screenshotDirectory, `premium-unlocked-${width}.png`) });
  }
});
