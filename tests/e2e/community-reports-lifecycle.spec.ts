import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { communityArtifactPath, communityFixtures, communityScreenshots, COMMUNITY_TEST_ORIGIN as origin } from "./helpers/community-fixtures";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

test("real private reports, admin decisions, notification intent and account media erasure", async ({ page, browser }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_LIFECYCLE_E2E !== "1" || testInfo.project.name !== "chromium",
    "Requires the isolated HTTPS Supabase app, flags ON and all P0 migrations.");
  test.setTimeout(180_000);
  page.setDefaultTimeout(12_000);
  const fixtures = await communityFixtures(testInfo);
  const runId = process.env.COMMUNITY_BROWSER_RUN_ID ?? "cc07-local-lifecycle-1";
  const screenshots: { path: string; testedSha: string; runId: string }[] = [];
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  try {
    const owner = await fixtures.actor("lifecycle-owner", { username: "cc_lifecycle_artist", stableEmail: true });
    const reporter = await fixtures.actor("lifecycle-reporter"); // No club membership or unlock.
    const moderator = await fixtures.actor("lifecycle-admin", { admin: true });
    const book = await fixtures.product("A Garden Worth Sharing");
    await fixtures.unlock(owner.id, book.id);
    const ownerPage = await fixtures.newPage(browser);
    await fixtures.login(ownerPage, owner);
    const uploaded = await ownerPage.request.post(`${origin}/api/community/artworks`, {
      headers: { Origin: origin }, multipart: {
        file: { name: "rose-fox.webp", mimeType: "image/webp", buffer: await readFile(path.resolve("docs/design/coloring-club/assets/rose-fox.webp")) },
        productId: book.id, description: "A peaceful garden in warm colors", idempotencyKey: randomUUID(), rulesAccepted: "true",
      },
    });
    expect([200, 201]).toContain(uploaded.status());
    const artwork = (await uploaded.json()).artwork as { id: string; revision: number };
    const adminPage = await fixtures.newPage(browser);
    await fixtures.login(adminPage, moderator, "/admin/community");
    const approved = await adminPage.request.post(`${origin}/api/admin/community/artworks/${artwork.id}/moderation`, {
      headers: { Origin: origin }, data: { action: "approve", revision: artwork.revision },
    });
    expect(approved.status()).toBe(200);
    await fixtures.normalizeDisplayTimestamps({ artworkIds: [artwork.id] });
    const outbox = await fixtures.service.from("community_moderation_email_outbox").select("moderation_event_id,state,notification_type").eq("author_user_id", owner.id);
    expect(outbox.error).toBeNull();
    expect(outbox.data).toHaveLength(1);
    expect(outbox.data?.[0]).toMatchObject({ state: "pending", notification_type: "approved" });
    const curated = await fixtures.readerArtwork(book.id, "A Reader's Garden", 0, "cottage.webp");
    await adminPage.goto(`${origin}/admin/products/${book.id}`);
    await expect(adminPage.getByRole("button", { name: "Usuń produkt", exact: true })).toBeEnabled();
    adminPage.once("dialog", (dialog) => dialog.accept());
    await adminPage.getByRole("button", { name: "Usuń produkt", exact: true }).click();
    await expect(adminPage).toHaveURL(/\/admin\/products(?:\?|$)/);
    await expect(adminPage.getByText("Ta książka ma prace lub zapis przesyłania z Klubu Kolorowania. Zarchiwizuj ją zamiast usuwać.", { exact: true })).toBeVisible();
    expect((await fixtures.service.from("products").select("id").eq("id", book.id).single()).error).toBeNull();
    expect((await fixtures.service.from("product_reader_artworks").select("id").eq("id", curated.id).single()).error).toBeNull();
    expect((await fixtures.service.storage.from("collection-media").download(curated.storagePath)).error).toBeNull();
    // Local launcher has no Resend key: a committed decision succeeds and its
    // durable intent stays pending, rather than claiming an email was sent.
    const reportUrl = `${origin}/api/community/artworks/${artwork.id}/report`;
    expect((await page.request.post(reportUrl, { headers: { Origin: origin }, data: { reason: "privacy" } })).status()).toBe(401);
    await fixtures.login(page, reporter, `/en/club/artworks/${artwork.id}`);
    expect((await page.request.post(reportUrl, { data: { reason: "privacy" } })).status()).toBe(403);
    expect((await page.request.post(reportUrl, { headers: { Origin: origin }, data: { reason: "privacy", reporterId: owner.id } })).status()).toBe(400);
    expect((await page.request.get(`${origin}/api/admin/community/reports`)).status()).toBe(403);
    expect((await fixtures.anon.from("community_artwork_reports").select("*")).error?.code).toBe("42501");
    await page.getByTestId("community-artwork-report-open").click();
    await expect(page.getByTestId("community-artwork-report-submit")).toBeDisabled();
    await page.getByRole("radio", { name: /Personal information or privacy/ }).check();
    await page.getByTestId("community-artwork-report-details").fill("Please review this controlled privacy concern.");
    screenshots.push(...await communityScreenshots(page, "cc07", "report-dialog", runId));
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("community-artwork-report-dialog")).toHaveCount(0);
    await expect(page.getByTestId("community-artwork-report-open")).toBeFocused();
    await page.getByTestId("community-artwork-report-open").click();
    const submitted = page.waitForResponse((response) => response.url() === reportUrl && response.request().method() === "POST");
    await page.getByTestId("community-artwork-report-submit").click();
    expect((await submitted).status()).toBe(201);
    await expect(page.getByTestId("community-artwork-report-message")).toContainText("Thank you");
    const duplicate = await page.request.post(reportUrl, { headers: { Origin: origin }, data: { reason: "rights", details: "Must not overwrite the first report." } });
    expect(duplicate.status()).toBe(200);
    expect(await duplicate.json()).toMatchObject({ ok: true, duplicate: true });
    const stored = await fixtures.service.from("community_artwork_reports").select("id,details,reason,revision").eq("artwork_id", artwork.id).single();
    expect(stored.error).toBeNull();
    expect(stored.data).toMatchObject({ reason: "privacy", details: "Please review this controlled privacy concern.", revision: 1 });
    const reportId = stored.data!.id;
    await fixtures.normalizeDisplayTimestamps({ artworkIds: [artwork.id], reportIds: [reportId] });
    const publicListing = await page.request.get(`${origin}/api/community/artworks`);
    expect(await publicListing.text()).not.toContain("controlled privacy concern");
    const adminListing = await adminPage.request.get(`${origin}/api/admin/community/reports`);
    expect(adminListing.status()).toBe(200);
    const adminBody = await adminListing.text();
    for (const privateValue of [reporter.id, reporter.email, owner.email]) expect(adminBody).not.toContain(privateValue);
    await adminPage.goto(`${origin}/admin/community/reports`);
    await expect(adminPage.getByTestId("community-report-item")).toHaveCount(1);
    screenshots.push(...await communityScreenshots(adminPage, "cc07", "admin-reports", runId));
    await adminPage.getByTestId("community-report-reviewed").click();
    await expect(adminPage.getByTestId("community-report-item")).toHaveCount(0);
    await adminPage.getByTestId("community-report-status-filter").selectOption("reviewed");
    await expect(adminPage.getByTestId("community-report-item")).toHaveCount(1);
    const stale = await adminPage.request.post(`${origin}/api/admin/community/reports/${reportId}`, {
      headers: { Origin: origin }, data: { action: "dismiss", revision: 1 },
    });
    expect(stale.status()).toBe(409);
    await adminPage.getByTestId("community-report-resolve").click();
    await expect(adminPage.getByTestId("community-report-item")).toHaveCount(0);
    await adminPage.reload();
    await adminPage.getByTestId("community-report-status-filter").selectOption("resolved");
    await expect(adminPage.getByTestId("community-report-item")).toHaveCount(1);

    // Persistent account quota is tested at its actual HTTP boundary.
    const quotaKey = createHash("sha256").update(`artwork-report-account:${reporter.id}`).digest("hex");
    expect((await fixtures.service.from("community_rate_limit_buckets").upsert({ bucket_key: quotaKey,
      window_started_at: new Date().toISOString(), updated_at: new Date().toISOString(), hit_count: 5 })).error).toBeNull();
    expect((await page.request.post(reportUrl, { headers: { Origin: origin }, data: { reason: "other" } })).status()).toBe(429);
    // Deleting a verified reporter who never joined the club still anonymizes
    // their report and removes free text / all event identity references.
    expect((await page.request.post(`${origin}/api/account/delete`, { headers: { Origin: origin }, data: { confirmation: "DELETE" } })).status()).toBe(200);
    const anonymousReport = await fixtures.service.from("community_artwork_reports").select("reporter_user_id,details").eq("id", reportId).single();
    expect(anonymousReport.data).toEqual({ reporter_user_id: null, details: "" });
    expect((await fixtures.service.from("community_artwork_report_events").select("id").eq("actor_user_id", reporter.id)).data).toEqual([]);

    await ownerPage.goto(`${origin}/en/account`);
    await expect(ownerPage.getByTestId("account-deletion-submit")).toBeDisabled();
    await ownerPage.getByTestId("account-deletion-confirmation").fill("DELETE");
    screenshots.push(...await communityScreenshots(ownerPage, "cc07", "delete-account", runId));
    const erased = ownerPage.waitForResponse((response) => response.url() === `${origin}/api/account/delete` && response.request().method() === "POST");
    await ownerPage.getByTestId("account-deletion-submit").click();
    expect((await erased).status()).toBe(200);
    await expect.poll(async () => (await fixtures.service.auth.admin.getUserById(owner.id)).error?.code).toBe("user_not_found");
    const tombstone = await fixtures.service.from("community_artworks").select("author_id,status,storage_path,description,deleted_at").eq("id", artwork.id).single();
    expect(tombstone.error).toBeNull();
    expect(tombstone.data).toMatchObject({ author_id: null, status: "removed", storage_path: null, description: "" });
    expect(tombstone.data?.deleted_at).toBeTruthy();
    expect((await page.request.get(`${origin}/api/community/artworks/${artwork.id}/media`)).status()).toBe(404);
    expect((await fixtures.service.from("user_product_unlocks").select("product_id").eq("user_id", owner.id)).data).toEqual([]);
    const jobs = await fixtures.service.from("community_account_media_cleanup_jobs").select("id,storage_path,not_before").like("storage_path", `community/${owner.id}/%`);
    expect(jobs.error).toBeNull(); expect(jobs.data).toHaveLength(1);
    expect(Date.parse(jobs.data![0].not_before)).toBeGreaterThan(Date.now() + 10 * 60_000);
    const objectPath = jobs.data![0].storage_path;
    expect((await fixtures.service.storage.from("collection-media").download(objectPath)).error).toBeNull();
    expect((await fixtures.service.rpc("community_claim_account_media_cleanup", { p_lease_token: randomUUID(), p_limit: 10 })).data).toEqual([]);
    // Only this controlled fixture's ledger row is aged, so the actual protected
    // maintenance worker can verify physical storage removal without sleeping.
    expect((await fixtures.service.from("community_account_media_cleanup_jobs").update({ not_before: "2020-01-01T00:00:00Z" }).eq("id", jobs.data![0].id)).error).toBeNull();
    const cronSecret = (await readFile("/tmp/lamilia-p0-preflight/community-cron-secret", "utf8")).trim();
    expect((await page.request.get(`${origin}/api/internal/community/cleanup`)).status()).toBe(401);
    const cleanup = await page.request.get(`${origin}/api/internal/community/cleanup`, { headers: { Authorization: `Bearer ${cronSecret}` } });
    expect(cleanup.status()).toBe(200);
    expect((await fixtures.service.from("community_account_media_cleanup_jobs").select("id").eq("id", jobs.data![0].id)).data).toEqual([]);
    expect((await fixtures.service.storage.from("collection-media").download(objectPath)).error).not.toBeNull();
    expect(runtimeErrors).toEqual([]);
    await writeFile(await communityArtifactPath("cc07"), JSON.stringify({
      status: "PASS", testedSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      runId, screenshots, runtimeErrors, mailProvider: "NOT RUN: local launcher intentionally has no Resend key",
    }, null, 2));
  } finally {
    try {
      const scopes = ["artwork-report-account", "account-deletion"];
      const keys = fixtures.users.flatMap((id) => scopes.map((scope) => createHash("sha256").update(`${scope}:${id}`).digest("hex")));
      if (keys.length) expect((await fixtures.service.from("community_rate_limit_buckets").delete().in("bucket_key", keys)).error).toBeNull();
    } finally { await fixtures.cleanup(); }
  }
});
