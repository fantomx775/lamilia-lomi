import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

const collectionName = (project: string) => `Issue 49 ${project} collection`;
const collectionSlug = (project: string) => `issue-49-${project}-collection`;
const productTitle = (project: string) => `Issue 49 ${project} product`;
const productSlug = (project: string) => `issue-49-${project}-product`;
const evidenceDirectory = path.resolve(process.cwd(), "docs", "verification", "issue-49");

let releaseContentStoreLock: (() => void) | undefined;

test.setTimeout(180_000);

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
    "Issue 49 browser verification requires the loopback local demo backend.",
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

test("manages collections, assigns products, and preserves products when a collection is deleted", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const collection = collectionName(project);
  const slug = collectionSlug(project);
  const product = productTitle(project);
  const productAddress = productSlug(project);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: Array<{
    method: string;
    url: string;
    error: string;
    disposition: "expected" | "unresolved";
    reason?: string;
  }> = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      const error = request.failure()?.errorText ?? "failed";
      const expectedNavigationAbort = error === "net::ERR_ABORTED";
      failedRequests.push({
        method: request.method(),
        url: url.pathname,
        error,
        disposition: expectedNavigationAbort ? "expected" : "unresolved",
        ...(expectedNavigationAbort ? {
          reason: url.pathname.startsWith("/__nextjs_font/")
            ? "The browser canceled an in-flight font request while replacing the page during a verified admin navigation."
            : "The browser canceled an in-flight admin page or Server Action request while replacing the page; the next route and persisted product/collection state were verified.",
        } : {}),
      });
    }
  });

  let collectionCreated = false;
  let productCreated = false;
  let collectionDeleted = false;
  let productDeleted = false;
  let createdCollectionId = "";

  try {
    await signInAsAdmin(page);
    await page.setViewportSize(project === "chromium"
      ? { width: 1600, height: 1000 }
      : { width: 412, height: 1200 });
    await cleanupProduct(page, product).catch(() => undefined);
    await cleanupCollection(page, collection).catch(() => undefined);

    await page.goto("/admin/collections");
    await page.getByRole("button", { name: "Dodaj kolekcję" }).click();
    createdCollectionId = await page.locator('input[name="id"]').inputValue();
    await page.getByLabel("Nazwa").fill(collection);
    await page.getByLabel("Slug").fill(slug);
    await page.locator('input[type="file"][aria-label="Wybierz obraz kolekcji"]').setInputFiles({
      name: "collection.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
        "base64",
      ),
    });
    const imagePreview = page.getByAltText(`Podgląd obrazu kolekcji ${collection}`);
    await expect(imagePreview).toBeVisible();
    await expect(imagePreview).toHaveJSProperty("naturalWidth", 1);
    await page.getByRole("button", { name: "Zapisz", exact: true }).click();
    await expect(page.getByRole("button", { name: `Edytuj kolekcję ${collection}` }).first()).toBeVisible();
    collectionCreated = true;

    await page.goto("/admin/products/new");
    await page.getByLabel("Tytuł").fill(product);
    await page.getByLabel("Krótki opis").fill("Temporary product used to verify Issue 49 collection administration.");
    await page.getByLabel("Adres produktu").fill(productAddress);
    await page.getByLabel("Pozycja w katalogu").fill("1");
    await page.getByLabel("Kolekcja").selectOption({ label: collection });
    for (const category of ["Coloring books", "Picture books", "Mindfulness"]) {
      await page.getByLabel(category).check();
    }
    for (const tag of ["Printable bonus", "Amazon KDP", "Calm evening"]) {
      await page.getByLabel(tag).check();
    }
    const productId = await page.locator('#product-editor-form input[name="id"]').inputValue();
    await page.getByTestId("product-save-bar").getByRole("button", { name: /Zapisz/ }).click();
    await expect(page.getByText("Zapisano. Zmiany są aktualne.")).toBeVisible();
    productCreated = true;
    const productPath = `/admin/products/${productId}`;
    await page.goto(productPath);
    await expect(page.getByLabel("Kolekcja")).toHaveValue(createdCollectionId);

    await page.goto("/admin/collections");
    if (project === "chromium") {
      await expect(page.getByRole("row").filter({ hasText: collection }).locator("td").last()).toHaveText("1");
    } else {
      await expect(page.getByText("1 produkt", { exact: true })).toBeVisible();
    }
    await saveScreenshot(
      page,
      `collections-${project}.png`,
      page.getByRole("button", { name: `Edytuj kolekcję ${collection}` }).first(),
    );

    await page.goto("/admin/products");
    const visibleProductLink = page.locator('a[href^="/admin/products/"]:visible').filter({ hasText: product }).first();
    await expect(visibleProductLink).toBeVisible();
    await expect(page.locator('button[aria-label="Pokaż 1 kolejnych kategorii"]:visible').first()).toBeVisible();
    await expect(page.locator('button[aria-label="Pokaż 1 kolejnych tagów"]:visible').first()).toBeVisible();
    if (project === "chromium") {
      await expect(page.getByRole("columnheader", { name: "Kolekcja" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Kategorie" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Tagi" })).toBeVisible();
    } else {
      await expect(page.locator("dt").filter({ hasText: "Kolekcja" }).first()).toBeVisible();
    }
    await page.locator('button[aria-label="Pokaż 1 kolejnych kategorii"]:visible').first().click();
    await page.locator('button[aria-label="Pokaż 1 kolejnych tagów"]:visible').first().click();
    await expect(page.locator("li:visible").filter({ hasText: "Mindfulness" }).first()).toBeVisible();
    await expect(page.locator("li:visible").filter({ hasText: "Calm evening" }).first()).toBeVisible();
    await saveScreenshot(page, `products-${project}.png`, visibleProductLink);

    await page.goto("/admin/collections");
    await page.getByRole("button", { name: `Edytuj kolekcję ${collection}` }).first().click();
    await expect(page.getByRole("dialog", { name: "Edytuj kolekcję" })).toBeVisible();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Usuń kolekcję" }).click();
    await expect(page.getByRole("dialog", { name: "Edytuj kolekcję" })).toHaveCount(0);
    collectionDeleted = true;
    await expect(page.getByRole("button", { name: `Edytuj kolekcję ${collection}` })).toHaveCount(0);
    await page.goto(productPath);
    await expect(page.getByLabel("Kolekcja")).toHaveValue("");
    await expect(page.getByLabel("Adres produktu")).toHaveValue(productAddress);

    await deleteProduct(page, product);
    productDeleted = true;
  } finally {
    if (collectionCreated && !collectionDeleted) await cleanupCollection(page, collection).catch(() => undefined);
    if (productCreated && !productDeleted) await cleanupProduct(page, product).catch(() => undefined);
    await testInfo.attach("issue-49-browser-diagnostics.json", {
      body: Buffer.from(JSON.stringify({ consoleErrors, pageErrors, failedRequests }, null, 2)),
      contentType: "application/json",
    });
  }

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests.filter((request) => request.disposition === "unresolved")).toEqual([]);
});

