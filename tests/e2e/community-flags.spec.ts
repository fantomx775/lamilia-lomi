import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { communityArtifactPath, communityHtmlCheck, communityFixtures, essentials, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";
import { COMMUNITY_RULES_VERSION } from "../../src/lib/community/rules";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

test("disabled switches block real public images and mutations while preserving private deletion and withdrawal", async ({ page, browser }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_FLAGS_OFF_E2E !== "1" || testInfo.project.name !== "chromium",
    "Requires the isolated Supabase HTTPS application with both community flags OFF.");
  test.setTimeout(90_000);
  const fixtures = await communityFixtures(testInfo);
  const origin = COMMUNITY_TEST_ORIGIN;
  try {
    const owner = await fixtures.actor("flags-owner", { username: "cc_flags_fixture" });
    const moderator = await fixtures.actor("flags-admin", { admin: true });
    const book = await fixtures.product("Feature Flag Fixture Book");
    await fixtures.unlock(owner.id, book.id);
    const curated = await fixtures.readerArtwork(book.id, "Curated Flag Fixture", 0, "cottage.webp");
    // Bootstrap controlled, valid private bytes through service-only reservation
    // RPCs because the HTTP upload endpoint is intentionally OFF in this server.
    const image = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#8b9c87" } }).webp().toBuffer();
    const key = randomUUID();
    const lease = randomUUID();
    expect((await fixtures.service.rpc("community_reserve_upload", { p_actor_user_id: owner.id, p_lease_token: lease,
      p_product_id: book.id, p_idempotency_key: key, p_upload_fingerprint: createHash("sha256").update(image).digest("hex"),
      p_storage_provider: "supabase", p_original_size_bytes: image.length, p_size_bytes: image.length,
      p_content_type: "image/webp", p_description: "Flag boundary fixture" })).error).toBeNull();
    const storagePath = `community/${owner.id}/${key}`;
    expect((await fixtures.service.storage.from("collection-media").upload(storagePath, image, { contentType: "image/webp", upsert: false })).error).toBeNull();
    expect((await fixtures.service.rpc("community_mark_upload_stored", { p_actor_user_id: owner.id, p_idempotency_key: key, p_lease_token: lease })).error).toBeNull();
    const finalized = await fixtures.service.rpc("community_finalize_upload", { p_actor_user_id: owner.id, p_idempotency_key: key, p_lease_token: lease });
    expect(finalized.error).toBeNull();
    const artworkId = finalized.data as string;
    const adminPage = await fixtures.newPage(browser);
    await fixtures.login(adminPage, moderator, "/admin/community");
    await expect(adminPage.getByTestId("community-moderation-page")).toBeVisible();
    const approved = await adminPage.request.post(`${origin}/api/admin/community/artworks/${artworkId}/moderation`, {
      headers: { Origin: origin }, data: { action: "approve", revision: 1 },
    });
    expect(approved.status()).toBe(200);
    const adminQueue = await adminPage.request.get(`${origin}/api/admin/community/artworks?status=approved&productId=${book.id}`);
    expect(adminQueue.status()).toBe(200);
    expect((await adminQueue.json()).items.map((item: { id: string }) => item.id)).toEqual([artworkId]);
    const seededHeart = await fixtures.service.rpc("community_set_artwork_like", {
      p_actor_user_id: owner.id, p_artwork_id: artworkId, p_liked: true,
    });
    expect(seededHeart.error).toBeNull();
    expect(seededHeart.data).toMatchObject({ available: true, liked: true, likesCount: 1 });
    const bodylessDelete = await page.request.delete(`${origin}/api/community/artworks/${artworkId}`, { maxRedirects: 0 });
    expect(bodylessDelete.status()).toBe(403);
    expect(bodylessDelete.headers()["content-type"]).toContain("application/json");
    expect(await bodylessDelete.json()).toMatchObject({ ok: false, error: "invalid_request", message: "Refresh the page and try again." });
    expect((await fixtures.service.from("community_artworks").select("status,revision,deleted_at").eq("id", artworkId).single()).data)
      .toMatchObject({ status: "approved", revision: 2, deleted_at: null });
    const mediaUrl = `${origin}/api/community/artworks/${artworkId}/media`;
    const anonymousMediaStatus = (await page.request.get(mediaUrl)).status();
    expect(anonymousMediaStatus).toBe(404);
    const checks = [];
    for (const pathname of ["/en/club", `/en/club/artworks/${artworkId}`, "/en/club/creators/cc_flags_fixture"]) {
      checks.push(await communityHtmlCheck(page.request, pathname, 404, "This page could not be found."));
    }
    expect((await page.request.get(`${origin}/en/club`)).status()).toBe(404);
    expect((await page.request.get(`${origin}/en/club/artworks/${artworkId}`)).status()).toBe(404);
    const publicListingStatus = (await page.request.get(`${origin}/api/community/artworks`)).status();
    expect(publicListingStatus).toBe(404);
    expect((await page.request.get(`${origin}/api/community/artworks/${artworkId}/heart`)).status()).toBe(404);
    expect((await page.request.put(`${origin}/api/community/artworks/${artworkId}/heart`, { headers: { Origin: origin } })).status()).toBe(404);
    expect((await page.request.get(`${origin}/en/club/creators/cc_flags_fixture`)).status()).toBe(404);
    const sitemap = await page.request.get(`${origin}/sitemap.xml`);
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).not.toContain("/en/club");
    await page.goto(`${origin}/en/products/${book.slug}`);
    await essentials(page);
    await expect(page.getByRole("heading", { name: "Colored by Our Readers", exact: true })).toHaveCount(1);
    await expect(page.getByTestId("reader-artwork-grid")).toContainText("Curated Flag Fixture");
    expect((await page.request.get(`${origin}/api/reader-artworks/${curated.id}`)).status()).toBe(200);
    await expect(page.getByRole("link", { name: "Share your art", exact: true })).toHaveCount(0);
    expect((await page.request.post(`${origin}/api/community/join`, { headers: { Origin: origin }, data: {
      username: "cc_flags_guest", adultAttested: true, rulesAccepted: true, rulesVersion: COMMUNITY_RULES_VERSION,
    } })).status()).toBe(404);
    expect((await page.request.post(`${origin}/api/community/artworks`, { headers: { Origin: origin }, multipart: {
      file: { name: "fixture.webp", mimeType: "image/webp", buffer: image }, productId: book.id,
      description: "Blocked upload", idempotencyKey: randomUUID(), rulesAccepted: "true",
    } })).status()).toBe(404);
    await fixtures.login(page, owner, "/en/account");
    const panel = page.getByTestId("community-account-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: "Save username", exact: true })).toHaveCount(0);
    await expect(panel.getByRole("link", { name: "View profile", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "My Creations", exact: true })).toBeVisible();
    const settings = await page.request.get(`${origin}/api/community/profile`);
    expect(settings.status()).toBe(200);
    expect(settings.headers()["cache-control"]).toBe("private, no-store");
    expect((await page.request.patch(`${origin}/api/community/profile`, { headers: { Origin: origin }, data: { username: "cc_flags_new" } })).status()).toBe(404);
    const ownerMediaStatus = (await page.request.get(mediaUrl)).status();
    expect(ownerMediaStatus).toBe(200);
    const reportDenied = await page.request.post(`${origin}/api/community/artworks/${artworkId}/report`, {
      headers: { Origin: origin }, data: { reason: "privacy" },
    });
    expect(reportDenied.status()).toBe(404);
    expect((await page.request.put(`${origin}/api/community/artworks/${artworkId}/heart`, { headers: { Origin: origin } })).status()).toBe(404);
    expect((await page.request.delete(`${origin}/api/community/artworks/${artworkId}/heart`, { headers: { Origin: origin } })).status()).toBe(404);
    expect((await page.request.patch(`${origin}/api/community/artworks/${artworkId}`, { headers: { Origin: origin }, data: { revision: 2, description: "Blocked edit" } })).status()).toBe(404);
    expect((await page.request.delete(`${origin}/api/community/artworks/${artworkId}`, { headers: { Origin: origin }, data: { revision: 2 } })).status()).toBe(200);
    expect((await page.request.get(mediaUrl)).status()).toBe(404);
    expect((await fixtures.service.storage.from("collection-media").download(storagePath)).error).toBeTruthy();
    await panel.getByRole("button", { name: "Leave the Coloring Club", exact: true }).click();
    await panel.getByRole("button", { name: "Confirm leave", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("You left");
    const cronSecret = (await readFile("/tmp/lamilia-p0-preflight/community-cron-secret", "utf8")).trim();
    expect((await page.request.get(`${origin}/api/internal/community/cleanup`, { headers: { Authorization: `Bearer ${cronSecret}` } })).status()).toBe(200);
    await writeFile(await communityArtifactPath("cc07", "public-off-proof.json"), JSON.stringify({
      status: "PASS", testedSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      runId: process.env.COMMUNITY_BROWSER_RUN_ID ?? "cc07-public-off-1", publicEnabled: false,
      command: "LAMILIA_BACKEND=supabase PLAYWRIGHT_BASE_URL=https://127.0.0.1:3443 RUN_COMMUNITY_FLAGS_OFF_E2E=1 npx playwright test tests/e2e/community-flags.spec.ts --project=chromium --workers=1",
      checks, approvedFixture: { artworkPath: `/en/club/artworks/${artworkId}`, mediaPath: `/api/community/artworks/${artworkId}/media`,
        artworkStatus: "approved", ownerMediaStatus, anonymousMediaStatus, publicListingStatus, mutationsBlocked: true },
    }, null, 2));
  } finally {
    await fixtures.cleanup();
  }
});
