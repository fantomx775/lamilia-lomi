import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const productSlug = "moon-garden-coloring-book";
const productId = "11111111-1111-4111-8111-111111111111";
const premiumAssetId = "11111111-1111-4111-8111-111111111105";
const appLogPath = process.env.ISSUE_30_APP_LOG_PATH;
const evidenceFolder = path.resolve(
  process.cwd(),
  "docs",
  "verification",
  "issue-30",
  "supabase-e2e",
);

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

test.describe("Issue 30 with the isolated local Supabase Auth service", () => {
  test("real email confirmation, cross-device resume, login, downloads, and auth negatives", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(300_000);

    test.skip(
      process.env.RUN_ISSUE_30_SUPABASE_E2E !== "1",
      "Run only against the explicitly configured isolated local Supabase stack.",
    );

    const mailpitUrl = requireLoopbackUrl(
      process.env.ISSUE_30_MAILPIT_URL ?? "http://127.0.0.1:56324",
      56324,
      "Mailpit",
    );
    const appUrl = requireLoopbackUrl(process.env.PLAYWRIGHT_BASE_URL, 3030, "application");
    const supabaseUrl = requireLoopbackUrl(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      56321,
      "Supabase",
    );
    const localMailpitUrl = requireLoopbackUrl(mailpitUrl, 56324, "Mailpit");
    if (process.env.LAMILIA_BACKEND !== "supabase") {
      throw new Error("The app must be explicitly configured for Supabase mode.");
    }
    if (!appLogPath) {
      throw new Error("The configured local Next.js development log path is required.");
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      throw new Error("The isolated Supabase service role key is unavailable to the test process.");
    }
    const publishableKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!publishableKey) {
      throw new Error("The isolated Supabase publishable key is unavailable to the test process.");
    }

    const admin = createAdminClient(supabaseUrl.href, serviceRoleKey);
    const verifier = createClient(supabaseUrl.href, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const sensitiveValues = new Set<string>();
    const createdEmails = new Set<string>();
    const completed: Record<string, string | number | boolean> = {};
    const screenshots: string[] = [];
    const contexts: BrowserContext[] = [];
    let originalAsset:
      | { bucket: string; path: string; filename: string; size_bytes: number | null }
      | undefined;
    let fixtureObjectPath: string | undefined;
    let cleanupSucceeded = true;
    let applicationLogWasSafe: boolean | undefined;
    let premiumCode = "";

    const createContext = async () => {
      const context = await browser.newContext({
        baseURL: appUrl.origin,
        ignoreHTTPSErrors: true,
      });
      contexts.push(context);
      return context;
    };

    try {
      const codeResult = await admin
        .from("premium_codes")
        .select("code")
        .eq("product_id", productId)
        .eq("active", true)
        .limit(1)
        .maybeSingle();
      if (codeResult.error || !codeResult.data?.code) {
        throw new Error("The seeded local premium code fixture could not be read.");
      }
      premiumCode = codeResult.data.code;
      sensitiveValues.add(premiumCode);

      const assetResult = await admin
        .from("product_assets")
        .select("bucket, path, filename, size_bytes")
        .eq("id", premiumAssetId)
        .single();
      if (assetResult.error || !assetResult.data || assetResult.data.bucket !== "premium-files") {
        throw new Error("The seeded local premium asset fixture could not be read.");
      }
      originalAsset = assetResult.data;
      fixtureObjectPath = `products/${productId}/premium_download/issue-30-${randomUUID()}.pdf`;

      const pdf = Buffer.from(
        "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
        "ascii",
      );
      const uploadResult = await admin.storage
        .from("premium-files")
        .upload(fixtureObjectPath, pdf, { contentType: "application/pdf", upsert: true });
      if (uploadResult.error) {
        throw new Error("The local protected-download fixture could not be uploaded.");
      }
      const updateResult = await admin
        .from("product_assets")
        .update({ path: fixtureObjectPath, size_bytes: pdf.byteLength })
        .eq("id", premiumAssetId);
      if (updateResult.error) {
        throw new Error("The local protected-download metadata fixture could not be updated.");
      }

      const userOne = createTestCredentials();
      const userTwo = createTestCredentials();
      const userThree = createTestCredentials();
      const userFour = createTestCredentials();
      createdEmails.add(userOne.email);
      createdEmails.add(userTwo.email);
      createdEmails.add(userThree.email);
      createdEmails.add(userFour.email);
      sensitiveValues.add(userOne.email);
      sensitiveValues.add(userOne.password);
      sensitiveValues.add(userTwo.email);
      sensitiveValues.add(userTwo.password);
      sensitiveValues.add(userThree.email);
      sensitiveValues.add(userThree.password);
      sensitiveValues.add(userFour.email);
      sensitiveValues.add(userFour.password);

      // Scenario A begins in browser context A and requests a real GoTrue confirmation email.
      await page.goto(`/en/products/${productSlug}#premium`);
      const guestUnlock = page.getByTestId("product-unlock-section");
      await guestUnlock.getByLabel("Premium code").fill(premiumCode);
      await guestUnlock.getByRole("button", { name: "Create account", exact: true }).click();
      await waitForLocation(page, { pathname: "/en/register" });
      const registrationIntentWasPreserved = await page
        .locator('input[name="code"]')
        .evaluate((input, code) => (input as HTMLInputElement).value === code, premiumCode);
      expect(registrationIntentWasPreserved).toBe(true);

      await submitRegistration(page, userOne.email, userOne.password);
      await waitForLocation(page, {
        pathname: `/en/products/${productSlug}`,
        query: { step: "verify" },
        hash: "#premium",
      });
      completed.registration = true;
      await expect(page.getByTestId("unlock-guest-state")).toBeVisible();
      await expect(page.locator('a[href*="error=verification_required"]')).toBeVisible();
      completed.confirmationRequired = true;

      const userOneLink = await readConfirmationLink(userOne.email, mailpitUrl);
      rememberSensitiveLink(userOneLink, sensitiveValues);
      const userOneResumeToken = getResumeToken(userOneLink.href);
      const userOneCallback = new URL(userOneLink.href);
      completed.confirmationEmailUsesTokenHash =
        Boolean(userOneCallback.searchParams.get("token_hash")) &&
        userOneCallback.searchParams.get("type") === "email";
      expect(completed.confirmationEmailUsesTokenHash).toBe(true);
      const firstLinkContainsPremiumCode = userOneLink.href.includes(premiumCode);
      expect(firstLinkContainsPremiumCode).toBe(false);

      // An unverified account cannot establish a password session, redeem, or download.
      const unverifiedContext = await createContext();
      const unverifiedPage = await unverifiedContext.newPage();
      await unverifiedPage.goto(`/en/products/${productSlug}#premium`);
      const unverifiedUnlock = unverifiedPage.getByTestId("product-unlock-section");
      await unverifiedUnlock.getByLabel("Premium code").fill(premiumCode);
      await unverifiedUnlock.getByRole("button", { name: "Log in", exact: true }).click();
      await waitForLocation(unverifiedPage, { pathname: "/en/login" });
      await unverifiedPage.getByLabel("Email").fill(userOne.email);
      await unverifiedPage.getByLabel("Password").fill(userOne.password);
      await unverifiedPage.getByRole("button", { name: "Continue", exact: true }).click();
      await waitForLocation(unverifiedPage, {
        pathname: "/en/login",
        query: { error: "email_unverified" },
      });
      await expect(unverifiedPage.locator("#login-error")).toBeVisible();
      completed.unverifiedLoginRejected = true;
      completed.unverifiedAccountHasNoEntitlement = !(await hasUnlock(admin, userOne.email));
      expect(completed.unverifiedAccountHasNoEntitlement).toBe(true);

      const unverifiedDownload = await requestProtectedDownload(unverifiedContext);
      expect(unverifiedDownload.status).toBe(401);
      completed.unverifiedDownloadRejected = unverifiedDownload.status === 401;

      // Context B starts without cookies and follows the actual local confirmation link.
      const crossDeviceContext = await createContext();
      const crossDevicePage = await crossDeviceContext.newPage();
      const crossDeviceStartedClean = (await crossDeviceContext.cookies()).length === 0;
      expect(crossDeviceStartedClean).toBe(true);
      const authNavigationResponses: string[] = [];
      crossDevicePage.on("response", (response) => {
        try {
          const responseUrl = new URL(response.url());
          if (["3030", "56321"].includes(responseUrl.port)) {
            authNavigationResponses.push(
              `${responseUrl.hostname}:${responseUrl.port}${responseUrl.pathname} ${response.status()}`,
            );
          }
        } catch {
          authNavigationResponses.push("[unparseable local response]");
        }
      });
      await navigateSensitive(crossDevicePage, userOneLink.href);
      try {
        await waitForLocation(
          crossDevicePage,
          {
            pathname: `/en/products/${productSlug}`,
            query: { unlocked: "1" },
            hash: "#premium",
          },
          12_000,
        );
      } catch {
        const callbackState = await crossDevicePage.evaluate(() => {
          const current = new URL(window.location.href);
          return {
            origin: current.origin,
            pathname: current.pathname,
            error: current.searchParams.get("error"),
            unlock: current.searchParams.get("unlock"),
            step: current.searchParams.get("step"),
            unlocked: current.searchParams.get("unlocked"),
            hash: current.hash,
          };
        });
        completed.callbackFinalPath = callbackState.pathname;
        completed.callbackError = callbackState.error ?? "none";
        completed.callbackUnlockStatus = callbackState.unlock ?? "none";
        completed.callbackNavigationResponses = authNavigationResponses.length;
        completed.callbackFinalOriginIsApp = callbackState.origin === appUrl.origin;
        throw new Error("The real confirmation callback did not return to the intended product.");
      }
      completed.realConfirmationCallback = true;
      completed.crossDeviceResume = true;
      completed.sessionEstablishedForAccountOne = await isConfirmedUser(admin, userOne.email);
      expect(completed.sessionEstablishedForAccountOne).toBe(true);
      completed.premiumIntentRedeemedForAccountOne = await hasUnlock(admin, userOne.email);
      expect(completed.premiumIntentRedeemedForAccountOne).toBe(true);

      const successfulReturnContainsCode = await crossDevicePage.evaluate(
        (code) => window.location.href.includes(code),
        premiumCode,
      );
      expect(successfulReturnContainsCode).toBe(false);
      await expect(crossDevicePage.getByTestId("unlock-success-state")).toBeVisible();
      screenshots.push(
        await saveSafeScreenshot(
          crossDevicePage,
          "real-supabase-registration-unlocked.png",
          [...sensitiveValues],
        ),
      );

      await crossDevicePage.reload();
      await waitForLocation(crossDevicePage, {
        pathname: `/en/products/${productSlug}`,
        query: { unlocked: "1" },
        hash: "#premium",
      });
      completed.entitlementPersistsAfterReload = await hasUnlock(admin, userOne.email);
      expect(completed.entitlementPersistsAfterReload).toBe(true);
      const firstProtectedDownload = await requestProtectedDownload(crossDeviceContext);
      expect(firstProtectedDownload.isPdf).toBe(true);
      completed.protectedDownloadForEntitledUser = firstProtectedDownload.isPdf;

      // A used GoTrue confirmation link cannot establish a second session.
      const reusedContext = await createContext();
      const reusedPage = await reusedContext.newPage();
      await navigateSensitive(reusedPage, userOneLink.href);
      const reusedDownload = await requestProtectedDownload(reusedContext);
      expect(reusedDownload.status).toBe(401);
      completed.reusedConfirmationLinkRejected = reusedDownload.status === 401;

      // Scenario B: create another verified account, then deliberately pair its
      // real signup token with account one's encrypted resume intent.
      const registrationTwoContext = await createContext();
      const registrationTwoPage = await registrationTwoContext.newPage();
      await registrationTwoPage.goto(`/en/products/${productSlug}#premium`);
      const secondGuestUnlock = registrationTwoPage.getByTestId("product-unlock-section");
      await secondGuestUnlock.getByLabel("Premium code").fill(premiumCode);
      await secondGuestUnlock
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      await waitForLocation(registrationTwoPage, { pathname: "/en/register" });
      await submitRegistration(registrationTwoPage, userTwo.email, userTwo.password);
      await waitForLocation(registrationTwoPage, {
        pathname: `/en/products/${productSlug}`,
        query: { step: "verify" },
        hash: "#premium",
      });
      const userTwoLink = await readConfirmationLink(userTwo.email, mailpitUrl);
      rememberSensitiveLink(userTwoLink, sensitiveValues);

      const wrongAccountContext = await createContext();
      const wrongAccountPage = await wrongAccountContext.newPage();
      const mismatchedLink = replaceResumeToken(userTwoLink.href, userOneResumeToken);
      sensitiveValues.add(mismatchedLink);
      await navigateSensitive(wrongAccountPage, mismatchedLink);
      await waitForLocation(wrongAccountPage, {
        pathname: "/en/login",
        query: { error: "verification_mismatch" },
      });
      completed.wrongAccountCallbackRejected = true;
      completed.accountOneEntitlementWasNotReused =
        (await hasUnlock(admin, userOne.email)) && !(await hasUnlock(admin, userTwo.email));
      expect(completed.accountOneEntitlementWasNotReused).toBe(true);
      const unrelatedDownload = await requestProtectedDownload(wrongAccountContext);
      expect(unrelatedDownload.status).toBe(403);
      completed.unrelatedAccountCannotDownload = unrelatedDownload.status === 403;

      // A clean login context explicitly carries its own premium intent and redeems it.
      const loginContext = await createContext();
      const loginPage = await loginContext.newPage();
      await loginPage.goto(`/en/products/${productSlug}#premium`);
      const loginUnlock = loginPage.getByTestId("product-unlock-section");
      await loginUnlock.getByLabel("Premium code").fill(premiumCode);
      await loginUnlock.getByRole("button", { name: "Log in", exact: true }).click();
      await waitForLocation(loginPage, { pathname: "/en/login" });
      await loginPage.getByLabel("Email").fill(userTwo.email);
      await loginPage.getByLabel("Password").fill(userTwo.password);
      await loginPage.getByRole("button", { name: "Continue", exact: true }).click();
      await waitForLocation(loginPage, {
        pathname: `/en/products/${productSlug}`,
        query: { unlocked: "1" },
        hash: "#premium",
      });
      completed.existingAccountLogin = await isConfirmedUser(admin, userTwo.email);
      expect(completed.existingAccountLogin).toBe(true);
      completed.loginPremiumRedemption = await hasUnlock(admin, userTwo.email);
      expect(completed.loginPremiumRedemption).toBe(true);
      await expect(loginPage.getByTestId("unlock-success-state")).toBeVisible();
      screenshots.push(
        await saveSafeScreenshot(loginPage, "real-supabase-login-unlocked.png", [
          ...sensitiveValues,
        ], loginPage.getByTestId("product-unlock-section")),
      );
      await loginPage.reload();
      await waitForLocation(loginPage, {
        pathname: `/en/products/${productSlug}`,
        query: { unlocked: "1" },
        hash: "#premium",
      });
      completed.loginEntitlementPersistsAfterReload = await hasUnlock(admin, userTwo.email);
      expect(completed.loginEntitlementPersistsAfterReload).toBe(true);
      const secondProtectedDownload = await requestProtectedDownload(loginContext);
      expect(secondProtectedDownload.isPdf).toBe(true);
      completed.loginProtectedDownload = secondProtectedDownload.isPdf;

      // A separate real signup lets the test corrupt the resume ciphertext
      // without consuming account one's cross-device confirmation link.
      const registrationThreeContext = await createContext();
      const registrationThreePage = await registrationThreeContext.newPage();
      await registrationThreePage.goto(`/en/products/${productSlug}#premium`);
      const thirdGuestUnlock = registrationThreePage.getByTestId("product-unlock-section");
      await thirdGuestUnlock.getByLabel("Premium code").fill(premiumCode);
      await thirdGuestUnlock
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      await waitForLocation(registrationThreePage, { pathname: "/en/register" });
      await submitRegistration(registrationThreePage, userThree.email, userThree.password);
      await waitForLocation(registrationThreePage, {
        pathname: `/en/products/${productSlug}`,
        query: { step: "verify" },
        hash: "#premium",
      });
      const userThreeLink = await readConfirmationLink(userThree.email, mailpitUrl);
      rememberSensitiveLink(userThreeLink, sensitiveValues);
      const tamperedCallback = new URL(userThreeLink.href);
      tamperedCallback.searchParams.set(
        "resume",
        mutateFirstCharacter(getResumeToken(userThreeLink.href)),
      );
      sensitiveValues.add(tamperedCallback.toString());
      expect(tamperedCallback.href.includes(premiumCode)).toBe(false);

      const tamperedContext = await createContext();
      const tamperedPage = await tamperedContext.newPage();
      await navigateSensitive(tamperedPage, tamperedCallback.toString());
      await waitForLocationDeparture(tamperedPage, "/auth/callback");
      completed.tamperedResumeConfirmedAccount = await isConfirmedUser(admin, userThree.email);
      expect(completed.tamperedResumeConfirmedAccount).toBe(true);
      completed.tamperedResumeDidNotUnlock = !(await hasUnlock(admin, userThree.email));
      expect(completed.tamperedResumeDidNotUnlock).toBe(true);

      // A tampered OTP from a real email is rejected by local GoTrue and cannot log in.
      const invalidLink = mutateConfirmationToken(userOneLink.href);
      sensitiveValues.add(invalidLink);
      const invalidContext = await createContext();
      const invalidPage = await invalidContext.newPage();
      await navigateSensitive(invalidPage, invalidLink);
      const invalidDownload = await requestProtectedDownload(invalidContext);
      expect(invalidDownload.status).toBe(401);
      completed.invalidConfirmationLinkRejected = invalidDownload.status === 401;

      // Age a real confirmation sent by local GoTrue so expiry is tested by
      // the Auth service itself, without waiting for the production TTL.
      const expiredUserResult = await admin.auth.admin.createUser({
        email: userFour.email,
        password: userFour.password,
        email_confirm: false,
      });
      const expiredUserId = expiredUserResult.data.user?.id;
      if (expiredUserResult.error || !expiredUserId) {
        throw new Error("Could not create the synthetic account for the expired-token check.");
      }
      completed.expiredSyntheticAccountCreated = true;
      const expiredRedirect = new URL("/auth/callback", appUrl.origin);
      expiredRedirect.searchParams.set("locale", "en");
      const expiredEmailResult = await admin.auth.resend({
        type: "signup",
        email: userFour.email,
        options: { emailRedirectTo: expiredRedirect.href },
      });
      if (expiredEmailResult.error) {
        throw new Error("Local GoTrue did not send the synthetic expired-token confirmation.");
      }
      completed.expiredConfirmationEmailRequested = true;
      const expiredLink = await readConfirmationLink(userFour.email, mailpitUrl);
      rememberSensitiveLink(expiredLink, sensitiveValues);
      completed.expiredConfirmationEmailRetrieved = true;
      ageLocalSignupConfirmation(expiredUserId);
      completed.expiredConfirmationTimestampAged = true;
      const expiredTokenHash = new URL(expiredLink.href).searchParams.get("token_hash");
      if (!expiredTokenHash) {
        throw new Error("The local expired-token email did not contain a confirmation token hash.");
      }
      const expiredVerification = await verifier.auth.verifyOtp({
        token_hash: expiredTokenHash,
        type: "email",
      });
      completed.expiredTokenRejectedByGoTrue = expiredVerification.error?.code === "otp_expired";
      expect(completed.expiredTokenRejectedByGoTrue).toBe(true);

      const expiredContext = await createContext();
      const expiredPage = await expiredContext.newPage();
      await navigateSensitive(expiredPage, expiredLink.href);
      await waitForLocation(expiredPage, {
        pathname: "/en/login",
        query: { error: "verification_failed" },
      });
      const expiredDownload = await requestProtectedDownload(expiredContext);
      completed.expiredConfirmationLinkRejected =
        expiredDownload.status === 401 &&
        !(await isConfirmedUser(admin, userFour.email)) &&
        !(await hasUnlock(admin, userFour.email));
      expect(completed.expiredConfirmationLinkRejected).toBe(true);

      // Both auth page and callback reject external return destinations.
      const redirectContext = await createContext();
      const redirectPage = await redirectContext.newPage();
      await redirectPage.goto(
        `/en/login?returnTo=${encodeURIComponent("https://evil.example/phish")}`,
      );
      completed.externalLoginReturnSanitized =
        (await redirectPage.locator('input[name="returnTo"]').inputValue()) === "/en/library";
      expect(completed.externalLoginReturnSanitized).toBe(true);
      const callbackTarget = new URL(`${appUrl.origin}/auth/callback`);
      callbackTarget.searchParams.set("code", "invalid-local-test-code");
      callbackTarget.searchParams.set("locale", "en");
      callbackTarget.searchParams.set("returnTo", "https://evil.example/phish");
      await navigateSensitive(redirectPage, callbackTarget.toString());
      await waitForLocation(redirectPage, {
        pathname: "/en/login",
        query: { error: "verification_failed" },
      });
      completed.externalCallbackReturnSanitized = await redirectPage.evaluate(
        () => window.location.origin === "https://127.0.0.1:3030",
      );
      expect(completed.externalCallbackReturnSanitized).toBe(true);

      // The auth callback diagnostics inspect only the exact local app log and
      // record a boolean so no secret or log line can escape into artifacts.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const applicationLog = await readFile(appLogPath, "utf8").catch(() => null);
      applicationLogWasSafe =
        applicationLog !== null &&
        ![...sensitiveValues]
          .filter((value) => value.length >= 8)
          .some((value) => applicationLog.includes(value));
      expect(applicationLogWasSafe).toBe(true);
      completed.applicationLogWasScanned = applicationLog !== null;
      completed.applicationLogsContainNoTestSecrets = applicationLogWasSafe;
      completed.registrationCallbackAndAuthFlowsUsedLocalSupabase = true;
    } finally {
      for (const context of contexts) {
        await context.close().catch(() => {
          cleanupSucceeded = false;
        });
      }

      if (fixtureObjectPath) {
        const removalResult = await admin.storage
          .from("premium-files")
          .remove([fixtureObjectPath]);
        cleanupSucceeded = cleanupSucceeded && !removalResult.error;
      }
      if (originalAsset) {
        const restoreResult = await admin
          .from("product_assets")
          .update({
            path: originalAsset.path,
            filename: originalAsset.filename,
            size_bytes: originalAsset.size_bytes,
          })
          .eq("id", premiumAssetId);
        cleanupSucceeded = cleanupSucceeded && !restoreResult.error;
      }

      const usersResult = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (usersResult.error) {
        cleanupSucceeded = false;
      } else {
        for (const user of usersResult.data.users) {
          if (user.email && createdEmails.has(user.email.toLowerCase())) {
            const deleteResult = await admin.auth.admin.deleteUser(user.id);
            cleanupSucceeded = cleanupSucceeded && !deleteResult.error;
          }
        }
      }

      await mkdir(evidenceFolder, { recursive: true });
      const diagnostics = {
        environment: "isolated local Supabase CLI stack with GoTrue, PostgreSQL, PostgREST, and local Inbucket",
        applicationBackend: "supabase",
        appOrigin: appUrl.origin,
        supabaseOrigin: supabaseUrl.origin,
        mailpitOrigin: mailpitUrl.origin,
        completed,
        applicationLogScanCompleted: applicationLogWasSafe !== undefined,
        applicationLogsContainTestSecrets: applicationLogWasSafe === false,
        cleanupSucceeded,
        screenshots,
        applicationLogSource: "configured Next.js development log only",
        playwrightProject: testInfo.project.name,
      };
      await writeFile(
        path.join(evidenceFolder, "diagnostics.json"),
        `${JSON.stringify(diagnostics, null, 2)}\n`,
        "utf8",
      ).catch(() => {
        cleanupSucceeded = false;
      });
      if (!cleanupSucceeded) {
        throw new Error("Local test users or fixtures could not be fully cleaned up.");
      }
    }
  });
});

