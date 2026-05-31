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
