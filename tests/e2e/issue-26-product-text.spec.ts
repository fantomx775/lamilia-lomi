import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test.setTimeout(60_000);

let releaseContentStoreLock: (() => void) | undefined;

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
    "Issue #26 browser verification requires the loopback app running with the local demo backend.",
  );
  releaseContentStoreLock = await acquireLocalContentStoreLock();
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ll_cookie_consent",
      JSON.stringify({ essential: true, analytics: false }),
    );
  });
});

test.afterEach(() => {
  releaseContentStoreLock?.();
  releaseContentStoreLock = undefined;
});

test("product text fields count, warn, survive failed saves, and persist on create and edit", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const titlePrefix = "Issue 26 product ";
  const maximumTitle = `${titlePrefix}${"T".repeat(140 - titlePrefix.length)}`;
  const maximumDescription = `Issue 26 short description ${"S".repeat(300 - "Issue 26 short description ".length)}`;
  const slug = `issue-26-${suffix.toLowerCase()}`;
  const consoleErrors: string[] = [];
  const environmentWarnings: string[] = [];
  const unexpectedFailedRequests: string[] = [];
  const unexpectedServerErrors: string[] = [];
  let failureIntercepted = false;
  let productPath: string | undefined;

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const messageText = message.text();
    if (failureIntercepted && messageText.includes("503")) return;
    if (messageText.includes("A tree hydrated") && messageText.includes("caret-color")) {
      environmentWarnings.push("The browser environment injected caret-color styles before hydration.");
      return;
    }
    consoleErrors.push(messageText);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "failed";
    // Next redirects successful server actions by aborting the POST after it
    // starts navigation; that is expected and the destination is asserted below.
    if (failure !== "net::ERR_ABORTED") {
      unexpectedFailedRequests.push(`${request.method()} ${request.url()}: ${failure}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() < 500) return;
    const expectedSaveFailure = failureIntercepted && response.status() === 503 && Boolean(response.request().headers()["next-action"]);
    if (!expectedSaveFailure) unexpectedServerErrors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("/pl/login?redirectTo=/admin");
  await page.getByLabel("E-mail").fill("admin@lamilialomi.test");
  await page.getByLabel("Hasło").fill("demo-password");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.getByRole("button", { name: "Kontynuuj" }).click(),
  ]);

  try {
    await page.goto("/admin/products/new");
    const title = page.getByLabel("Tytuł");
    const shortDescription = page.getByLabel("Krótki opis");

    await expect(title).toHaveAttribute("maxlength", "140");
    await expect(shortDescription).toHaveAttribute("maxlength", "300");
    await expect(shortDescription).toHaveAttribute("rows", "4");
    await title.fill("T".repeat(120));
    await shortDescription.fill("S".repeat(280));
    await expect(page.locator("#product-title-counter")).toHaveText("120 / 140 znaków");
    await expect(page.locator("#product-short-description-counter")).toHaveText("280 / 300 znaków");
    await expect(page.getByText("Zbliżasz się do limitu. Pozostało 20 znaków.")).toHaveCount(2);

    await title.fill(maximumTitle);
    await shortDescription.fill(maximumDescription);
    await page.getByLabel("Adres produktu").fill(slug);
    await expect(page.locator("#product-title-counter")).toHaveText("140 / 140 znaków");
    await expect(page.locator("#product-short-description-counter")).toHaveText("300 / 300 znaków");
    await expect(page.getByText("Osiągnięto limit 140 znaków.")).toBeVisible();
    await expect(page.getByText("Osiągnięto limit 300 znaków.")).toBeVisible();

    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"] && !failureIntercepted) {
        failureIntercepted = true;
        await route.fulfill({ status: 503, contentType: "text/plain", body: "Simulated local save failure" });
        return;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: /Zapisz/ }).click();
    await expect(page.getByText("Nie udało się zapisać. Twoje wpisane wartości są zachowane.")).toBeVisible();
    await expect(title).toHaveValue(maximumTitle);
    await expect(shortDescription).toHaveValue(maximumDescription);
    await expect(page).toHaveURL(/\/admin\/products\/new$/);
    expect(failureIntercepted).toBe(true);
    await page.unrouteAll();

    await Promise.all([
      page.waitForURL((url) => /\/admin\/products\/[0-9a-f-]+\?saved=1$/i.test(url.pathname + url.search)),
      page.getByRole("button", { name: /Zapisz/ }).click(),
    ]);
    productPath = new URL(page.url()).pathname;

    await page.reload();
    await expect(page.getByLabel("Tytuł")).toHaveValue(maximumTitle);
    await expect(page.getByLabel("Krótki opis")).toHaveValue(maximumDescription);
    await expect(page.locator("#product-title-counter")).toHaveText("140 / 140 znaków");

    const editedTitle = "Issue 26 edited product title";
    const editedDescription = "Updated short description after creating the product.";
    await page.getByLabel("Tytuł").fill(editedTitle);
    await page.getByLabel("Krótki opis").fill(editedDescription);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const editSaveButton = page.getByTestId("product-save-bar").getByRole("button", { name: "Zapisz zmiany" });
    await expect(editSaveButton).toBeEnabled();
    if (testInfo.project.name === "mobile") {
      // Pixel 7 emulation keeps a larger layout viewport after input focus;
      // native button activation avoids its fixed-bar coordinate mismatch.
      await editSaveButton.evaluate((button: HTMLButtonElement) => button.click());
    } else {
      await editSaveButton.click();
    }
    await expect(page.getByTestId("product-save-bar").getByRole("status"))
      .toHaveText("Zapisano. Zmiany są aktualne.", { timeout: 15_000 });

    await page.reload();
    await expect(page.getByLabel("Tytuł")).toHaveValue(editedTitle);
    await expect(page.getByLabel("Krótki opis")).toHaveValue(editedDescription);

    const visualTitle = `Issue 26 visual title ${"T".repeat(103)}`;
    const visualDescriptionPrefix = "Issue 26 visual short description ";
    const visualDescription = `${visualDescriptionPrefix}${"S".repeat(285 - visualDescriptionPrefix.length)}`;
    await page.getByLabel("Tytuł").fill(visualTitle);
    await page.getByLabel("Krótki opis").fill(visualDescription);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await expect(page.locator("#product-title-counter")).toHaveText("125 / 140 znaków");
    await expect(page.locator("#product-short-description-counter")).toHaveText("285 / 300 znaków");
    await expect(page.getByText("Zbliżasz się do limitu. Pozostało 15 znaków.")).toHaveCount(2);

    const screenshotPath = path.resolve(
      process.cwd(),
      "docs",
      "verification",
      "issue-26",
      `product-fields-${testInfo.project.name}.png`,
    );
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.getByRole("heading", { name: "Podstawowe informacje" })
      .locator("xpath=../..")
      .screenshot({
        path: screenshotPath,
        animations: "disabled",
        style: "[data-testid='product-save-bar'], nextjs-portal { display: none !important; }",
      });

    expect(consoleErrors).toEqual([]);
    expect(unexpectedFailedRequests).toEqual([]);
    expect(unexpectedServerErrors).toEqual([]);
    await testInfo.attach("issue-26-browser-diagnostics.txt", {
      body: JSON.stringify({ consoleErrors, environmentWarnings, unexpectedFailedRequests, unexpectedServerErrors }, null, 2),
      contentType: "text/plain",
    });
  } finally {
    if (productPath && !page.isClosed()) {
      const acceptDialog = (dialog: import("@playwright/test").Dialog) => void dialog.accept();
      page.on("dialog", acceptDialog);
      try {
        await page.goto(productPath);
        const deleteButton = page.getByRole("button", { name: "Usuń produkt" });
        await Promise.all([
          page.waitForURL((url) => url.pathname === "/admin/products" && url.searchParams.get("deleted") === "1", { timeout: 15_000 }),
          testInfo.project.name === "mobile"
            ? deleteButton.evaluate((button: HTMLButtonElement) => button.click())
            : deleteButton.click(),
        ]);
      } catch (cleanupError) {
        console.warn("Issue #26 local test product cleanup failed:", cleanupError instanceof Error ? cleanupError.message : "unknown error");
      } finally {
        page.off("dialog", acceptDialog);
      }
    }
  }
});