function requireLoopbackUrl(value: string | undefined, port: number, label: string) {
  if (!value) {
    throw new Error(`The local ${label} URL is required for this test.`);
  }
  const url = new URL(value);
  if (
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    Number(url.port) !== port
  ) {
    throw new Error(`The ${label} URL must point to its dedicated local test port.`);
  }
  return url;
}

function createTestCredentials() {
  return {
    email: `issue30-${randomUUID()}@example.test`,
    password: randomBytes(24).toString("base64url"),
  };
}

function createAdminClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function ageLocalSignupConfirmation(userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error("The synthetic Auth user ID was invalid for the local expiry check.");
  }

  const query = `
    with updated as (
      update auth.users
      set confirmation_sent_at = now() - interval '2 hours'
      where id = '${userId}'::uuid
        and email_confirmed_at is null
        and confirmation_sent_at is not null
      returning id
    )
    select count(*)::int as updated_count from updated
  `;
  let result = "";
  try {
    const isWindows = process.platform === "win32";
    result = execFileSync(
      isWindows ? "powershell.exe" : "supabase",
      isWindows
        ? [
            "-NoLogo",
            "-NoProfile",
            "-Command",
            "supabase db query --local --output-format json $env:ISSUE_30_CONFIRMATION_AGE_SQL",
          ]
        : ["db", "query", "--local", "--output-format", "json", query],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
        windowsHide: true,
        env: { ...process.env, ISSUE_30_CONFIRMATION_AGE_SQL: query },
      },
    );
  } catch {
    throw new Error("Could not age the synthetic confirmation in the local Supabase database.");
  }

  if (!/"updated_count"\s*:\s*"?1"?/.test(result)) {
    throw new Error("The local Supabase expiry fixture did not update exactly one pending account.");
  }
}

