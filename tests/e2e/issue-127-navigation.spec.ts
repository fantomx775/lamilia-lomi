import { expect, test, type Page } from "@playwright/test";

async function holdRoute(page: Page, pathname: RegExp) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (pathname.test(new URL(request.url()).pathname) && request.headers().rsc === "1") await gate;
    await route.continue();
  });
  return release;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
});

test("F04 tall card confirms a top-cover tap inside the visible cover", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 360 });
  // Install before navigation: even a viewport prefetch must wait at the same gate.
  const release = await holdRoute(page, /^\/en\/products\/[^/]+$/);
  try {
    await page.goto("/en/products");
    const card = page.locator("article").filter({ has: page.locator("[data-product-card-title]") }).first();
    await expect(card).toBeVisible();
    const cover = card.locator("a > div").first();
    await cover.evaluate((element) => element.scrollIntoView({ block: "start" }));
    const cardBox = await card.boundingBox();
    expect(cardBox?.height).toBeGreaterThan(360);
    await page.screenshot({ path: info.outputPath("f04-before.png"), animations: "disabled" });
    const destination = await card.locator("a").getAttribute("href");
    await card.locator("a").click({ position: { x: 30, y: 35 }, noWaitAfter: true });
    const pending = card.getByTestId("product-card-pending");
    await expect(pending).toHaveAttribute("data-pending", "true");
    await expect(pending).toHaveCSS("opacity", "1");
    const pendingBox = await pending.boundingBox();
    const coverBox = await cover.boundingBox();
    expect(pendingBox).not.toBeNull();
    expect(coverBox).not.toBeNull();
    expect(pendingBox!.y).toBeGreaterThanOrEqual(0);
    expect(pendingBox!.y + pendingBox!.height).toBeLessThanOrEqual(360);
    expect(pendingBox!.x).toBeGreaterThanOrEqual(coverBox!.x);
    expect(pendingBox!.x + pendingBox!.width).toBeLessThanOrEqual(coverBox!.x + coverBox!.width);
    expect(pendingBox!.y + pendingBox!.height).toBeLessThanOrEqual(coverBox!.y + coverBox!.height);
    await page.screenshot({ path: info.outputPath("f04-pending.png"), animations: "disabled" });
    release();
    expect(destination).toBeTruthy();
    await expect(page).toHaveURL(new URL(destination!, page.url()).href);
    await expect(page.locator("h1")).toBeVisible();
    await page.screenshot({ path: info.outputPath("f04-after.png"), animations: "disabled" });
  } finally { release(); }
});

test("F03 menu selection keeps visible feedback after the menu exits", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const release = await holdRoute(page, /^\/en\/about$/);
  try {
    await page.goto("/en/products");
    await page.getByRole("button", { name: "Open navigation menu", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "Mobile primary navigation", exact: true });
    const about = menu.getByRole("link", { name: "About", exact: true });
    await about.click({ noWaitAfter: true });
    await expect(about).toHaveAttribute("aria-busy", "true");
    await expect(menu).not.toBeVisible();
    const pending = page.getByTestId("mobile-navigation-pending");
    await expect(pending).toBeVisible();
    const box = await pending.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    await page.screenshot({ path: info.outputPath("f03-pending.png"), animations: "disabled" });
    release();
    await expect(page).toHaveURL(/\/en\/about$/);
    await expect(page.locator("h1")).toBeVisible();
    await expect(pending).not.toBeVisible();
    await page.screenshot({ path: info.outputPath("f03-after.png"), animations: "disabled" });
  } finally { release(); }
});
