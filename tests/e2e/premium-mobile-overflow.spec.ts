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
  await expect(page.locator("main").getByRole("link", { name: "My Library" }).last()).toBeVisible();
  await expect(page.getByText("Role", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Communication preferences" })).toBeVisible();
  await expect(page.getByText("Marketing emails:")).toContainText("Subscribed");
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(page.getByText("Danger Zone")).toBeVisible();
  await expect(page.locator("details")).not.toHaveAttribute("open", "");
  await expect(page.getByRole("heading", { name: "Join the Coloring Club" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByRole("main").last().screenshot({ path: join(screenshotDirectory, "account-390.png") });

  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/en/products/${productSlug}#premium`);
    await expect(page.getByTestId("unlock-success-state")).toBeVisible();
    await expect(page.getByTestId("premium-download-links")).toBeVisible();

    const downloadLink = page.getByTestId("premium-download-links").getByRole("link").first();
    const longFilename = `${"MoonGardenPremiumPrintableFile_".repeat(5)}.pdf`;
    await downloadLink.locator("span").evaluate((element, text) => {
      element.textContent = text;
    }, longFilename);
    const filename = downloadLink.locator("span");
    await expect(filename).toHaveText(longFilename);
    await expect.poll(() => filename.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(downloadLink).toBeVisible();
    const bounds = await downloadLink.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    await page.getByTestId("product-unlock-section").screenshot({ path: join(screenshotDirectory, `premium-unlocked-${width}.png`) });
  }
});
