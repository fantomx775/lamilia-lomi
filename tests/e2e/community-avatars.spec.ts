import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { communityArtifactPath, communityFixtures, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

test("profile photo crop, moderation, private replacement and removal through real Storage", async ({ page, browser }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_AVATAR_E2E !== "1", "Requires the dedicated local Supabase app and Storage.");
  test.setTimeout(140_000);
  const fixtures = await communityFixtures(testInfo);
  const username = `avatar_${randomUUID().slice(0, 8)}`;
  const photoIds = new Set<string>();
  const bucket = fixtures.service.storage.from("community-avatars");
  const origin = COMMUNITY_TEST_ORIGIN;
  try {
    const owner = await fixtures.actor("avatar-owner", { username });
    const admin = await fixtures.actor("avatar-admin", { admin: true });
    const moderator = await fixtures.newPage(browser);
    const visitor = await fixtures.newPage(browser);
    const creatorPath = `/en/club/creators/${username}`;
    const queuePath = `/admin/community/avatars?creator=${username}`;

    await fixtures.login(page, owner, "/en/account");
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
      await photoSection.getByRole("button", { name: "Send photo for review" }).click();
      expect((await completed).status()).toBe(201);
      await expect(page.getByText("Profile photo sent for review.", { exact: true })).toBeVisible();
      await expect(photoSection.getByText("New photo awaiting review.", { exact: false })).toBeVisible();
      const result = await fixtures.service.from("community_profile_avatars").select("id")
        .eq("user_id", owner.id).eq("status", "pending").single();
      expect(result.error).toBeNull();
      const id = String(result.data?.id);
      photoIds.add(id);
      return id;
    }

    const first = await upload("#a794b0", true);
    const firstUrl = `${origin}/api/community/avatars/${first}`;
    const firstAdmin = `${origin}/api/admin/community/avatars/${first}`;
    expect((await visitor.request.get(firstUrl)).status()).toBe(404);
    expect((await page.request.get(firstAdmin)).status()).toBe(403);
    expect((await visitor.request.get(firstAdmin)).status()).toBe(401);
    expect((await page.request.get(`${firstUrl}?owner=1`)).status()).toBe(404);
    await visitor.goto(creatorPath);
    await expect(visitor.getByRole("img", { name: `Generated avatar for @${username}` })).toBeVisible();

    await fixtures.login(moderator, admin, "/admin");
    await moderator.goto(queuePath);
    const reviewCard = moderator.getByRole("listitem").filter({ hasText: `@${username}` });
    await expect(reviewCard.getByRole("img")).toHaveJSProperty("naturalWidth", 384);
    await reviewCard.getByRole("button", { name: "Zatwierdź", exact: true }).click();
    await expect(reviewCard).toHaveCount(0);
    const approved = await visitor.request.get(firstUrl);
    expect(approved.status()).toBe(200);
    expect(approved.headers()["cache-control"]).toBe("private, no-store");
    expect((await sharp(await approved.body()).metadata()).format).toBe("webp");
    await visitor.reload();
    await expect(visitor.getByRole("img", { name: `Profile photo for @${username}` })).toBeVisible();

    await page.reload();
    await expect(photoSection.getByRole("img", { name: `Profile photo for @${username}` })).toBeVisible();
    const second = await upload("#f1bb90");
    expect((await visitor.request.get(firstUrl)).status()).toBe(200);
    expect((await visitor.request.get(`${origin}/api/community/avatars/${second}`)).status()).toBe(404);
    await moderator.reload();
    await reviewCard.getByRole("button", { name: "Odrzuć", exact: true }).click();
    await expect(reviewCard).toHaveCount(0);
    await page.reload();
    await expect(photoSection.getByText("Your latest photo was not approved.", { exact: false })).toBeVisible();
    await expect(photoSection.getByRole("img", { name: `Profile photo for @${username}` })).toBeVisible();

    await photoSection.getByRole("button", { name: "Remove photo", exact: true }).click();
    await photoSection.getByRole("button", { name: "Confirm removal" }).click();
    await expect(page.getByText("Profile photo removed.", { exact: true })).toBeVisible();
    await expect(photoSection.getByRole("img", { name: `Generated avatar for @${username}` })).toBeVisible();
    expect((await visitor.request.get(firstUrl)).status()).toBe(404);
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
