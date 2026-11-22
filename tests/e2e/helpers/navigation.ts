import { expect, type Page } from "@playwright/test";

/** Follow the visible navigation layout, opening the touch menu when needed. */
export async function primaryNavigation(page: Page) {
  const menu = page.getByRole("button", { name: "Open navigation menu", exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    const dialog = page.getByRole("dialog", { name: "Mobile primary navigation", exact: true });
    await expect(dialog).toBeVisible();
    const nav = dialog.getByRole("navigation", { name: "Storefront", exact: true });
    await expect(nav).toBeVisible();
    return nav;
  }
  const nav = page.getByRole("navigation", { name: "Primary navigation", exact: true });
  await expect(nav).toBeVisible();
  return nav;
}
