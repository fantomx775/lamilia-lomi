import { expect, test, type Page } from "@playwright/test";

const productSlug = "moon-garden-coloring-book";
const premiumAssetId = "asset-moon-premium-pdf";
const secondProductSlug = "bedtime-forest-picture-book";

const localeOptionNames = {
  en: "English (EN)",
  pl: "Polski (PL)",
  de: "Deutsch (DE)",
  es: "Español (ES)",
} as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ll_cookie_consent",
      JSON.stringify({ essential: true, analytics: false }),
    );
  });
});

test("valid QR entry keeps product and locale context", async ({ page }) => {
  const response = await page.goto(`/pl/unlock/${productSlug}?code=LOMI-BOOK-2026`);

  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/pl/products/${productSlug}#premium`));
  expect(page.url()).not.toContain("code=");
  await expect(page.getByRole("heading", { name: "Księżycowy Ogród. Kolorowanka" })).toBeVisible();
  await expect(page.getByTestId("unlock-guest-state")).toBeVisible();
  await expect(page.getByLabel("Kod premium")).toHaveValue("LOMI-BOOK-2026");
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

test("generic login opens account creation without unlock context", async ({ page }) => {
  await page.goto("/en/login");

  await expect(page.getByText("Don't have an account?")).toBeVisible();
  const createAccountLink = page.getByRole("link", { name: "Create account" });
  await expect(createAccountLink).toHaveAttribute("href", "/en/register");

  await createAccountLink.click();
  await expect(page).toHaveURL(/\/en\/register$/);
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();

  await page.getByLabel("Email").fill("new-reader@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("checkbox", { name: /Terms/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
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
  const directDownloadResponse = await page.request.get(
    `/api/downloads/${premiumAssetId}?locale=en&returnTo=%2Fen%2Fproducts%2F${productSlug}`,
  );
  expect(directDownloadResponse.status()).toBe(403);

  const downloadLink = page.locator(`a[href*="/api/downloads/${premiumAssetId}"]`);
  await expect(downloadLink).toHaveAttribute("href", /expires=.*token=/);
  const downloadHref = await downloadLink.getAttribute("href");
  expect(downloadHref).toBeTruthy();
  const downloadResponse = await page.request.get(downloadHref!);

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

test("mobile locale switcher exposes every locale and preserves code intent through auth", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/en/products/${productSlug}?code=LOMI-BOOK-2026&step=verify`);
  await expect(page.getByLabel("Premium code")).toBeVisible();
  await expect(page.getByLabel("Premium code")).toHaveValue("LOMI-BOOK-2026");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const menu = page.getByRole("button", { name: "Language: EN" });
  await menu.focus();
  await page.keyboard.press("Enter");
  const polishOption = page.getByRole("button", { name: localeOptionNames.pl });
  await expect(polishOption).toBeVisible();
  await polishOption.click();
  await expect(page).toHaveURL(new RegExp(`/pl/products/${productSlug}\\?step=verify$`));
  expect(page.url()).not.toContain("code=");
  await expect(page.getByLabel("Kod premium")).toHaveValue("LOMI-BOOK-2026");

  for (const locale of ["de", "es"] as const) {
    await switchLocaleThroughMobileMenu(page, locale);
    await expect(page).toHaveURL(new RegExp(`/${locale}/products/${productSlug}\\?step=verify$`));
    expect(page.url()).not.toContain("code=");
    await expect(page.getByRole("button", { name: new RegExp(`^Language: ${locale.toUpperCase()}$`) })).toBeVisible();
    await expect(page.getByLabel(locale === "de" ? "Premium-Code" : "Código premium")).toHaveValue("LOMI-BOOK-2026");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }

  await switchLocaleThroughMobileMenu(page, "en");
  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}\\?step=verify$`));
  await page.reload();
  await expect(page.getByLabel("Premium code")).toHaveValue("LOMI-BOOK-2026");

  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/login\\?returnTo=`));
  expect(page.url()).not.toContain("code=");
  await switchLocaleThroughMobileMenu(page, "de");
  await expect(page).toHaveURL(new RegExp(`/de/login\\?returnTo=%2Fde%2Fproducts%2F${productSlug}$`));
  expect(page.url()).not.toContain("code=");
  await page.getByLabel("E-Mail").fill("locked@example.com");
  await page.getByRole("button", { name: "Weiter" }).click();
  expect(page.url()).not.toContain("code=");
  await expect(page.getByLabel("Premium-Code")).toHaveValue("LOMI-BOOK-2026");
});

test("mobile locale switching keeps no-code state and prevents cross-product intent leakage", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/en/products/${productSlug}?code=LOMI-BOOK-2026`);
  await switchLocaleThroughMobileMenu(page, "pl");
  await expect(page.getByLabel("Kod premium")).toHaveValue("LOMI-BOOK-2026");

  await page.goto(`/en/products/${secondProductSlug}?step=verify`);
  await expect(page.getByLabel("Premium code")).toHaveValue("");
  await switchLocaleThroughMobileMenu(page, "de");
  await expect(page).toHaveURL(new RegExp(`/de/products/${secondProductSlug}\\?step=verify$`));
  await expect(page.getByLabel("Premium-Code")).toHaveValue("");
  await page.reload();
  await expect(page.getByLabel("Premium-Code")).toHaveValue("");

  await page.goto(`/en/products/${productSlug}`);
  await expect(page.getByLabel("Premium code")).toHaveValue("");
});

async function switchLocaleThroughMobileMenu(
  page: Page,
  locale: keyof typeof localeOptionNames,
) {
  const currentLocale = (new URL(page.url()).pathname.match(/^\/(en|pl|de|es)/)?.[1] ?? "en").toUpperCase();
  await page.getByRole("button", { name: `Language: ${currentLocale}` }).click();
  const option = page.getByRole("button", { name: localeOptionNames[locale] });
  await expect(option).toBeVisible();
  await option.click();
}
