import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { communityFixtures, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

test("F12 every artwork size rechecks public, owner, stranger and moderator visibility after takedown and delete", async ({ page, browser }, testInfo) => {
  test.skip(process.env.RUN_ISSUE_127_MEDIA_E2E !== "1", "Requires exclusive local real Supabase with Club public/upload flags ON.");
  test.setTimeout(180_000);
  const fixtures = await communityFixtures(testInfo);
  try {
    const owner = await fixtures.actor("variants-owner", { username: `variant_on_${randomUUID().slice(0, 8)}` });
    const stranger = await fixtures.actor("variants-stranger");
    const admin = await fixtures.actor("variants-admin", { admin: true });
    const book = await fixtures.product("Variant access fixture");
    await fixtures.unlock(owner.id, book.id);
    const id = randomUUID();
    const storagePath = `community/${owner.id}/${randomUUID()}`;
    const bytes = await sharp({ create: { width: 1536, height: 2048, channels: 3, background: "#c6b6d6" } }).webp().toBuffer();
    expect((await fixtures.service.storage.from("collection-media").upload(storagePath, bytes, { contentType: "image/webp" })).error).toBeNull();
    expect((await fixtures.service.from("community_artworks").insert({ id, author_id: owner.id, product_id: book.id, storage_path: storagePath, storage_provider: "supabase", content_type: "image/webp", size_bytes: bytes.length, description: "Controlled access test", status: "pending" })).error).toBeNull();
    const ownerPage = await fixtures.newPage(browser);
    const strangerPage = await fixtures.newPage(browser);
    const adminPage = await fixtures.newPage(browser);
    await fixtures.login(ownerPage, owner);
    await fixtures.login(strangerPage, stranger);
    await fixtures.login(adminPage, admin);
    const widths = [undefined, 480, 960, 2048];
    async function check(client: APIRequestContext, expected: number) {
      for (const width of widths) {
        const response = await client.get(`${COMMUNITY_TEST_ORIGIN}/api/community/artworks/${id}/media${width ? `?width=${width}` : ""}`);
        expect(response.status()).toBe(expected);
        expect(response.headers()["cache-control"]).toBe("private, no-store");
        if (expected === 200) {
          const metadata = await sharp(await response.body()).metadata();
          expect(metadata.width).toBe(width ? Math.min(width, 1536) : 1536);
          expect(metadata.format).toBe("webp");
        }
      }
    }
    await check(page.request, 404); await check(strangerPage.request, 404);
    await check(ownerPage.request, 200); await check(adminPage.request, 200);
    expect((await fixtures.service.rpc("community_moderate_artwork", { p_actor_user_id: admin.id, p_artwork_id: id, p_expected_revision: 1, p_action: "approve", p_reason: null })).error).toBeNull();
    await check(page.request, 200); await check(strangerPage.request, 200);
    expect((await fixtures.service.rpc("community_moderate_artwork", { p_actor_user_id: admin.id, p_artwork_id: id, p_expected_revision: 2, p_action: "remove", p_reason: "Controlled takedown" })).error).toBeNull();
    await check(page.request, 404); await check(strangerPage.request, 404);
    // Moderation previews remain private to owner/admin by the existing contract.
    await check(ownerPage.request, 200); await check(adminPage.request, 200);
    expect((await fixtures.service.rpc("community_delete_artwork", { p_actor_user_id: owner.id, p_artwork_id: id, p_expected_revision: 3 })).error).toBeNull();
    for (const client of [page.request, strangerPage.request, ownerPage.request, adminPage.request]) await check(client, 404);
    await page.reload();
    await check(page.request, 404);
  } finally { await fixtures.cleanup(); }
});

test("F12 feature OFF denies every public variant while preserving authorized private previews", async ({ page, browser }, testInfo) => {
  test.skip(process.env.RUN_ISSUE_127_MEDIA_OFF_E2E !== "1", "Requires a separate exclusive local Supabase app with Club public/upload flags OFF.");
  test.setTimeout(120_000);
  const fixtures = await communityFixtures(testInfo);
  try {
    expect((await page.request.get(`${COMMUNITY_TEST_ORIGIN}/en/club`)).status()).toBe(404);
    const owner = await fixtures.actor("variants-off-owner", { username: `variant_off_${randomUUID().slice(0, 8)}` });
    const admin = await fixtures.actor("variants-off-admin", { admin: true });
    const book = await fixtures.product("Private variant fixture");
    await fixtures.unlock(owner.id, book.id);
    const id = randomUUID();
    const storagePath = `community/${owner.id}/${randomUUID()}`;
    const bytes = await sharp({ create: { width: 960, height: 1280, channels: 3, background: "#b6c6d6" } }).webp().toBuffer();
    expect((await fixtures.service.storage.from("collection-media").upload(storagePath, bytes, { contentType: "image/webp" })).error).toBeNull();
    expect((await fixtures.service.from("community_artworks").insert({ id, author_id: owner.id, product_id: book.id, storage_path: storagePath, storage_provider: "supabase", content_type: "image/webp", size_bytes: bytes.length, description: "Controlled private media", status: "pending" })).error).toBeNull();
    expect((await fixtures.service.rpc("community_moderate_artwork", { p_actor_user_id: admin.id, p_artwork_id: id, p_expected_revision: 1, p_action: "approve", p_reason: null })).error).toBeNull();
    const ownerPage = await fixtures.newPage(browser);
    await fixtures.login(ownerPage, owner);
    for (const width of [undefined, 480, 960, 2048]) {
      const url = `${COMMUNITY_TEST_ORIGIN}/api/community/artworks/${id}/media${width ? `?width=${width}` : ""}`;
      const publicResponse = await page.request.get(url);
      expect(publicResponse.status()).toBe(404);
      expect(publicResponse.headers()["cache-control"]).toBe("private, no-store");
      const privateResponse = await ownerPage.request.get(url);
      expect(privateResponse.status()).toBe(200);
      expect(privateResponse.headers()["cache-control"]).toBe("private, no-store");
      expect((await sharp(await privateResponse.body()).metadata()).format).toBe("webp");
    }
  } finally { await fixtures.cleanup(); }
});
