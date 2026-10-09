import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isLocalDemoAppTarget } from "./local-target";

const productSlug = "moon-garden-coloring-book";

// This suite asserts local demo behavior and uses fixed synthetic demo emails.
// It must never submit those forms to a hosted Supabase project via baseURL.
test.describe("Issue 30 local demo auth-return coverage", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
      "Issue 30 auth-return browser coverage uses fixed demo data and requires a loopback app running the local demo backend.",
    );
  });

test("auth pages explain errors and preserve a product return path", async ({ page }, testInfo) => {
  await page.goto(
    `/en/login?error=invalid_credentials&returnTo=%2Fen%2Fproducts%2F${productSlug}`,
  );
  await page.locator('input[type="password"]').fill("");

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
  await expect(page).toHaveURL(new RegExp(`/en/register\\?returnTo=`), { timeout: 15_000 });
  const loginLink = page.getByRole("main").getByRole("link", { name: "Log in" });
  await expect(loginLink).toHaveAttribute(
    "href",
    `/en/login?returnTo=%2Fen%2Fproducts%2F${productSlug}`,
  );
  await expect(page.getByLabel("Password")).toHaveAttribute("minlength", "8");
  await saveEvidenceScreenshot(page, testInfo, "register-product-return");

  await loginLink.click();
  await expect(page).toHaveURL(new RegExp(`/en/login\\?returnTo=`), { timeout: 15_000 });
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

test("registration form completes through its server action without JavaScript", async ({ browser }, testInfo) => {
  const viewport = testInfo.project.name === "mobile"
    ? { width: 393, height: 852 }
    : { width: 1280, height: 800 };
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL ?? "http://127.0.0.1:3000",
    javaScriptEnabled: false,
    viewport,
  });

  try {
    const page = await context.newPage();
    await page.goto(`/en/register?returnTo=%2Fen%2Fproducts%2F${productSlug}`);
    await page.getByLabel("Email").fill("issue-30-no-js@example.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("checkbox", { name: /Terms/ }).check();
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`));

    await context.clearCookies();
    await page.goto("/en/login?returnTo=%2Fen%2Faccount");
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue("demo@lamilialomi.test");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/en\/account$/);
  } finally {
    await context.close();
  }
});

test("local verification pending state offers the demo login path", async ({ page }, testInfo) => {
  await page.context().clearCookies();
  await page.goto(`/en/products/${productSlug}?step=verify#premium`);

  await expect(page.getByTestId("product-unlock-section")).toBeInViewport();
  await expect(page.getByText("Demo mode does not send verification emails")).toBeVisible();
  const demoLoginLink = page.getByRole("link", { name: "Continue with demo login" });
  await expect(demoLoginLink).toHaveAttribute(
    "href",
    `/en/login?error=verification_required&returnTo=%2Fen%2Fproducts%2F${productSlug}`,
  );
  await expect(page.getByLabel("Premium code")).toHaveValue("");
  await saveEvidenceScreenshot(page, testInfo, "verification-pending");

  await demoLoginLink.click();
  await expect(page).toHaveURL(
    new RegExp(`/en/login\\?error=verification_required&returnTo=%2Fen%2Fproducts%2F${productSlug}$`),
  );
  await expect(page.locator("#login-error")).toHaveText(
    "Demo mode does not send verification emails. Use the demo login above to continue; it verifies the demo session locally.",
  );
  await expect(page.locator("#verification-email")).toHaveCount(0);
  await expect(page.getByLabel("Email")).toHaveValue("demo@lamilialomi.test");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`));
  await expect(page.getByTestId("product-unlock-section")).toBeInViewport();
});

test("local product registration returns to the visible demo verification action", async ({ page }, testInfo) => {
  await page.context().clearCookies();
  await page.goto(`/en/register?returnTo=%2Fen%2Fproducts%2F${productSlug}`);

  await page.getByLabel("Email").fill("issue-30-registration@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("checkbox", { name: /Terms/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`));
  await expect(page.getByTestId("product-unlock-section")).toBeInViewport();
  const verifyButton = page.getByRole("button", { name: "Mark demo email as verified" });
  await expect(verifyButton).toBeInViewport();
  await saveEvidenceScreenshot(page, testInfo, "local-registration-return");

  await verifyButton.click();
  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`));
  await expect(page.getByLabel("Premium code")).toBeInViewport();
});

test("premium code intent survives login and unlocks the product", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto(`/en/products/${productSlug}#premium`);

  const unlockSection = page.getByTestId("product-unlock-section");
  await unlockSection.getByLabel("Premium code").fill("LOMI-BOOK-2026");
  await unlockSection.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(new RegExp(`/en/login\\?returnTo=%2Fen%2Fproducts%2F${productSlug}$`));
  await expect(page).not.toHaveURL(/LOMI-BOOK-2026|premiumCode|[?&]code=/i);
  await expect(page.locator('input[name="code"]')).toHaveValue("LOMI-BOOK-2026");
  await page.getByLabel("Email").fill("premium-flow-reader@example.com");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`));
  await expect(page.getByLabel("Premium code")).toHaveValue("LOMI-BOOK-2026");
  await page.getByRole("button", { name: "Unlock premium content" }).click();

  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}\\?unlocked=1#premium$`));
  await expect(page.getByTestId("unlock-success-state")).toBeVisible();
  await expect(page).not.toHaveURL(/LOMI-BOOK-2026|premiumCode|[?&]code=/i);
});

