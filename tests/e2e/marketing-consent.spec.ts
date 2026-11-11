import { expect, test } from "@playwright/test";
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
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });

  const preference = page.getByRole("checkbox", { name: "I agree to receive marketing emails." });
  await expect(preference).toBeChecked();
  await preference.uncheck();
  await page.getByRole("button", { name: "Save preferences", exact: true }).click();
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

  await page.reload();
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
  const demoCookie = (await page.context().cookies()).find(({ name }) => name === "ll_demo_session");
  expect(demoCookie).toBeDefined();
  expect(JSON.parse(Buffer.from(demoCookie!.value.split(".")[0], "base64url").toString()).marketingConsent).toBe(true);
  await page.reload();
  await expect(preference).toBeChecked();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
