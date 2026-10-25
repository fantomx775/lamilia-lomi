import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { communityFixtures, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";
import { COMMUNITY_RULES_VERSION } from "../../src/lib/community/rules";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

test("disabled switches block real public images and mutations while preserving private deletion and withdrawal", async ({ page }, testInfo) => {
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
    expect((await fixtures.service.rpc("community_moderate_artwork", { p_actor_user_id: moderator.id,
      p_artwork_id: artworkId, p_expected_revision: 1, p_action: "approve", p_reason: null })).error).toBeNull();
    const mediaUrl = `${origin}/api/community/artworks/${artworkId}/media`;
    expect((await page.request.get(mediaUrl)).status()).toBe(404);
    expect((await page.request.get(`${origin}/en/club/creators/cc_flags_fixture`)).status()).toBe(404);
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
    expect((await page.request.get(mediaUrl)).status()).toBe(200);
    expect((await page.request.patch(`${origin}/api/community/artworks/${artworkId}`, { headers: { Origin: origin }, data: { revision: 2, description: "Blocked edit" } })).status()).toBe(404);
    expect((await page.request.delete(`${origin}/api/community/artworks/${artworkId}`, { headers: { Origin: origin }, data: { revision: 2 } })).status()).toBe(200);
    expect((await page.request.get(mediaUrl)).status()).toBe(404);
    expect((await fixtures.service.storage.from("collection-media").download(storagePath)).error).toBeTruthy();
    await panel.getByRole("button", { name: "Leave the Coloring Club", exact: true }).click();
    await panel.getByRole("button", { name: "Confirm leave", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("You left");
  } finally {
    await fixtures.cleanup();
  }
});