async function submitRegistration(page: Page, email: string, password: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("checkbox", { name: /Terms/ }).check();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
}

async function waitForLocation(
  page: Page,
  expected: { pathname: string; query?: Record<string, string>; hash?: string },
  timeout = 30_000,
) {
  try {
    await page.waitForFunction(
      (target) => {
        const current = new URL(window.location.href);
        return (
          current.pathname === target.pathname &&
          Object.entries(target.query ?? {}).every(
            ([key, value]) => current.searchParams.get(key) === value,
          ) &&
          (target.hash === undefined || current.hash === target.hash)
        );
      },
      expected,
      { timeout },
    );
  } catch {
    const actual = await page.evaluate(() => {
      const current = new URL(window.location.href);
      const rawError = current.searchParams.get("error");
      const allowedErrors = new Set([
        "verification_failed",
        "verification_mismatch",
        "verification_required",
        "invalid_return_to",
      ]);
      return {
        pathname: current.pathname,
        queryKeys: [...current.searchParams.keys()].sort(),
        error: rawError && allowedErrors.has(rawError) ? rawError : undefined,
        hasHash: Boolean(current.hash),
      };
    });
    throw new Error(`Expected a sanitized authentication return path; reached ${JSON.stringify(actual)}.`);
  }
}

async function waitForLocationDeparture(page: Page, pathname: string, timeout = 30_000) {
  try {
    await page.waitForFunction(
      (currentPathname) => window.location.pathname !== currentPathname,
      pathname,
      { timeout },
    );
  } catch {
    const actualPath = await page.evaluate(() => window.location.pathname);
    throw new Error(`Authentication callback did not finish; current path is ${actualPath}.`);
  }
}

