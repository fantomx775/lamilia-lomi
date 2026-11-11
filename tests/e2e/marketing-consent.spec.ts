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
  const failedRequests: Array<{ path: string; method: string; error: string; responseStatus?: number; nextServerAction: boolean; disposition: "unrelated" | "unresolved"; reason?: string }> = [];
  const serverActionResponses = new Map<object, number>();
  page.on("response", (response) => {
    const request = response.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      serverActionResponses.set(request, response.status());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText ?? "unknown";
    const nextServerAction = Boolean(request.headers()["next-action"]);
    const requestPath = new URL(request.url()).pathname;
    const expectedServerActionCancellation = error === "net::ERR_ABORTED"
      && request.method() === "POST"
      && requestPath === "/en/account"
      && nextServerAction
      && serverActionResponses.get(request) === 200;
    failedRequests.push({
      path: requestPath,
      method: request.method(),
      error,
      ...(serverActionResponses.has(request) ? { responseStatus: serverActionResponses.get(request) } : {}),
      nextServerAction,
      disposition: expectedServerActionCancellation ? "unrelated" : "unresolved",
      ...(expectedServerActionCancellation ? { reason: "Next.js canceled the Server Action fetch after its HTTP 200 response; the test also verifies the success message and saved preference after reload." } : {}),
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
  const withdrawalResponse = page.waitForResponse((response) => response.request().method() === "POST" && Boolean(response.request().headers()["next-action"]));
  await page.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(page.locator('p[role="status"]')).toHaveText("Your marketing preference has been saved.");
  expect((await withdrawalResponse).status()).toBe(200);
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
  const updateRequest = page.waitForRequest((request) => request.method() === "POST" && Boolean(request.headers()["next-action"]));
  const updateResponse = page.waitForResponse((response) => response.request().method() === "POST" && Boolean(response.request().headers()["next-action"]));
  await page.getByRole("button", { name: "Save preferences", exact: true }).click();
  const requestBody = (await updateRequest).postData() ?? "";
  expect(requestBody.includes("marketingConsent")).toBe(true);
  expect(/marketingConsent[\s\S]{0,100}on/.test(requestBody)).toBe(true);
  await updateResponse;
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
  expect(failedRequests.filter(({ disposition }) => disposition !== "unrelated"), JSON.stringify(failedRequests, null, 2)).toEqual([]);
});
