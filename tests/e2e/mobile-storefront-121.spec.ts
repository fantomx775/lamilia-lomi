import { expect, test } from "@playwright/test";
import { isLocalDemoAppTarget } from "./local-target";
import { communityFixtures } from "./helpers/community-fixtures";

test.setTimeout(90_000);
test.use({ ignoreHTTPSErrors: true });

const browserErrors = new WeakMap<object, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
});
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

test("mobile header fits, traps focus and closes with Back, Escape, X and route changes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "chromium", "Mobile interaction test");
  await page.goto("/en");
  const cookie = page.getByRole("button", { name: "Essential only", exact: true });
  if (await cookie.isVisible()) await cookie.click();

  const opener = page.getByRole("button", { name: "Open navigation menu" });
  const account = page.getByRole("link", { name: "Log in", exact: true }).first();
  const dialog = page.getByRole("dialog", { name: "Mobile primary navigation" });
  for (const width of [320, 375, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 844 });
    for (const control of [opener, account]) {
      const box = await control.boundingBox();
      expect(box?.width).toBe(44);
      expect(box?.height).toBe(44);
    }
    await opener.click();
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
    await expect(dialog.getByRole("button", { name: "Close navigation menu" })).toBeFocused();
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    if (width === 390) await page.screenshot({ path: testInfo.outputPath("navigation-390.png"), animations: "disabled" });
    await dialog.getByRole("button", { name: "Close navigation menu" }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  }
  await opener.click();
  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/en$/);
  await opener.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await opener.click();
  await dialog.getByRole("link", { name: "About", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/about$/, { timeout: 25_000 });
  await expect(dialog).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL(/\/en$/);
  await expect(dialog).toBeHidden();
});

test("auth fields have a mobile font floor, login returns to account and logout is in the menu", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "chromium", "Mobile interaction test");
  await page.goto("/en/login?returnTo=%2Fen%2Faccount");
  const cookie = page.getByRole("button", { name: "Essential only", exact: true });
  if (await cookie.isVisible()) await cookie.click();
  for (const route of ["/en/login", "/en/register", "/en/reset-password"]) {
    await page.goto(route);
    const controls = page.locator('main :is(input:not([type="hidden"],[type="checkbox"]),select,textarea):visible');
    for (const control of await controls.all()) {
      await control.focus();
      expect(await control.evaluate((field) => parseFloat(getComputedStyle(field).fontSize))).toBeGreaterThanOrEqual(16);
      expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
    }
  }
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).not.toMatch(/maximum-scale|user-scalable/);
  test.skip(!(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)), "Uses the local demo session");
  await page.goto("/en/login?returnTo=%2Fen%2Faccount");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/account$/, { timeout: 25_000 });
  await expect(page.getByRole("heading", { name: "Account details" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out", exact: true })).toBeHidden();
  await expect(page.getByText("User dashboard", { exact: true }).first()).toBeHidden();
  expect(await page.evaluate(() => visualViewport?.scale)).toBe(1);
  if (await cookie.isVisible()) await cookie.click();
  await page.screenshot({ path: testInfo.outputPath("account.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const logout = page.getByRole("button", { name: "Log out", exact: true });
  await expect(logout).toBeVisible();
  const request = page.waitForRequest((request) => request.method() === "POST");
  await logout.click();
  await request;
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole("dialog", { name: "Mobile primary navigation" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Log in", exact: true }).first()).toBeVisible();
});

test("1440px retains desktop navigation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop interaction test");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/en");
  await expect(page.getByRole("navigation", { name: "Primary navigation", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("desktop-1440.png") });
});


test("navigation animates both directions and releases modal lifecycle on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "chromium", "Mobile interaction test");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/en");
  const cookie = page.getByRole("button", { name: "Essential only", exact: true });
  if (await cookie.isVisible()) await cookie.click();
  const opener = page.getByRole("button", { name: "Open navigation menu" });
  const dialog = page.getByRole("dialog", { name: "Mobile primary navigation" });
  // Inspect actual Web Animations state rather than infer animation from CSS text.
  for (const method of ["X", "Escape", "Back", "link"]) {
    await opener.click();
    const enter = await dialog.evaluate((element) => element.getAnimations().map((animation) => ({
      name: (animation as CSSAnimation).animationName,
      duration: animation.effect?.getTiming().duration,
      frames: (animation.effect as KeyframeEffect)?.getKeyframes().map((frame) => frame.transform),
    })));
    expect(enter).toEqual(expect.arrayContaining([expect.objectContaining({ name: "mobile-navigation-enter", duration: 220 })]));
    await dialog.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    await page.evaluate(() => {
      const element = document.querySelector("#mobile-primary-navigation")!;
      (window as unknown as { navExit: unknown }).navExit = null;
      element.addEventListener("animationstart", (event) => {
        const animation = event as AnimationEvent;
        if (animation.animationName !== "mobile-navigation-exit") return;
        (window as unknown as { navExit: unknown }).navExit = {
          open: (element as HTMLDialogElement).open,
          overflow: getComputedStyle(document.body).overflow,
          duration: getComputedStyle(element).animationDuration,
        };
      }, { once: true });
    });
    if (method === "Escape") await page.keyboard.press("Escape");
    else if (method === "Back") await page.goBack();
    else if (method === "link") await dialog.getByRole("link", { name: "About", exact: true }).click();
    else await dialog.getByRole("button", { name: "Close navigation menu" }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as { navExit: unknown }).navExit)).toEqual({ open: true, overflow: "hidden", duration: "0.22s" });
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
    if (method === "link") {
      await expect(page).toHaveURL(/\/en\/about$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/en$/);
    } else await expect(opener).toBeFocused();
  }
  // Close while entrance is still running; the exit starts at the current
  // position rather than flashing a fully opened panel first.
  await opener.click();
  await dialog.evaluate((element) => {
    element.querySelector<HTMLButtonElement>('button[aria-label="Close navigation menu"]')!.click();
  });
  await expect(dialog).toHaveAttribute("data-closing", "true");
  expect(await dialog.evaluate((element) => (element as HTMLElement).style.getPropertyValue("--navigation-exit-start"))).not.toBe("");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (let repeat = 0; repeat < 3; repeat++) {
    await opener.click();
    expect(await dialog.evaluate((element) => element.getAnimations().length)).toBe(0);
    await dialog.getByRole("button", { name: "Close navigation menu" }).click();
    await expect(dialog).toBeHidden();
  }
});


test("real authenticated mobile logout consumes menu history and restores the public header", async ({ page }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_UPLOADS_E2E !== "1" || !["chromium", "webkit-mobile"].includes(testInfo.project.name), "Requires isolated real Supabase");
  await page.setViewportSize({ width: 390, height: 844 });
  const fixtures = await communityFixtures(testInfo);
  try {
    const actor = await fixtures.actor("navigation-logout");
    await fixtures.login(page, actor, "/en/account");
    const before = await page.evaluate(() => history.length);
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByRole("dialog", { name: "Mobile primary navigation" })).toBeHidden();
    await expect(page.getByRole("link", { name: "Log in", exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(before + 1);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
  } finally { await fixtures.cleanup(); }
});
