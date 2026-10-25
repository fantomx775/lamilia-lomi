import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { COMMUNITY_RULES_VERSION } from "../../src/lib/community/rules";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

test("disabled community switches block public reads and joining while preserving withdrawal", async ({ page }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_FLAGS_OFF_E2E !== "1" || testInfo.project.name !== "chromium",
    "Requires the isolated Supabase HTTPS application with both community flags OFF.");
  test.setTimeout(90_000);
  const origin = "https://127.0.0.1:3443";
  if (testInfo.project.use.baseURL !== origin || process.env.LAMILIA_BACKEND !== "supabase") {
    throw new Error("Flags test requires the isolated local application.");
  }
  const status = JSON.parse(await readFile("/tmp/lamilia-p0-preflight/local-supabase-status.json", "utf8"));
  if (status.API_URL !== "http://127.0.0.1:55421") throw new Error("Unexpected Supabase fixture target.");
  const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `cc-flags-${randomUUID()}@example.test`;
  const password = `P0-${randomUUID()}-8!`;
  const actor = await service.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { terms_accepted: true, preferred_locale: "en" } });
  if (actor.error || !actor.data.user) throw new Error("Unable to create isolated flags fixture.");
  const userId = actor.data.user.id;
  try {
    const joined = await service.rpc("community_join", { p_actor_user_id: userId, p_username: "cc_flags_fixture",
      p_adult_attested: true, p_rules_version: COMMUNITY_RULES_VERSION });
    expect(joined.error).toBeNull();
    expect((await page.request.get(`${origin}/en/club/creators/cc_flags_fixture`)).status()).toBe(404);
    expect((await page.request.post(`${origin}/api/community/join`, { headers: { Origin: origin }, data: {
      username: "cc_flags_guest", adultAttested: true, rulesAccepted: true, rulesVersion: COMMUNITY_RULES_VERSION,
    } })).status()).toBe(404);
    await page.goto(`${origin}/en/login?returnTo=%2Fen%2Faccount`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/en/account`);
    const panel = page.getByTestId("community-account-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: "Save username", exact: true })).toHaveCount(0);
    await expect(panel.getByRole("link", { name: "View profile", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "My Creations", exact: true })).toBeVisible();
    const responses = await page.evaluate(async () => {
      const get = await fetch("/api/community/profile");
      const patch = await fetch("/api/community/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "cc_flags_new" }) });
      return { get: get.status, patch: patch.status, cache: get.headers.get("cache-control") };
    });
    expect(responses).toEqual({ get: 200, patch: 404, cache: "private, no-store" });
    await panel.getByRole("button", { name: "Leave the Coloring Club", exact: true }).click();
    await panel.getByRole("button", { name: "Confirm leave", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("You left");
    expect((await service.from("community_profiles").select("participation_revoked_at").eq("user_id", userId).single()).data?.participation_revoked_at).toBeTruthy();
  } finally {
    const removed = await service.auth.admin.deleteUser(userId);
    if (removed.error) throw new Error("Failed to remove the isolated flags fixture.");
  }
});
