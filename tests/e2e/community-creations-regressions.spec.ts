import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { communityArtifactPath, communityFixtures, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";

test.use({ ignoreHTTPSErrors: true });

test("owner actions survive touch blur and persist edit/delete after reload", async ({ page, browser }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_UPLOADS_E2E !== "1" || !["chromium", "webkit-mobile"].includes(testInfo.project.name),
    "Requires isolated real Supabase/Auth/Storage and community flags.");
  test.setTimeout(120_000);
  const fixtures = await communityFixtures(testInfo);
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  const unexpectedHttp: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    // The stale edit below intentionally returns 409; all rendered resource
    // requests and successful CRUD responses must otherwise remain healthy.
    if (response.status() >= 400 && !(response.status() === 409 && response.request().method() === "PATCH")) {
      unexpectedHttp.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
    }
  });
  try {
    const suffix = randomUUID().slice(0, 8);
    const owner = await fixtures.actor("crud-owner", { username: `cc_crud_${suffix}` });
    const outsider = await fixtures.actor("crud-other", { username: `cc_other_${suffix}` });
    const moderator = await fixtures.actor("crud-admin", { admin: true });
    const book = await fixtures.product("Real persistent owner actions");
    await fixtures.unlock(owner.id, book.id);
    await fixtures.login(page, owner);
    const bytes = await sharp({ create: { width: 120, height: 160, channels: 3, background: "#b4bd9b" } }).png().toBuffer();
    const uploaded = await page.request.post(`${COMMUNITY_TEST_ORIGIN}/api/community/artworks`, {
      headers: { Origin: COMMUNITY_TEST_ORIGIN }, multipart: {
        file: { name: "crud.png", mimeType: "image/png", buffer: bytes }, productId: book.id,
        description: "Original published description", idempotencyKey: randomUUID(), rulesAccepted: "true",
      },
    });
    expect(uploaded.ok()).toBe(true);
    const artwork = (await uploaded.json()).artwork;
    expect((await fixtures.service.rpc("community_moderate_artwork", { p_actor_user_id: moderator.id,
      p_artwork_id: artwork.id, p_expected_revision: 1, p_action: "approve", p_reason: null })).error).toBeNull();
    await page.goto(`${COMMUNITY_TEST_ORIGIN}/en/club/artworks/${artwork.id}`);
    await page.getByTestId("community-artwork-manage").click();
    await expect(page).toHaveURL(new RegExp(`/en/library/creations#creation-${artwork.id}$`));
    const card = page.getByTestId("community-artwork-card");
    const action = card.getByTestId("community-artwork-actions");
    const activate = async (testId: string) => {
      const locator = page.getByTestId(testId);
      if (testInfo.project.name === "webkit-mobile") await locator.tap();
      else await locator.click();
    };
    await activate("community-artwork-actions");
    // Reproduce the reported native Safari event ordering, then use a real tap.
    await action.evaluate((element) => (element as HTMLElement).blur());
    await activate("community-artwork-edit-description");
    const draft = card.getByTestId("community-artwork-description");
    await draft.fill("Saved on a real isolated database");
    // A real revision conflict must preserve the user's unsaved text.
    expect((await fixtures.service.rpc("community_moderate_artwork", { p_actor_user_id: moderator.id,
      p_artwork_id: artwork.id, p_expected_revision: 2, p_action: "remove", p_reason: "Controlled stale revision test" })).error).toBeNull();
    const failedSave = page.waitForResponse((response) => response.request().method() === "PATCH");
    await activate("community-artwork-save-description");
    const conflictResponse = await failedSave;
    expect(conflictResponse.status()).toBe(409);
    await expect(draft).toHaveValue("Saved on a real isolated database");
    await expect(page.getByRole("alert").filter({ hasText: "This artwork changed" })).toBeVisible();
    // Reload to obtain a fresh revision, restore publication, then verify the full success path.
    expect((await fixtures.service.rpc("community_moderate_artwork", { p_actor_user_id: moderator.id,
      p_artwork_id: artwork.id, p_expected_revision: 3, p_action: "restore", p_reason: null })).error).toBeNull();
    expect((await fixtures.service.rpc("community_moderate_artwork", { p_actor_user_id: moderator.id,
      p_artwork_id: artwork.id, p_expected_revision: 4, p_action: "approve", p_reason: null })).error).toBeNull();
    await page.reload();
    await activate("community-artwork-actions");
    await action.evaluate((element) => (element as HTMLElement).blur());
    await activate("community-artwork-edit-description");
    await draft.fill("Saved on a real isolated database");
    const saved = page.waitForResponse((response) => response.request().method() === "PATCH");
    await activate("community-artwork-save-description");
    expect((await saved).status()).toBe(200);
    await expect(page.getByRole("status").filter({ hasText: "Your description was saved" })).toBeVisible();
    await page.reload();
    await expect(card).toContainText("Saved on a real isolated database");
    await expect(card).toContainText("Pending review");
    if (process.env.COMMUNITY_ARTIFACT_DIR) await page.screenshot({ path: await communityArtifactPath("issue-121", `crud-saved-${testInfo.project.name}.png`) });
    const row = await fixtures.service.from("community_artworks").select("description,status,revision").eq("id", artwork.id).single();
    expect(row.error).toBeNull();
    expect(row.data).toMatchObject({ description: "Saved on a real isolated database", status: "pending", revision: 6 });
    const stranger = await fixtures.newPage(browser);
    await fixtures.login(stranger, outsider);
    for (const method of ["PATCH", "DELETE"]) {
      const response = await stranger.request.fetch(`${COMMUNITY_TEST_ORIGIN}/api/community/artworks/${artwork.id}`, {
        method, headers: { Origin: COMMUNITY_TEST_ORIGIN }, data: { revision: 6, ...(method === "PATCH" ? { description: "Unauthorized edit" } : {}) },
      });
      // The SQL deliberately merges ownership and stale/missing revisions
      // into one unavailable response, avoiding an existence oracle.
      expect(response.status()).toBe(409);
    }
    const afterStranger = await fixtures.service.from("community_artworks").select("description,status,revision,deleted_at").eq("id", artwork.id).single();
    expect(afterStranger.error).toBeNull();
    expect(afterStranger.data).toMatchObject({ description: "Saved on a real isolated database", status: "pending", revision: 6, deleted_at: null });
    await activate("community-artwork-actions");
    await action.evaluate((element) => (element as HTMLElement).blur());
    await activate("community-artwork-delete");
    await expect(page.getByRole("dialog", { name: "Delete artwork?" })).toBeVisible();
    if (process.env.COMMUNITY_ARTIFACT_DIR) await page.screenshot({ path: await communityArtifactPath("issue-121", `crud-confirm-${testInfo.project.name}.png`) });
    const deleted = page.waitForResponse((response) => response.request().method() === "DELETE");
    await activate("community-artwork-confirm-delete");
    expect((await deleted).status()).toBe(200);
    await expect(page.getByRole("status").filter({ hasText: "Your artwork was deleted" })).toBeVisible();
    await page.reload();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("community-my-artworks-empty")).toBeVisible();
    if (process.env.COMMUNITY_ARTIFACT_DIR) await page.screenshot({ path: await communityArtifactPath("issue-121", `crud-deleted-${testInfo.project.name}.png`) });
    expect((await page.request.get(`${COMMUNITY_TEST_ORIGIN}/api/community/artworks/${artwork.id}/media`)).status()).toBe(404);
    expect(errors).toEqual([]);
    expect(unexpectedHttp).toEqual([]);
    expect(consoleErrors.filter((message) => !/^Failed to load resource:.*(?:409|Conflict)/i.test(message))).toEqual([]);
    console.log(JSON.stringify({ ownerCrud: { testedSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      consoleErrors, expectedConflict: { url: conflictResponse.url(), method: "PATCH", status: conflictResponse.status(), statusText: conflictResponse.statusText() } } }));
  } finally {
    await fixtures.cleanup();
  }
});
