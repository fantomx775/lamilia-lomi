import { expect, test } from "@playwright/test";

test("guest can browse public product flow", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByRole("heading", { name: "LamiliaLomi" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Browse catalog/i })).toBeVisible();

  await page.goto("/en/products?q=moon");
  await expect(page.getByRole("link", { name: /Moon Garden Coloring Book/i })).toBeVisible();

  await page.goto("/en/products/moon-garden-coloring-book?code=LOMI-BOOK-2026");
  await expect(page.getByRole("heading", { name: "Moon Garden Coloring Book" })).toBeVisible();
  await expect(page.getByText("Log in to unlock premium content")).toBeVisible();
});

test("guest can see and download public product files without signing in", async ({ page }) => {
  await page.goto("/en/products/moon-garden-coloring-book");

  await expect(page.getByRole("heading", { name: "Free downloads" })).toBeVisible();
  const downloadLink = page.locator('a[href*="/api/media/asset-moon-public-guide"]');
  await expect(downloadLink).toHaveAttribute("href", /download=1/);

  const href = await downloadLink.getAttribute("href");
  const response = await page.request.get(new URL(href!, "http://127.0.0.1:3000").toString());
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toContain("moon-garden-free-guide.pdf");
  expect((await response.body()).subarray(0, 4).toString()).toBe("%PDF");
});

test("demo user can log in and see unlocked library", async ({ page }) => {
  await page.goto("/en/login?redirectTo=/en/library");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/en\/library/);
  await expect(page.getByRole("heading", { name: "My Library" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Moon Garden Coloring Book/i })).toBeVisible();
});

test("admin is protected for guests", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Brak dostępu" })).toBeVisible();
});
