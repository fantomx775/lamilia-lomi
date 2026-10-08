import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

const productSlug = "moon-garden-coloring-book";

test("auth pages explain errors and preserve a product return path", async ({ page }, testInfo) => {
  await page.goto(
    `/en/login?error=invalid_credentials&returnTo=%2Fen%2Fproducts%2F${productSlug}`,
  );

  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(page.locator("#login-error")).toHaveText(
    "That email and password combination could not be verified. Check both and try again.",
  );
  const createAccountLink = page.getByRole("link", { name: "Create account" });
  await expect(createAccountLink).toHaveAttribute(
    "href",
    `/en/register?returnTo=%2Fen%2Fproducts%2F${productSlug}`,
  );
  await saveEvidenceScreenshot(page, testInfo, "login-invalid-credentials");

  await createAccountLink.click();
  await expect(page).toHaveURL(new RegExp(`/en/register\\?returnTo=`));
  const loginLink = page.getByRole("main").getByRole("link", { name: "Log in" });
  await expect(loginLink).toHaveAttribute(
    "href",
    `/en/login?returnTo=%2Fen%2Fproducts%2F${productSlug}`,
  );
  await expect(page.getByLabel("Password")).toHaveAttribute("minlength", "8");
  await saveEvidenceScreenshot(page, testInfo, "register-product-return");

  await loginLink.click();
  await expect(page).toHaveURL(new RegExp(`/en/login\\?returnTo=`));
  await expect(page.locator('input[name="returnTo"]')).toHaveValue(
    `/en/products/${productSlug}`,
  );
});

test("registration required fields stop an empty submission in the browser", async ({ page }) => {
  await page.goto(`/en/register?returnTo=%2Fen%2Fproducts%2F${productSlug}`);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(new RegExp(`/en/register\\?returnTo=`));
  expect(
    await page.getByLabel("Email").evaluate((element) => (element as HTMLInputElement).validity.valueMissing),
  ).toBe(true);
  expect(
    await page.getByLabel("Password").evaluate((element) => (element as HTMLInputElement).validity.valueMissing),
  ).toBe(true);
  expect(
    await page.getByRole("checkbox", { name: /Terms/ }).evaluate((element) =>
      (element as HTMLInputElement).validity.valueMissing,
    ),
  ).toBe(true);
});

test("verification pending state explains the next step and offers a safe resend link", async ({ page }, testInfo) => {
  await page.context().clearCookies();
  await page.goto(`/en/products/${productSlug}?step=verify#premium`);

  await expect(page.getByTestId("product-unlock-section")).toBeInViewport();
  await expect(page.getByText("Check your inbox to verify your email")).toBeVisible();
  const resendLink = page.getByRole("link", { name: "Need a new verification link?" });
  await expect(resendLink).toHaveAttribute(
    "href",
    `/en/login?error=verification_required&returnTo=%2Fen%2Fproducts%2F${productSlug}`,
  );
  await expect(page.getByLabel("Premium code")).toHaveValue("");
  await saveEvidenceScreenshot(page, testInfo, "verification-pending");

  await resendLink.click();
  await expect(page).toHaveURL(
    new RegExp(`/en/login\\?error=verification_required&returnTo=%2Fen%2Fproducts%2F${productSlug}$`),
  );
  await expect(page.locator("#login-error")).toHaveText(
    "Enter the email address that received the verification link, then request a new one.",
  );
  await expect(page.locator("#verification-email")).toBeVisible();
});

test("auth route reports client and network errors without exposing form values", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const redact = (value: string) =>
    value
      .replace(/LOMI-[A-Z0-9-]+/gi, "[redacted-code]")
      .replace(/demo-password/g, "[redacted-password]")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(redact(message.text()).slice(0, 800));
    }
  });
  page.on("pageerror", (error) => pageErrors.push(redact(error.message)));
  page.on("requestfailed", (request) => {
    try {
      failedRequests.push(new URL(request.url()).pathname);
    } catch {
      failedRequests.push("[unparseable request URL]");
    }
  });

  await page.goto("/en/login?error=invalid_credentials");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();

  const diagnostics = {
    project: testInfo.project.name,
    pageErrors,
    failedRequests,
    consoleErrors,
  };
  const folder = path.resolve(process.cwd(), "docs", "verification", "issue-30");
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, `${testInfo.project.name}-browser-diagnostics.json`),
    `${JSON.stringify(diagnostics, null, 2)}\n`,
    "utf8",
  );

  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes("A tree hydrated") && !message.includes("caret-color"))).toEqual([]);
});

test("pending login disables repeat submission until the action finishes", async ({ page }) => {
  await page.goto("/en/login?returnTo=%2Fen%2Faccount");

  let releaseAction = () => {};
  let signalActionStarted = () => {};
  const actionStarted = new Promise<void>((resolve) => {
    signalActionStarted = resolve;
  });
  const holdAction = new Promise<void>((resolve) => {
    releaseAction = resolve;
  });
  let actionCount = 0;

  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      actionCount += 1;
      if (actionCount === 1) {
        signalActionStarted();
        await holdAction;
      }
    }
    await route.continue();
  });

  try {
    const submit = page.locator('main form button[type="submit"]').first();
    await submit.click();
    await actionStarted;
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText("Signing in…");
    await submit.evaluate((element) => (element as HTMLButtonElement).click());
    expect(actionCount).toBe(1);
  } finally {
    releaseAction();
  }

  await expect(page).toHaveURL(/\/en\/account$/);
  expect(actionCount).toBe(1);
});

test("guest browser download returns to login with its product context", async ({ page }) => {
  await page.context().clearCookies();

  await page.goto(
    `/api/downloads/asset-moon-premium-pdf?locale=en&returnTo=%2Fen%2Fproducts%2F${productSlug}`,
    { waitUntil: "domcontentloaded" },
  );

  await expect(page).toHaveURL(
    new RegExp(`/en/login\\?returnTo=%2Fen%2Fproducts%2F${productSlug}$`),
  );
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(page.locator('input[name="returnTo"]')).toHaveValue(
    `/en/products/${productSlug}`,
  );
});

async function saveEvidenceScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const essentialConsent = page.getByRole("button", {
    name: "Essential",
    exact: true,
  });
  const consentIsUnset = await page.evaluate(
    () => window.localStorage.getItem("ll_cookie_consent") === null,
  );
  if (consentIsUnset) {
    await essentialConsent.waitFor({ state: "visible", timeout: 2_000 });
    await essentialConsent.click();
    await expect(essentialConsent).toBeHidden();
  }
  await page.addStyleTag({
    content: 'input[id*="premium-code"]::placeholder { color: transparent !important; }',
  });

  const folder = path.resolve(process.cwd(), "docs", "verification", "issue-30");
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: path.join(folder, `${testInfo.project.name}-${name}.png`),
    fullPage: name !== "verification-pending",
  });
}
