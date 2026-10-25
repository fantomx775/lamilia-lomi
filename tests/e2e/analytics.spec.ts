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
  expect((await events()).some(item => item[1] === "form_submit")).toBe(true);
  await page.goto("/en/products/moon-garden-coloring-book");
  await expect.poll(async () => (await events()).filter(item => item[1] === "page_view").length).toBe(1);
  await page.locator('a[target="_blank"]').filter({ hasText: /Amazon/i }).first().evaluate(link => {
    link.addEventListener("click", e => e.preventDefault());
    (link as HTMLAnchorElement).click();
  });
  // Seed media is a placeholder; use an HTML video to exercise the same delegated listener.
  await page.evaluate(() => {
    const video = document.createElement("video"); video.setAttribute("data-flipthrough", ""); document.body.append(video);
    video.dispatchEvent(new Event("play")); video.dispatchEvent(new Event("ended"));
  });
  const measured = await events();
  for (const name of ["page_view", "amazon_link_click", "video_play", "video_complete"]) expect(measured.some(item => item[1] === name), JSON.stringify(measured) + " missing " + name).toBe(true);
  expect(JSON.stringify(measured)).not.toContain("email");
  await page.getByRole("button", { name: "Cookie settings", exact: true }).click();
  await page.getByRole("button", { name: "Essential only", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cookie settings", exact: true })).toBeVisible();
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
