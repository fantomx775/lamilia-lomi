import { expect, test } from "@playwright/test";

test("consent gates Google, instruments interactions, and can be withdrawn", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  let googleLoads = 0;
  await page.route("https://www.googletagmanager.com/**", route => { googleLoads++; return route.fulfill({ contentType: "application/javascript", body: "/* isolated Google transport */" }); });
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Essential only", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("cookie-consent.png"), fullPage: false });
  await page.getByRole("button", { name: "Essential only", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Cookie settings", exact: true })).toBeVisible();
  expect(googleLoads).toBe(0);
  await page.getByRole("button", { name: "Cookie settings", exact: true }).click();
  await page.getByRole("button", { name: "Allow analytics", exact: true }).click();
  await expect.poll(() => googleLoads).toBe(1);
  const events = () => page.evaluate(() => (window as unknown as { dataLayer: ArrayLike<unknown>[] }).dataLayer?.map(item => Array.from(item)).filter(item => item[0] === "event") ?? []);
  expect((await events()).filter(item => item[1] === "page_view")).toHaveLength(1);
  await page.getByRole("link", { name: "Contact", exact: true }).first().click();
  await expect(page.locator('form[data-analytics-form="contact"]')).toBeVisible();
  await page.locator('form[data-analytics-form="contact"]').evaluate(form => {
    form.addEventListener("submit", e => e.preventDefault());
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const contactSubmit = (await events()).find(item => item[1] === "form_submit");
  expect(contactSubmit?.[2]).toMatchObject({ form_name: "contact" });
  const mobileMenuButton = page.getByRole("button", { name: "Open navigation menu" });
  if (await mobileMenuButton.isVisible()) {
    await mobileMenuButton.click();
    await page.getByRole("navigation", { name: "Mobile primary navigation" }).getByRole("link", { name: "Catalog", exact: true }).click();
  } else {
    await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Catalog", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/en\/products$/);
  await page.locator('a[href="/en/products/moon-garden-coloring-book"]').first().click();
  await expect(page).toHaveURL(/\/en\/products\/moon-garden-coloring-book$/);
  await expect.poll(async () => (await events()).filter(item => item[1] === "page_view").length).toBe(4);
  const pageViews = (await events()).filter(item => item[1] === "page_view").map(item => item[2] as Record<string, unknown>);
  const origin = await page.evaluate(() => location.origin);
  expect(pageViews.map(item => item.page_path)).toEqual(["/en", "/en/contact", "/en/products", "/en/products/moon-garden-coloring-book"]);
  expect(pageViews.map(item => item.page_referrer)).toEqual(["", `${origin}/en`, `${origin}/en/contact`, `${origin}/en/products`]);
  await page.locator('a[target="_blank"]').filter({ hasText: /Amazon/i }).first().evaluate(link => {
    link.addEventListener("click", e => e.preventDefault());
    (link as HTMLAnchorElement).click();
  });
  // Seed media is a placeholder; use an HTML video to exercise the same delegated listener.
  await page.evaluate(() => {
    const video = document.createElement("video"); video.setAttribute("data-flipthrough", ""); document.body.append(video);
    video.dispatchEvent(new Event("play")); video.dispatchEvent(new Event("play")); video.dispatchEvent(new Event("ended"));
  });
  const measured = await events();
  for (const name of ["page_view", "amazon_link_click", "video_play", "video_complete"]) expect(measured.some(item => item[1] === name), JSON.stringify(measured) + " missing " + name).toBe(true);
  expect(measured.filter(item => item[1] === "video_play")).toHaveLength(2);
  expect(measured.filter(item => item[1] === "video_complete")).toHaveLength(1);
  expect(JSON.stringify(measured)).not.toContain("email");
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "ll_cookie_consent" && JSON.parse(value).analytics === false) throw new DOMException("quota", "QuotaExceededError");
      return originalSetItem.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "Cookie settings", exact: true }).click();
  await page.getByRole("button", { name: "Essential only", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cookie settings", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const video = document.createElement("video");
    video.setAttribute("data-flipthrough", "");
    document.body.append(video);
    video.dispatchEvent(new Event("play"));
  });
  expect(await events()).toHaveLength(0);
  expect(await page.evaluate(() => document.cookie)).toContain("ll_analytics_denied=1");
  await page.reload();
  expect(await page.locator('script[src*="googletagmanager"]').count()).toBe(0);
});


test("real Google tag encodes the configured measurement ID and page view", async ({ page }) => {
  test.setTimeout(60_000);
  const collected: string[] = [];
  await page.route(/https:\/\/[^/]*(?:google-analytics\.com|analytics\.google\.com)\/g\/collect/, route => {
    collected.push(route.request().url() + "&" + (route.request().postData() ?? ""));
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto("/en?email=private%40example.test#private-token");
  await page.getByRole("button", { name: "Allow analytics", exact: true }).click();
  await expect.poll(() => collected.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(collected.join("\n")).toContain("tid=G-NG67S3HPQZ");
  expect(collected.join("\n")).toContain("en=page_view");
  expect(collected.join("\n")).not.toContain("private");
});
