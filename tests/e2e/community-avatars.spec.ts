import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { communityArtifactPath, communityFixtures, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

test("profile photo crop, immediate publication, reports, replacement and removal through real Storage", async ({ page, browser }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_AVATAR_E2E !== "1", "Requires the dedicated local Supabase app and Storage.");
  test.setTimeout(140_000);
  const fixtures = await communityFixtures(testInfo);
  const username = `avatar_${randomUUID().slice(0, 8)}`;
  const photoIds = new Set<string>();
  const bucket = fixtures.service.storage.from("community-avatars");
  const origin = COMMUNITY_TEST_ORIGIN;
  const jsErrors: string[] = [];
  const failedResources: string[] = [];
  function observe(target: typeof page) {
    target.on("pageerror", (error) => jsErrors.push(error.message));
    target.on("response", (response) => {
      if (response.status() >= 400) failedResources.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
  }
  observe(page);
  try {
    const owner = await fixtures.actor("avatar-owner", { username });
    const reporter = await fixtures.actor("avatar-reporter");
    const admin = await fixtures.actor("avatar-admin", { admin: true });
    const visitor = await fixtures.newPage(browser);
    observe(visitor);
    const creatorPath = `/en/club/creators/${username}`;

    await fixtures.login(page, owner, "/en/account");
    const book = await fixtures.product("Avatar consistency fixture");
    await fixtures.unlock(owner.id, book.id);
    const artworkBytes = await sharp({ create: { width: 120, height: 160, channels: 3, background: "#b8c19f" } }).png().toBuffer();
    const artworkUpload = await page.request.post(`${origin}/api/community/artworks`, {
      headers: { Origin: origin }, multipart: {
        file: { name: "avatar-art.png", mimeType: "image/png", buffer: artworkBytes }, productId: book.id,
        description: "Avatar consistency artwork", idempotencyKey: randomUUID(), rulesAccepted: "true",
      },
    });
    expect(artworkUpload.ok()).toBe(true);
    const artwork = (await artworkUpload.json()).artwork;
    expect((await fixtures.service.rpc("community_moderate_artwork", { p_actor_user_id: admin.id,
      p_artwork_id: artwork.id, p_expected_revision: 1, p_action: "approve", p_reason: null })).error).toBeNull();
    async function checkPublicConsumers(photoId?: string) {
      for (const route of [creatorPath, `/en/club/artworks/${artwork.id}`, `/en/club?productId=${book.id}`]) {
        const publicPage = await fixtures.newPage(browser);
        observe(publicPage);
        await publicPage.goto(route);
        const avatar = publicPage.getByRole("img", { name: `${photoId ? "Profile photo" : "Generated avatar"} for @${username}`, exact: true });
        await expect(avatar).toBeVisible();
        if (photoId) {
          await expect.poll(() => avatar.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
          const imageUrl = new URL(await avatar.locator("img").getAttribute("src") ?? "", origin);
          expect(imageUrl.origin).toBe(origin);
          expect(imageUrl.pathname).toBe(`/api/community/avatars/${photoId}`);
        }
        await publicPage.close();
      }
    }
    const photoSection = page.getByRole("region", { name: "Profile photo" });
    await expect(photoSection.getByRole("img", { name: `Generated avatar for @${username}` })).toBeVisible();
    await expect((await visitor.request.get(`${origin}/api/community/avatars`)).status()).toBe(401);

    async function upload(color: string, capture = false) {
      const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: color } }).png().toBuffer();
      await photoSection.locator("input[type=file]").setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: png });
      await expect(photoSection.getByRole("img", { name: "Circular crop preview" })).toBeVisible();
      await photoSection.getByRole("slider", { name: "Zoom", exact: true }).fill("1.5");
      if (capture && process.env.COMMUNITY_ARTIFACT_DIR) {
        await photoSection.screenshot({
          path: await communityArtifactPath("issue-121", `avatar-crop-${testInfo.project.name}.png`),
          animations: "disabled", style: "nextjs-portal { display: none !important; }",
        });
      }
      const completed = page.waitForResponse((response) => response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/community/avatars");
      await photoSection.getByRole("button", { name: "Save photo" }).click();
      expect((await completed).status()).toBe(201);
      await expect(page.getByText("Profile photo saved.", { exact: true })).toBeVisible();
      const renderedPhoto = photoSection.getByRole("img", { name: `Profile photo for @${username}` });
      await expect(renderedPhoto).toBeVisible();
      await expect.poll(() => renderedPhoto.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      const result = await fixtures.service.from("community_profile_avatars").select("id")
        .eq("user_id", owner.id).eq("status", "approved").single();
      expect(result.error).toBeNull();
      const id = String(result.data?.id);
      photoIds.add(id);
      return id;
    }

    const first = await upload("#a794b0", true);
    const firstUrl = `${origin}/api/community/avatars/${first}`;
    const firstAdmin = `${origin}/api/admin/community/avatars/${first}`;
    expect((await visitor.request.get(firstUrl)).status()).toBe(200);
    expect((await page.request.get(firstAdmin)).status()).toBe(403);
    expect((await visitor.request.get(firstAdmin)).status()).toBe(401);
    expect((await page.request.get(`${firstUrl}?owner=1`)).status()).toBe(200);
    await checkPublicConsumers(first);
    await visitor.goto(creatorPath);

    const approved = await visitor.request.get(firstUrl);
    expect(approved.status()).toBe(200);
    expect(approved.headers()["cache-control"]).toBe("private, no-store");
    expect((await sharp(await approved.body()).metadata()).format).toBe("webp");
    await visitor.reload();
    await expect(visitor.getByRole("img", { name: `Profile photo for @${username}` })).toBeVisible();

    await page.reload();
    await expect(photoSection.getByRole("img", { name: `Profile photo for @${username}` })).toBeVisible();
    const second = await upload("#f1bb90");
    await checkPublicConsumers(second);
    expect((await visitor.request.get(firstUrl)).status()).toBe(404);
    expect((await visitor.request.get(`${origin}/api/community/avatars/${second}`)).status()).toBe(200);
    await page.reload();
    await expect(photoSection.getByRole("img", { name: `Profile photo for @${username}` })).toBeVisible();

    // A signed-in visitor reports the public photo; only an administrator can take it down.
    await fixtures.login(visitor, reporter, creatorPath);
    await visitor.getByRole("button", { name: "Report this profile photo", exact: true }).click();
    await visitor.getByRole("radio", { name: "Personal information or privacy", exact: true }).check();
    await visitor.getByLabel("Additional details (optional)").fill("Isolated avatar report fixture");
    const reported = visitor.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/community/avatars/${second}/report`);
    await visitor.getByRole("button", { name: "Send report", exact: true }).click();
    expect((await reported).status()).toBe(201);
    await expect(visitor.getByText("Thank you. Your report has been sent to the moderation team.", { exact: true })).toBeVisible();
    const moderator = await fixtures.newPage(browser);
    observe(moderator);
    await fixtures.login(moderator, admin, `/admin/community/avatars?creator=${username}`);
    await expect(moderator.getByText("Isolated avatar report fixture", { exact: true })).toBeVisible();
    const takenDown = moderator.waitForResponse((response) => response.request().method() === "PATCH"
      && new URL(response.url()).pathname === `/api/admin/community/avatars/${second}`);
    await moderator.getByRole("button", { name: "Usuń publiczne zdjęcie", exact: true }).click();
    expect((await takenDown).status()).toBe(200);
    await expect(moderator.getByText(`@${username}`, { exact: true })).toHaveCount(0);
    expect((await visitor.request.get(`${origin}/api/community/avatars/${second}`)).status()).toBe(404);
    await checkPublicConsumers();
    await page.reload();
    await expect(photoSection.getByRole("img", { name: `Generated avatar for @${username}` })).toBeVisible();
    const third = await upload("#a0bacc");

    await photoSection.getByRole("button", { name: "Remove photo", exact: true }).click();
    await photoSection.getByRole("button", { name: "Confirm removal" }).click();
    await expect(page.getByText("Profile photo removed.", { exact: true })).toBeVisible();
    await expect(photoSection.getByRole("img", { name: `Generated avatar for @${username}` })).toBeVisible();
    expect((await visitor.request.get(firstUrl)).status()).toBe(404);
    expect((await visitor.request.get(`${origin}/api/community/avatars/${second}`)).status()).toBe(404);
    expect((await visitor.request.get(`${origin}/api/community/avatars/${third}`)).status()).toBe(404);
    await checkPublicConsumers();
    await page.reload();
    await expect(photoSection.getByRole("img", { name: `Generated avatar for @${username}` })).toBeVisible();
    expect(jsErrors).toEqual([]);
    expect(failedResources).toEqual([]);
  } finally {
    await fixtures.cleanup();
    if (photoIds.size) {
      const ids = [...photoIds];
      expect((await bucket.remove(ids)).error).toBeNull();
      expect((await fixtures.service.from("community_account_media_cleanup_jobs").delete()
        .in("storage_path", ids.map((id) => `avatars/${id}`))).error).toBeNull();
    }
  }
});
