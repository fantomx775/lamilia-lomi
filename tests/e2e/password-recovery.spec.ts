import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page, type Request } from "@playwright/test";
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
  let crossBrowser = process.env.LAMILIA_TEST_RECOVERY_MODE === "cross-browser";
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
  const completedActions = new Set<Request>();
  const canceledActionStreams: Request[] = [];
  let canceledPrefetches = 0;
  const monitor = (tab: Page) => {
    tab.on("pageerror", () => browserErrors.push("Uncaught page error"));
    tab.on("console", (message) => {
      if (message.type() === "error") {
        browserErrors.push(message.text().split("\n")[0].replace(/https?:\/\/\S+/g, "[URL]"));
      }
    });
    tab.on("requestfailed", (request) => {
      const url = new URL(request.url());
      const failure = request.failure()?.errorText;
      const headers = request.headers();
      if (failure === "net::ERR_ABORTED" && request.method() === "POST" &&
        url.origin === app.origin && url.pathname === "/en/reset-password") {
        canceledActionStreams.push(request);
        return;
      }
      if (failure === "net::ERR_ABORTED" && request.method() === "GET" && url.origin === app.origin &&
        url.searchParams.has("_rsc") && (headers["next-router-prefetch"] === "1" || headers["next-router-segment-prefetch"])) {
        canceledPrefetches++;
        return;
      }
      failedRequests.push(`${request.method()} ${url.pathname}: ${failure}`);
    });
  };
  monitor(page);
  const submit = async (tab: Page, name: string) => {
    const [response] = await Promise.all([
      tab.waitForResponse((result) =>
        result.request().method() === "POST" && new URL(result.url()).pathname === "/en/reset-password"),
      tab.getByRole("button", { name }).click(),
    ]);
    expect(response.status()).toBeLessThan(400);
    completedActions.add(response.request());
  };

  try {
    await page.goto("/en/reset-password");
    await page.getByRole("button", { name: "Essential only" }).click();
    await page.getByLabel("Email").fill(email);
    let releaseRequest!: () => void;
    const holdRequest = new Promise<void>((resolve) => { releaseRequest = resolve; });
    await page.route("**/en/reset-password", async (route) => {
      if (route.request().method() === "POST") await holdRequest;
      await route.continue();
    });
    const submission = submit(page, "Send reset link");
    try {
      await expect(page.getByRole("button", { name: "Sending reset link…" })).toBeDisabled();
    } finally {
      releaseRequest();
      await submission;
      await page.unroute("**/en/reset-password");
    }
    await expect(page.getByText("Check your inbox.", { exact: false })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("reset-requested.png"), caret: "initial", style: "nextjs-portal { display: none }" });

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
    let href = (body.HTML as string).match(/href="([^"]+\/auth\/recovery#token_hash=[^"]+)"/)?.[1];
    crossBrowser ||= Boolean(href);
    if (!href) {
      const defaultHref = (body.HTML as string).match(/href="([^"]+\/auth\/v1\/verify\?[^"]+)"/)?.[1];
      if (!defaultHref) throw new Error("The local recovery email did not include an Auth link.");
      const defaultLink = localUrl(defaultHref.replaceAll("&amp;", "&"));
      if (defaultLink.origin !== authUrl.origin || defaultLink.searchParams.get("type") !== "recovery" ||
        new URL(defaultLink.searchParams.get("redirect_to") ?? "").origin !== app.origin) {
        throw new Error("Unexpected local password recovery link target.");
      }
      if (crossBrowser) {
        // A pre-existing local stack may still use the default template.
        // Render the checked-in template with the real, unredeemed Auth token.
        const template = await readFile("supabase/templates/recovery.html", "utf8");
        href = template.replace("{{ .SiteURL }}", app.origin)
          .replace("{{ .TokenHash }}", defaultLink.searchParams.get("token") ?? "")
          .match(/href="([^"]+)"/)?.[1];
      } else {
        href = defaultLink.href;
      }
    }
    const link = localUrl(href, crossBrowser ? "https:" : "http:");
    if (crossBrowser && (link.origin !== app.origin || link.pathname !== "/auth/recovery")) {
      throw new Error("Unexpected cross-browser recovery link target.");
    }
    const recoveryTab = crossBrowser
      ? await browser.newPage({ ignoreHTTPSErrors: true })
      : await page.context().newPage();
    monitor(recoveryTab);
    if (crossBrowser) {
      const scanner = await recoveryTab.request.get(new URL(link.pathname, app).href);
      expect(scanner.status()).toBe(200);
    }
    await recoveryTab.goto(link.href, { waitUntil: "domcontentloaded" });
    if (crossBrowser) {
      await expect(recoveryTab.getByRole("button", { name: "Continue to reset password" })).toBeEnabled();
      expect(new URL(recoveryTab.url()).hash).toBe("");
      await recoveryTab.screenshot({ path: testInfo.outputPath("confirm-recovery.png"), caret: "initial" });
      await recoveryTab.getByRole("button", { name: "Continue to reset password" }).click();
    }
    await expect(recoveryTab.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    await recoveryTab.screenshot({
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

    await recoveryTab.getByLabel("New password", { exact: true }).fill(password);
    await recoveryTab.getByLabel("Confirm new password").fill(password);
    await submit(recoveryTab, "Save new password");
    await expect(recoveryTab.getByText("Your password has been changed", { exact: false })).toBeVisible();
    await recoveryTab.screenshot({
      path: testInfo.outputPath("password-changed.png"), caret: "initial", style: "nextjs-portal { display: none }",
    });
    expect(Boolean((await reader.auth.signInWithPassword({ email, password: previous })).error)).toBe(true);
    expect(Boolean((await reader.auth.signInWithPassword({ email, password })).data.session)).toBe(true);

    const reusedTab = await page.context().newPage();
    monitor(reusedTab);
    await reusedTab.goto(link.href, { waitUntil: "domcontentloaded" });
    if (crossBrowser) await reusedTab.getByRole("button", { name: "Continue to reset password" }).click();
    await expect(reusedTab.getByText("could not be verified", { exact: false })).toBeVisible();
    expect(browserErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    // The router may close a response stream after applying its redirect.
    // A cancellation without a successful response for that exact request
    // still fails, even if another request produced the expected page.
    expect(canceledActionStreams.every((request) => completedActions.has(request))).toBe(true);
    testInfo.annotations.push({ type: "canceled background Next.js prefetches", description: String(canceledPrefetches) });
    testInfo.annotations.push({ type: "canceled streams after successful action response", description: String(canceledActionStreams.length) });
  } finally {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(data.user.id);
    if (cleanupError) throw new Error("Could not clean up the local recovery fixture.");
  }
});
