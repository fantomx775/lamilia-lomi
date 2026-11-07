import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

function localUrl(value: string | undefined, protocol = "http:") {
  const url = new URL(value ?? "");
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.protocol !== protocol || url.username || url.password) {
    throw new Error("Password recovery fixtures must use the local app, Auth and Mailpit.");
  }
  return url;
}

test.use({ ignoreHTTPSErrors: true });

test("resets a password through the real local email and rejects a reused link", async ({ page, browser }, testInfo) => {
  test.skip(process.env.LAMILIA_TEST_PASSWORD_RECOVERY !== "1", "Requires local Supabase and Mailpit");
  test.setTimeout(90_000);
  const app = localUrl(process.env.PLAYWRIGHT_BASE_URL, "https:");
  const authUrl = localUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const mail = localUrl(process.env.LAMILIA_TEST_MAILPIT_URL);
  const options = { auth: { autoRefreshToken: false, persistSession: false } };
  const admin = createClient(authUrl.origin, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
  const reader = createClient(authUrl.origin, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, options);
  const email = `recovery-${randomUUID()}@example.com`;
  const previous = `Previous-${randomUUID()}`;
  const password = `Recovered-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: previous, email_confirm: true });
  if (error || !data.user) throw new Error("Could not create the local recovery fixture.");

  const browserErrors: string[] = [];
  const failedRequests: string[] = [];
  let canceledPrefetches = 0;
  page.on("pageerror", () => browserErrors.push("Uncaught page error"));
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text().split("\n")[0].replace(/https?:\/\/\S+/g, "[URL]"));
    }
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const failure = request.failure()?.errorText;
    const headers = request.headers();
    if (failure === "net::ERR_ABORTED" && request.method() === "GET" && url.origin === app.origin &&
      url.searchParams.has("_rsc") && (headers["next-router-prefetch"] === "1" || headers["next-router-segment-prefetch"])) {
      canceledPrefetches++;
      return;
    }
    failedRequests.push(`${request.method()} ${url.pathname}: ${failure}`);
  });
  const submit = async (name: string) => {
    const [response] = await Promise.all([
      page.waitForResponse((result) =>
        result.request().method() === "POST" && new URL(result.url()).pathname === "/en/reset-password"),
      page.getByRole("button", { name }).click(),
    ]);
    expect(response.status()).toBeLessThan(400);
  };

  try {
    await page.goto("/en/reset-password");
    await page.getByLabel("Email").fill(email);
    await submit("Send reset link");
    await expect(page.getByText("Open it in this same browser", { exact: false })).toBeVisible();

    let messageId: string | undefined;
    await expect.poll(async () => {
      const response = await fetch(new URL(`/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`, mail));
      if (!response.ok) return false;
      const result = await response.json();
      messageId = result.messages?.[0]?.ID;
      return Boolean(messageId);
    }).toBe(true);
    const message = await fetch(new URL(`/api/v1/message/${encodeURIComponent(messageId!)}`, mail));
    const body = await message.json();
    const href = (body.HTML as string).match(/href="([^"]+\/auth\/v1\/verify\?[^"]+)"/)?.[1];
    if (!href) throw new Error("The local recovery email did not include an Auth link.");
    const link = localUrl(href.replaceAll("&amp;", "&"));
    if (link.origin !== authUrl.origin || link.searchParams.get("type") !== "recovery" ||
      new URL(link.searchParams.get("redirect_to") ?? "").origin !== app.origin) {
      throw new Error("Unexpected local password recovery link target.");
    }

    await page.goto(link.href, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("choose-password.png"), caret: "initial", style: "nextjs-portal { display: none }",
    });

    const other = await browser.newPage({ baseURL: app.origin, ignoreHTTPSErrors: true });
    try {
      await other.goto("/en/reset-password?status=choose-password");
      await expect(other.getByRole("button", { name: "Save new password" })).toHaveCount(0);
      await expect(other.getByText("could not be verified", { exact: false })).toBeVisible();
    } finally {
      await other.close();
    }

    await page.getByLabel("New password", { exact: true }).fill(password);
    await page.getByLabel("Confirm new password").fill(password);
    await submit("Save new password");
    await expect(page.getByText("Your password has been changed", { exact: false })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("password-changed.png"), caret: "initial", style: "nextjs-portal { display: none }",
    });
    expect(Boolean((await reader.auth.signInWithPassword({ email, password: previous })).error)).toBe(true);
    expect(Boolean((await reader.auth.signInWithPassword({ email, password })).data.session)).toBe(true);

    await page.goto(link.href, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("could not be verified", { exact: false })).toBeVisible();
    expect(browserErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    testInfo.annotations.push({ type: "canceled background Next.js prefetches", description: String(canceledPrefetches) });
  } finally {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(data.user.id);
    if (cleanupError) throw new Error("Could not clean up the local recovery fixture.");
  }
});
