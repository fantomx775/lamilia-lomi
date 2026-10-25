import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test("page editor keeps its draft after a save transport failure", async ({ page }, testInfo) => {
  test.skip(!(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)), "Uses the local demo admin only.");

  const releaseLock = await acquireLocalContentStoreLock();
  const storePath = path.resolve(process.cwd(), "data", "lamilialomi-content.local.json");
  const originalStore = fs.existsSync(storePath) ? fs.readFileSync(storePath) : undefined;
  try {
    await signInAsAdmin(page);
    await page.goto("/admin/pages/terms");
    const title = page.getByRole("textbox", { name: "Tytuł" });
    await title.fill("Transport failure draft");

    let intercepted = false;
    await page.route("**/admin/pages/terms", async (route) => {
      if (!intercepted && route.request().method() === "POST") {
        intercepted = true;
        await route.fulfill({ status: 503, contentType: "text/plain", body: "Temporary upstream failure" });
        return;
      }
      await route.continue();
    });

    await page.getByTestId("admin-save-bar").getByRole("button", { name: /Zapisz/ }).click();
    await expect(page.getByText("Nie udało się wysłać zapisu. Twoje zmiany pozostały w edytorze.")).toBeVisible();
    await expect(title).toHaveValue("Transport failure draft");
    await expect(page.getByTestId("admin-save-bar")).toContainText("Nie udało się połączyć z serwerem");

    const dialogPromise = page.waitForEvent("dialog").then(async (dialog) => {
      const message = dialog.message();
      await dialog.dismiss();
      return message;
    });
    const clickPromise = page.locator("#page-editor-form").getByRole("link", { name: "Strony" }).click();
    const [message] = await Promise.all([dialogPromise, clickPromise]);
    expect(message).toBe("Masz niezapisane zmiany. Opuścić edytor i je odrzucić?");

    let unexpectedDialog: string | undefined;
    page.on("dialog", async (nextDialog) => {
      unexpectedDialog = nextDialog.message();
      await nextDialog.dismiss();
    });
    await page.getByTestId("admin-save-bar").getByRole("button", { name: /Zapisz/ }).click();
    await expect(page.getByText("Zmiany strony zostały zapisane.")).toBeVisible();
    await expect(page.getByTestId("admin-save-bar")).toContainText("Zapisano");
    await page.locator("#page-editor-form").getByRole("link", { name: "Strony" }).click();
    await expect(page).toHaveURL(/\/admin\/pages$/);
    expect(unexpectedDialog).toBeUndefined();
  } finally {
    if (originalStore) fs.writeFileSync(storePath, originalStore);
    else if (fs.existsSync(storePath)) fs.rmSync(storePath);
    releaseLock();
  }
});

async function signInAsAdmin(page: Page) {
  await page.goto("/pl/login?redirectTo=/admin");
  await page.getByLabel(/^(e-mail|email)$/i).fill("admin@lamilialomi.test");
  await page.getByLabel(/^(hasło|password)$/i).fill("demo-password");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.getByRole("button", { name: /^(kontynuuj|continue)$/i }).click(),
  ]);
}
