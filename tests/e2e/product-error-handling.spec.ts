import { expect, test } from "@playwright/test";
import path from "node:path";

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

  const response = await page.goto(`/pl/products/${productSlug}`);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Księżycowy Ogród. Kolorowanka" })).toBeVisible();
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

test("admin blocks duplicate normalized premium codes before the save action", async ({ page }, testInfo) => {
  const serverErrors: string[] = [];
  const saveRequests: string[] = [];

  page.on("response", (response) => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/admin/products/new")) {
      saveRequests.push(request.url());
    }
  });

  await page.goto("/pl/login?redirectTo=/admin");
  await page.getByLabel("E-mail").fill("admin@lamilialomi.test");
  await page.getByLabel("Hasło").fill("demo-password");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.getByRole("button", { name: "Kontynuuj" }).click(),
  ]);

  await page.goto("/admin/products/new");
  await expect(page.getByRole("heading", { name: "Nowy produkt" })).toBeVisible();
  await page.getByRole("button", { name: "Dodaj kod" }).click();
  await page.getByRole("button", { name: "Dodaj kod" }).click();

  const codeInputs = page.getByLabel("Kod");
  await codeInputs.nth(0).fill("lomi-book");
  await codeInputs.nth(1).fill("LOMI – BOOK");
  await page.getByRole("button", { name: "Zapisz" }).click();

  await expect(page.getByText("Każdy kod premium może wystąpić w tym produkcie tylko raz.")).toHaveCount(2);
  await expect(codeInputs.nth(0)).toHaveAttribute("aria-invalid", "true");
  await expect(codeInputs.nth(1)).toHaveAttribute("aria-invalid", "true");
  expect(saveRequests).toEqual([]);
  expect(serverErrors).toEqual([]);

  await testInfo.attach("admin-browser-network.log", {
    body: serverErrors.join("\n") || "No 5xx responses; client validation prevented the save request.",
    contentType: "text/plain",
  });
  await page.screenshot({ path: testInfo.outputPath("admin-premium-duplicate.png"), fullPage: true });
});

test("admin saves a product with an uploaded asset and a unique premium code", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const expectedUploadFallbackErrors: string[] = [];
  const serverErrors: string[] = [];
  const uniqueSuffix = `${Date.now()}-${testInfo.project.name}`;
  const uniqueTitle = `E2E Product ${uniqueSuffix}`;
  const uniqueCode = `E2E-${uniqueSuffix}`.toUpperCase();
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
    await page.goto("/pl/login?redirectTo=/admin");
    await page.getByLabel("E-mail").fill("admin@lamilialomi.test");
    await page.getByLabel("Hasło").fill("demo-password");
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/admin"),
      page.getByRole("button", { name: "Kontynuuj" }).click(),
    ]);

    await page.goto("/admin/products/new");
    await page.getByLabel("Tytuł").fill(uniqueTitle);
    await page.getByLabel("Krótki opis").fill("E2E product used to verify the complete admin save flow.");
    await page.locator("#media-upload-public_download").setInputFiles(
      path.resolve(process.cwd(), "public", "assets", "downloads", "moon-garden-free-guide.pdf"),
    );
    await expect(page.getByText("Przesłano", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Dodaj kod" }).click();
    await page.getByLabel("Kod").fill(uniqueCode);

    await Promise.all([
      page.waitForURL((url) => /\/admin\/products\/[0-9a-f-]+\?saved=1$/i.test(url.pathname + url.search)),
      page.getByRole("button", { name: "Zapisz" }).click(),
    ]);

    productPath = new URL(page.url()).pathname;
    await expect(page.getByText("Zapisano zmiany.", { exact: true })).toBeVisible();
    expect(serverErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(expectedUploadFallbackErrors.length).toBeLessThanOrEqual(1);

    await testInfo.attach("admin-save-network.log", {
      body: "Asset upload and product save completed without 5xx responses.",
      contentType: "text/plain",
    });
    await page.screenshot({ path: testInfo.outputPath("admin-product-save.png"), fullPage: true });

    await page.goto("/admin/products/new");
    await page.getByLabel("Tytuł").fill(`E2E Duplicate Product ${uniqueSuffix}`);
    await page.getByRole("button", { name: "Dodaj kod" }).click();
    await page.getByLabel("Kod").fill(` ${uniqueCode.toLowerCase()} `);
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/admin/products/new" && url.searchParams.get("error") === "admin.conflict.premium_code_existing"),
      page.getByRole("button", { name: "Zapisz" }).click(),
    ]);
    await expect(page.getByText("Ten kod premium jest już przypisany do innego produktu.", { exact: true })).toBeVisible();
    expect(serverErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("admin-premium-existing.png"), fullPage: true });
  } finally {
    if (productPath) {
      await page.goto(productPath);
      page.once("dialog", (dialog) => void dialog.accept());
      await Promise.all([
        page.waitForURL((url) => url.pathname === "/admin/products" && url.searchParams.get("deleted") === "1"),
        page.getByRole("button", { name: "Usuń produkt" }).click(),
      ]);
    }
  }
});