async function navigateSensitive(page: Page, url: string) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch {
    throw new Error("A local authentication navigation failed; its URL is withheld.");
  }
}

async function readConfirmationLink(email: string, mailpitUrl: URL) {
  const query = encodeURIComponent(`to:${email}`);
  let messageId: string | undefined;

  for (let attempt = 0; attempt < 30 && !messageId; attempt += 1) {
    const response = await fetch(`${mailpitUrl.origin}/api/v1/search?query=${query}`);
    if (!response.ok) {
      throw new Error("Local Mailpit could not be queried for a confirmation email.");
    }
    const search = (await response.json()) as {
      messages?: Array<{ ID?: string; To?: unknown }>;
    };
    messageId = search.messages?.find((message) => typeof message.ID === "string")?.ID;
    if (!messageId) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  if (!messageId) {
    throw new Error("No real local Supabase confirmation email reached Mailpit.");
  }

  const detailResponse = await fetch(
    `${mailpitUrl.origin}/api/v1/message/${encodeURIComponent(messageId)}`,
  );
  if (!detailResponse.ok) {
    throw new Error("The local confirmation email could not be opened.");
  }
  const detail = (await detailResponse.json()) as { Text?: string; HTML?: string };
  const content = `${detail.Text ?? ""}\n${detail.HTML ?? ""}`.replace(/&amp;/g, "&");
  const candidates = content.match(/https?:\/\/[^\s<>"']+/g) ?? [];
  for (const candidate of candidates) {
    try {
      const href = candidate.replace(/[),.;]+$/, "");
      const url = new URL(href);
      if (
        url.hostname === "127.0.0.1" &&
        url.port === "3030" &&
        url.pathname === "/auth/callback" &&
        url.searchParams.get("type") === "email" &&
        url.searchParams.has("token_hash")
      ) {
        return { href: url.toString(), redirectTo: url.toString() };
      }
    } catch {
      // Ignore non-URL text in the locally captured email.
    }
  }
  throw new Error("The local email did not contain a Supabase signup confirmation link.");
}

function getResumeToken(confirmationLink: string) {
  const callback = new URL(confirmationLink);
  const resume = callback.searchParams.get("resume");
  if (!resume) {
    throw new Error("The confirmation email is missing the encrypted resume state.");
  }
  return resume;
}

function rememberSensitiveLink(
  link: { href: string; redirectTo: string },
  sensitiveValues: Set<string>,
) {
  sensitiveValues.add(link.href);
  sensitiveValues.add(link.redirectTo);
  const verifyUrl = new URL(link.href);
  const otp = verifyUrl.searchParams.get("token_hash") ?? verifyUrl.searchParams.get("token");
  if (otp) sensitiveValues.add(otp);
  const callback = new URL(link.redirectTo);
  const resume = callback.searchParams.get("resume");
  if (resume) sensitiveValues.add(resume);
}

function mutateFirstCharacter(value: string) {
  const first = value.at(0);
  if (!first) return "x";
  return `${first === "x" ? "y" : "x"}${value.slice(1)}`;
}

function mutateConfirmationToken(link: string) {
  const url = new URL(link);
  const token = url.searchParams.get("token_hash") ?? url.searchParams.get("token");
  if (!token) {
    throw new Error("The local confirmation link did not include its Supabase OTP hash.");
  }
  if (url.searchParams.has("token_hash")) {
    url.searchParams.set("token_hash", mutateFirstCharacter(token));
  } else {
    url.searchParams.set("token", mutateFirstCharacter(token));
  }
  return url.toString();
}

function replaceResumeToken(link: string, resumeToken: string) {
  const url = new URL(link);
  url.searchParams.set("resume", resumeToken);
  return url.toString();
}

type LocalAdminClient = ReturnType<typeof createAdminClient>;

async function isConfirmedUser(admin: LocalAdminClient, email: string) {
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (users.error) {
    throw new Error("The local confirmed-user state could not be checked.");
  }
  const user = users.data.users.find((candidate) => candidate.email?.toLowerCase() === email);
  return Boolean(user?.email_confirmed_at);
}

async function hasUnlock(admin: LocalAdminClient, email: string) {
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (users.error) {
    throw new Error("The local premium entitlement state could not be checked.");
  }
  const user = users.data.users.find((candidate) => candidate.email?.toLowerCase() === email);
  if (!user) return false;
  const unlock = await admin
    .from("user_product_unlocks")
    .select("id")
    .eq("user_id", user.id)
    .eq("product_id", productId)
    .maybeSingle();
  if (unlock.error) {
    throw new Error("The local premium entitlement query failed.");
  }
  return Boolean(unlock.data);
}

async function requestProtectedDownload(context: BrowserContext) {
  const response = await context.request.get(
    `/api/downloads/${premiumAssetId}?locale=en&returnTo=${encodeURIComponent(`/en/products/${productSlug}`)}`,
    {
      headers: { accept: "application/json" },
      maxRedirects: 10,
      timeout: 20_000,
    },
  );
  if (response.status() !== 200) {
    return { status: response.status(), isPdf: false };
  }
  const contentType = response.headers()["content-type"] ?? "";
  const body = await response.body();
  return {
    status: response.status(),
    isPdf: contentType.includes("application/pdf") && body.subarray(0, 4).toString("ascii") === "%PDF",
  };
}

async function saveSafeScreenshot(
  page: Page,
  filename: string,
  secrets: string[],
  screenshotTarget?: Locator,
) {
  const safePage = await page.evaluate((values) => {
    const body = document.body.innerText;
    const url = window.location.href;
    return (
      values.every((value) => value.length === 0 || (!body.includes(value) && !url.includes(value))) &&
      document.querySelector('input[name="password"]') === null &&
      document.querySelector('input[name="code"]') === null &&
      window.location.pathname === `/en/products/${"moon-garden-coloring-book"}`
    );
  }, secrets);
  expect(safePage).toBe(true);

  const consentPending = await page.evaluate(
    () => window.localStorage.getItem("ll_cookie_consent") === null,
  );
  if (consentPending) {
    await page.getByRole("button", { name: "Essential", exact: true }).click();
  }
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await mkdir(evidenceFolder, { recursive: true });
  const screenshotPath = path.join(evidenceFolder, filename);
  if (screenshotTarget) {
    await screenshotTarget.screenshot({ path: screenshotPath });
  } else {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }
  return filename;
}
