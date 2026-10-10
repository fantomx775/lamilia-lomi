import { expect, test } from "@playwright/test";

import { isLocalDemoAppTarget, isLoopbackPlaywrightTarget } from "./local-target";

test("the running local app proves demo mode before demo-backed E2E proceeds", async ({ page }, testInfo) => {
  test.skip(
    process.env.PLAYWRIGHT_LOCAL_DEMO !== "true" ||
      !isLoopbackPlaywrightTarget(testInfo.project.use.baseURL),
    "The local backend proof requires explicit local-demo mode and a loopback Playwright target.",
  );
  expect(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)).toBe(true);
});

test("a loopback login page without demo credentials is not treated as local demo mode", async ({ page }, testInfo) => {
  await page.route("**/en/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <form>
          <label for="email">Email</label><input id="email" name="email" type="email">
          <label for="password">Password</label><input id="password" name="password" type="password">
        </form>
      </body></html>`,
    });
  });

  expect(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)).toBe(false);
});

test("a non-loopback target is rejected before browser navigation", async ({ page }) => {
  let navigated = false;
  page.on("request", () => {
    navigated = true;
  });

  expect(await isLocalDemoAppTarget(page, "https://lamilia-lomi.vercel.app")).toBe(false);
  expect(navigated).toBe(false);
});