test("premium code intent survives local registration, demo verification, and unlock", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.context().clearCookies();
  await page.goto(`/en/products/${productSlug}#premium`);

  const unlockSection = page.getByTestId("product-unlock-section");
  await unlockSection.getByLabel("Premium code").fill("LOMI-BOOK-2026");
  await unlockSection.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/en/register\\?returnTo=%2Fen%2Fproducts%2F${productSlug}$`),
    { timeout: 20_000 },
  );
  await expect(page.locator('input[name="code"]')).toHaveValue("LOMI-BOOK-2026");

  await page.getByLabel("Email").fill("premium-registration-reader@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("checkbox", { name: /Terms/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`), { timeout: 20_000 });
  const verifyButton = page.getByRole("button", { name: "Mark demo email as verified" });
  await expect(verifyButton).toBeInViewport();
  await saveEvidenceScreenshot(page, testInfo, "premium-registration-verification");

  await verifyButton.click();
  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`));
  await expect(page.getByTestId("unlock-code-state")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Premium code")).toHaveValue("LOMI-BOOK-2026");
  await page.getByRole("button", { name: "Unlock premium content" }).click();

  await expect(page).toHaveURL(
    new RegExp(`/en/products/${productSlug}\\?unlocked=1#premium$`),
    { timeout: 20_000 },
  );
  await expect(page.getByTestId("unlock-success-state")).toBeVisible();
  await expect(page).not.toHaveURL(/LOMI-BOOK-2026|premiumCode|[?&]code=/i);
  await saveEvidenceScreenshot(page, testInfo, "premium-registration-unlocked");
});

test("a missing session returns from a protected download to its product", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto(`/en/login?returnTo=%2Fen%2Fproducts%2F${productSlug}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`));

  await page.context().clearCookies({ name: "ll_demo_session" });
  await page.goto(
    `/api/downloads/asset-moon-premium-pdf?locale=en&returnTo=%2Fen%2Fproducts%2F${productSlug}`,
    { waitUntil: "domcontentloaded" },
  );
  await expect(page).toHaveURL(
    new RegExp(`/en/login\\?returnTo=%2Fen%2Fproducts%2F${productSlug}$`),
  );

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`));
  await expect(page.getByTestId("product-unlock-section")).toBeInViewport();
});

test("browser back and forward preserve the selected product return destination", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto(`/en/products/${productSlug}#premium`);

  await page.getByTestId("product-unlock-section").getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/register\\?returnTo=%2Fen%2Fproducts%2F${productSlug}$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/en/products/${productSlug}#premium$`));
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/en/register\\?returnTo=%2Fen%2Fproducts%2F${productSlug}$`));

  await page.getByRole("main").getByRole("link", { name: "Log in" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/login\\?returnTo=%2Fen%2Fproducts%2F${productSlug}$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/en/register\\?returnTo=%2Fen%2Fproducts%2F${productSlug}$`));
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/en/login\\?returnTo=%2Fen%2Fproducts%2F${productSlug}$`));
  await expect(page.locator('input[name="returnTo"]')).toHaveValue(`/en/products/${productSlug}`);
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/en/login\\?returnTo=%2Fen%2Fproducts%2F${productSlug}$`));
  await expect(page.locator('input[name="returnTo"]')).toHaveValue(`/en/products/${productSlug}`);
});

test("an external login return destination falls back to the library", async ({ page }) => {
  await page.goto("/en/login?returnTo=https%3A%2F%2Fevil.example%2Fphish");

  await expect(page.locator('input[name="returnTo"]')).toHaveValue("/en/library");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/en\/library$/, { timeout: 15_000 });
  await expect(page).not.toHaveURL(/evil\.example/);
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

test("pending login disables repeat submission until the action finishes", async ({ page }, testInfo) => {
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
    await saveEvidenceScreenshot(page, testInfo, "login-pending");
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
    content: `
      input[type="password"],
      input[id*="premium-code"],
      input[name="code"] {
        -webkit-text-security: disc !important;
      }
      input[id*="premium-code"]::placeholder { color: transparent !important; }
    `,
  });

  const folder = path.resolve(process.cwd(), "docs", "verification", "issue-30");
  await mkdir(folder, { recursive: true });
  const sensitiveFields = page.locator(
    'input[type="password"], input[id*="premium-code"], input[name="code"], input[name*="token"]',
  );
  await page.screenshot({
    path: path.join(folder, `${testInfo.project.name}-${name}.png`),
    fullPage: name !== "verification-pending",
    mask: [sensitiveFields],
    maskColor: "#111111",
  });
}