async function signInAsAdmin(page: Page) {
  await page.goto("/en/login?redirectTo=/admin");
  await page.getByLabel("Email").fill("admin@lamilialomi.test");
  await page.getByLabel("Password").fill("demo-password");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/admin"),
    page.getByRole("button", { name: "Continue" }).click(),
  ]);
}

async function saveScreenshot(page: Page, filename: string, target: import("@playwright/test").Locator) {
  await mkdir(evidenceDirectory, { recursive: true });
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const viewport = page.viewportSize();
  if (viewport) await page.mouse.move(viewport.width - 1, viewport.height - 1);
  await page.screenshot({ path: path.join(evidenceDirectory, filename), animations: "disabled" });
}

async function cleanupCollection(page: Page, name: string) {
  await page.goto("/admin/collections");
  const editButton = page.getByRole("button", { name: `Edytuj kolekcję ${name}` }).first();
  if (!(await editButton.count())) return;
  await editButton.click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Usuń kolekcję" }).click();
  await expect(page.getByRole("dialog", { name: /kolekcję/ })).toHaveCount(0);
}

async function cleanupProduct(page: Page, name: string) {
  await page.goto("/admin/products");
  const productLink = page.locator('a[href^="/admin/products/"]:visible').filter({ hasText: name }).first();
  if (!(await productLink.count())) return;
  await productLink.click();
  await deleteProduct(page, name);
}

async function deleteProduct(page: Page, name: string) {
  await expect(page.getByLabel("Tytuł")).toHaveValue(name);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Usuń produkt" }).click();
  await expect(page).toHaveURL(/\/admin\/products(?:\?.*)?$/);
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
}
