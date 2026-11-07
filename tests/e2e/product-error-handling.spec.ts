import { expect, test } from "@playwright/test";
import path from "node:path";
import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

const productSlug = "moon-garden-coloring-book";

test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ll_cookie_consent",
      JSON.stringify({ essential: true, analytics: false }),
    );
  });
});

test("product gallery images load through the Next image optimizer without browser errors", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const imageResponses: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("/_next/image")) {
      imageResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  const response = await page.goto(`/en/products/${productSlug}`);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Moon Garden Coloring Book" })).toBeVisible();
  await expect.poll(async () => page.locator("img").evaluateAll((images) =>
    images.filter((image) => image.getAttribute("src")?.includes("/_next/image")).every(
      (image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0,
    ),
  )).toBe(true);

  expect(imageResponses.length).toBeGreaterThan(0);
  expect(imageResponses.every((entry) => entry.startsWith("200 "))).toBe(true);
  expect(consoleErrors).toEqual([]);

  await testInfo.attach("product-image-network.log", {
    body: imageResponses.join("\n"),
    contentType: "text/plain",
  });
  await testInfo.attach("product-browser-console.log", {
    body: consoleErrors.join("\n") || "No browser console errors.",
    contentType: "text/plain",
  });
  await page.screenshot({ path: testInfo.outputPath("product-image-flow.png"), fullPage: true });
});

test("admin saves a product with an uploaded asset", async ({ page }, testInfo) => {
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  test.skip(
    !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
    "Admin product-write E2E uses fixed demo credentials and requires a loopback app running the local demo backend.",
  );
  // The local content-store lock can queue this flow behind a full editor run.
  test.setTimeout(600_000);
  const releaseContentStoreLock = await acquireLocalContentStoreLock();
  const consoleErrors: string[] = [];
  const expectedUploadFallbackErrors: string[] = [];
  const serverErrors: string[] = [];
  const uniqueSuffix = `${Date.now()}-${testInfo.project.name}`;
  const uniqueTitle = `E2E Product ${uniqueSuffix}`;
  let productPath: string | undefined;

  page.on("console", (message) => {
    if (message.type() === "error") {
      if (message.text().includes("server responded with a status of 415")) {
        expectedUploadFallbackErrors.push(message.text());
      } else {
        consoleErrors.push(message.text());
      }
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  try {
    await page.goto("/en/login?redirectTo=/admin");
    await page.getByLabel("Email").fill("admin@lamilialomi.test");
    await page.getByLabel("Password").fill("demo-password");
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/admin"),
      page.getByRole("button", { name: "Continue" }).click(),
    ]);

    await page.goto("/admin/products/new");
    await page.getByLabel("Tytuł").fill(uniqueTitle);
    await page.getByLabel("Krótki opis").fill("E2E product used to verify the complete admin save flow.");
    await page.locator("#media-upload-public_download").setInputFiles(
      path.resolve(process.cwd(), "public", "assets", "downloads", "moon-garden-free-guide.pdf"),
    );
    await expect(page.getByText("Przesłano", { exact: true })).toBeVisible();

    await Promise.all([
      page.getByRole("button", { name: /Zapisz/ }).click(),
    ]);
    await expect(page.getByRole("status").filter({ hasText: "Zmiany produktu zostały zapisane." })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]+$/i);

    productPath = new URL(page.url()).pathname;
    await expect(page.getByTestId("product-save-bar").getByRole("status"))
      .toHaveText("Wszystkie zmiany są zapisane");
    expect(serverErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(expectedUploadFallbackErrors.length).toBeLessThanOrEqual(1);

    await testInfo.attach("admin-save-network.log", {
      body: "Asset upload and product save completed without 5xx responses.",
      contentType: "text/plain",
    });
    await page.screenshot({ path: testInfo.outputPath("admin-product-save.png"), fullPage: true });

  } finally {
    try {
      if (productPath) {
        const dialogs: string[] = [];
        const acceptTestDialogs = async (dialog: import("@playwright/test").Dialog) => {
          dialogs.push(dialog.type());
          await dialog.accept();
        };
        page.on("dialog", acceptTestDialogs);
        try {
          await page.goto(productPath);
          await expect(page.getByRole("textbox", { name: "Długi opis" })).toBeVisible();
          await expect(page.getByText("Nie dodano jeszcze prac.", { exact: true })).toBeVisible();
          const deleteActionResponse = page.waitForResponse((response) =>
            response.request().method() === "POST" &&
            Boolean(response.request().headers()["next-action"]) &&
            new URL(response.url()).pathname === productPath,
          );
          await Promise.all([
            page.waitForURL((url) => url.pathname === "/admin/products"),
            page.getByRole("button", { name: "Usuń produkt", exact: true }).click(),
          ]);
          expect((await deleteActionResponse).status()).toBe(200);
          expect(dialogs).toContain("confirm");
          await expect(page.getByRole("status").filter({ hasText: "Produkt został usunięty." })).toBeVisible();
          await expect(page).toHaveURL("/admin/products");
        } finally {
          page.off("dialog", acceptTestDialogs);
        }
      }
    } finally {
      releaseContentStoreLock();
    }
  }
});
