import { expect, test } from "@playwright/test";

const productSlug = "moon-garden-coloring-book";
const premiumAssetId = "asset-moon-premium-pdf";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ll_cookie_consent",
      JSON.stringify({ essential: true, analytics: false }),
    );
  });
});

test("valid QR entry keeps product and locale context", async ({ page }) => {
  const response = await page.goto(`/pl/unlock/${productSlug}`);

  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/pl/products/${productSlug}#premium`));
  await expect(page.getByRole("heading", { name: "Księżycowy Ogród. Kolorowanka" })).toBeVisible();
  await expect(page.getByTestId("unlock-guest-state")).toBeVisible();
  await expect(page.getByLabel("Kod premium")).toBeVisible();
});

test("guest login preserves code intent without putting code in the auth return URL", async ({ page }) => {
  await page.goto(`/pl/products/${productSlug}?code=LOMI-BOOK-2026`);
  await page.getByRole("button", { name: "Zaloguj się" }).click();

  await expect(page).toHaveURL(new RegExp(`/pl/login\\?returnTo=`));
  expect(page.url()).not.toContain("code=");
  await page.getByLabel("E-mail").fill("locked@example.com");
  await page.getByRole("button", { name: "Kontynuuj" }).click();

  await expect(page).toHaveURL(new RegExp(`/pl/products/${productSlug}`));
  expect(page.url()).not.toContain("code=");
  await expect(page.getByLabel("Kod premium")).toHaveValue("LOMI-BOOK-2026");
  await page.reload();
  await expect(page.getByLabel("Kod premium")).toHaveValue("LOMI-BOOK-2026");
});

test("registration and verification resume the unlock journey", async ({ page }) => {
  await page.goto(`/de/unlock/${productSlug}`);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await expect(page).toHaveURL(new RegExp(`/de/register\\?returnTo=`));

  await page.getByLabel("E-Mail").fill("new-reader@example.com");
  await page.getByLabel("Passwort").fill("password123");
  await page.getByRole("checkbox", { name: /Nutzungsbedingungen/ }).check();
  await page.getByRole("button", { name: "Konto erstellen" }).click();

  await expect(page).toHaveURL(new RegExp(`/de/products/${productSlug}`));
  await expect(page.getByTestId("unlock-verification-state")).toBeVisible();
  await page.getByRole("button", { name: "Demo-E-Mail als bestätigt markieren" }).click();
  await expect(page.getByTestId("unlock-code-state")).toBeVisible();
  await page.getByLabel("Premium-Code").fill("  lomi-book-2026 ");
  await page.getByRole("button", { name: "Premium-Inhalte freischalten" }).click();

  await expect(page.getByTestId("unlock-success-state")).toBeVisible();
  await page.getByRole("link", { name: "Zur Bibliothek" }).click();
  await expect(page).toHaveURL(/\/de\/library/);
  await expect(page.getByRole("heading", { name: "Meine Bibliothek" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Moon Garden Coloring Book/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: /Moon Garden Coloring Book/ })).toBeVisible();
});

test("verified owner reaches Library and downloads only through the authorized route", async ({ page }) => {
  await page.goto(`/en/unlock/${productSlug}`);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByLabel("Email").fill("locked@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Premium code").fill("lomi-book-2026");
  await page.getByLabel("Premium code").press("Enter");
  await expect(page.getByTestId("unlock-success-state")).toBeVisible();

  await page.getByRole("link", { name: "Go to My Library" }).click();
  await expect(page.getByRole("heading", { name: "My Library" })).toBeVisible();
  await page.getByRole("link", { name: /Moon Garden Coloring Book/ }).click();
  const downloadResponse = await page.request.get(`/api/downloads/${premiumAssetId}?locale=en&returnTo=%2Fen%2Fproducts%2F${productSlug}`);

  expect(downloadResponse.status()).toBe(200);
  expect(downloadResponse.headers()["content-disposition"]).toContain("moon-garden-bonus.pdf");
  expect((await downloadResponse.body()).subarray(0, 4).toString()).toBe("%PDF");

  const publicFileResponse = await page.request.get("/demo-premium/moon-garden-bonus.pdf");
  expect(publicFileResponse.status()).toBe(404);
});

test("invalid code is recoverable and already unlocked is a positive state", async ({ page }) => {
  await page.goto(`/en/login?returnTo=/en/products/${productSlug}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("unlock-success-state")).toBeVisible();

  await page.context().clearCookies();
  await page.goto(`/en/unlock/${productSlug}`);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByLabel("Email").fill("locked@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Premium code").fill("NOT-REAL");
  await expect(page.getByRole("link", { name: /Download premium file/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Unlock premium content" }).click();
  await expect(page.locator("#premium-code-error")).toHaveText(/could not unlock/i);
});

test("empty Library state is actionable for an authenticated locked reader", async ({ page }) => {
  await page.goto("/en/login?returnTo=/en/library");
  await page.getByLabel("Email").fill("locked@example.com");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByTestId("library-empty-state")).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse products" })).toBeVisible();
});

test("unknown QR product, guest download, and external return targets are controlled", async ({ page }) => {
  const unknown = await page.goto("/es/unlock/not-a-product");
  expect(unknown?.status()).toBe(404);

  const guestDownload = await page.request.get(`/api/downloads/${premiumAssetId}?locale=es&returnTo=%2Fes%2Fproducts%2F${productSlug}`);
  expect(guestDownload.status()).toBe(401);
  expect((await guestDownload.json()).next).toContain("/es/login?returnTo=");

  await page.goto("/en/login?returnTo=https%3A%2F%2Fevil.example%2Fphish");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/en\/library/);
});

test("critical funnel is usable at 375px and all supported locales keep funnel copy", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/en/unlock/${productSlug}`);
  await expect(page.getByLabel("Premium code")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const localeCopy: Record<string, string> = {
    pl: "Odblokuj bonus do książki",
    de: "Bonus zu deinem Buch freischalten",
    es: "Desbloquea el bonus de tu libro",
  };

  for (const [locale, title] of Object.entries(localeCopy)) {
    await page.goto(`/${locale}/unlock/${productSlug}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});
