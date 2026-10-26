import { expect, type Page } from "@playwright/test";

/** Follow the visible navigation layout, opening the touch menu when needed. */
export async function primaryNavigation(page: Page) {
  const menu = page.getByRole("button", { name: "Open navigation menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  const nav = page.getByRole("navigation", { name: /^(?:Primary navigation|Mobile primary navigation)$/ });
  await expect(nav).toBeVisible();
  return nav;
}
