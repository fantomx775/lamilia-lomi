import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { isLocalDemoAppTarget } from "./local-target";

test("account owner can withdraw and restore marketing consent", async ({ page }, testInfo) => {
  test.skip(
    !(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)),
    "Marketing preference E2E requires the isolated local demo backend.",
  );

  await page.goto("/en");
  const essentialOnly = page.getByRole("button", { name: "Essential only", exact: true });
  if (await essentialOnly.isVisible()) await essentialOnly.click();

  await page.goto("/en/login?returnTo=%2Fen%2Faccount");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(page.getByTestId("localized-route-loading")).toHaveCount(0);

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: Array<{ path: string; method: string; error: string }> = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push({
      path: new URL(request.url()).pathname,
      method: request.method(),
      error: request.failure()?.errorText ?? "unknown",
    });
  });

  const reloadAfterSavedPreference = async (expectedConsent: boolean) => {
    const demoCookie = (await page.context().cookies()).find(({ name }) => name === "ll_demo_session");
    expect(demoCookie).toBeDefined();
    expect(JSON.parse(Buffer.from(demoCookie!.value.split(".")[0], "base64url").toString()).marketingConsent).toBe(expectedConsent);
    await page.reload();
  };

  const preference = page.getByRole("checkbox", { name: "I agree to receive marketing emails." });
  await expect(preference).toBeChecked();
  await preference.uncheck();
  const withdrawalResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/account/marketing-consent");
  await page.getByRole("button", { name: "Save preferences", exact: true }).click();
  const withdrawalResult = await withdrawalResponse;
  expect(withdrawalResult.status()).toBe(200);
  expect(await withdrawalResult.json()).toEqual({ ok: true, marketingConsent: false });
  await expect(page.locator('p[role="status"]')).toHaveText("Your marketing preference has been saved.");
  await expect(preference).not.toBeChecked();
  await expect(page.getByTestId("localized-route-loading")).toHaveCount(0);
  const cookieNotice = page.getByRole("button", { name: "Essential only", exact: true });
  if (await cookieNotice.isVisible()) await cookieNotice.click();
  await expect(cookieNotice).toBeHidden();
  const preferences = page.locator('section[aria-labelledby="account-preferences-title"]');
  await expect(preferences).toBeVisible();
  await preferences.screenshot({ path: testInfo.outputPath("marketing-preference-withdrawn.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await reloadAfterSavedPreference(false);
  await expect(preference).not.toBeChecked();

  await preference.check();
  await expect.poll(async () => {
    const form = page.locator('form').filter({ has: preference });
    return form.evaluate((element) => new FormData(element as HTMLFormElement).get("marketingConsent"));
  }).toBe("on");
  const updateRequest = page.waitForRequest((request) => request.method() === "POST"
    && new URL(request.url()).pathname === "/api/account/marketing-consent");
  const updateResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/account/marketing-consent");
  await page.getByRole("button", { name: "Save preferences", exact: true }).click();
  expect((await updateRequest).postDataJSON()).toEqual({ marketingConsent: true });
  const updateResult = await updateResponse;
  expect(updateResult.status()).toBe(200);
  expect(await updateResult.json()).toEqual({ ok: true, marketingConsent: true });
  await expect(page.locator('p[role="status"]')).toHaveText("Your marketing preference has been saved.");
  await expect(preference).toBeChecked();
  expect((await updateResponse).status()).toBe(200);
  const demoCookie = (await page.context().cookies()).find(({ name }) => name === "ll_demo_session");
  expect(demoCookie).toBeDefined();
  expect(JSON.parse(Buffer.from(demoCookie!.value.split(".")[0], "base64url").toString()).marketingConsent).toBe(true);
  await reloadAfterSavedPreference(true);
  await expect(preference).toBeChecked();
  const browserDiagnostics = { consoleErrors, pageErrors, failedNetworkRequests: failedRequests };
  await writeFile(testInfo.outputPath("browser-diagnostics.json"), JSON.stringify(browserDiagnostics, null, 2));
  await testInfo.attach("browser-diagnostics", {
    body: JSON.stringify(browserDiagnostics, null, 2),
    contentType: "application/json",
  });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
