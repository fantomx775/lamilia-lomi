import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { communityFixtures, communityScreenshots, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

async function readyArtworkPreviews(page: Page) {
  for (const image of await page.getByTestId("community-artwork-preview").all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
}

test("real private image pipeline, retries, metadata stripping and immediate publication revocation", async ({ page, browser }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_UPLOADS_E2E !== "1" || testInfo.project.name !== "chromium",
    "Requires the isolated real Supabase application, validated community migrations and both flags ON.");
  test.setTimeout(240_000);
  const fixtures = await communityFixtures(testInfo);
  const { service, anon } = fixtures;
  const origin = COMMUNITY_TEST_ORIGIN;
  const artEndpoint = `${origin}/api/community/artworks`;
  try {
    const member = await fixtures.actor("upload-owner", { username: "cc_upload_artist" });
    const outsider = await fixtures.actor("upload-other", { username: "cc_upload_other" });
    const nonmember = await fixtures.actor("upload-nonmember");
    const moderator = await fixtures.actor("upload-moderator", { admin: true });
    const book = await fixtures.product("Quiet Garden Coloring Book");
    const archived = await fixtures.product("Archived Fixture Book", "archived");
    await fixtures.unlock(member.id, book.id);
    await fixtures.unlock(member.id, archived.id);
    const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#a1ad94" } }).png().toBuffer();
    const jpeg = await sharp(png).jpeg().withExif({ IFD0: { Artist: "Private fixture author" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "52/1 13/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "21/1 0/1 0/1" } }).toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeTruthy();
    async function upload(target: Page, bytes: Buffer, mimeType: string, productId: string, key = randomUUID(), description = "A calm garden afternoon") {
      return target.request.post(artEndpoint, { headers: { Origin: origin }, multipart: {
        file: { name: "private-original.jpg", mimeType, buffer: bytes }, productId, description,
        idempotencyKey: key, rulesAccepted: "true",
      } });
    }
    // Guest and actual signed-in users are denied independently of client UI.
    expect([401, 403]).toContain((await upload(page, jpeg, "image/jpeg", book.id)).status());
    const otherPage = await fixtures.newPage(browser);
    await fixtures.login(otherPage, outsider);
    expect((await upload(otherPage, jpeg, "image/jpeg", book.id)).status()).toBe(403);
    await fixtures.unlock(outsider.id, book.id);
    expect((await service.from("community_profiles").update({ suspended_at: new Date().toISOString() }).eq("user_id", outsider.id)).error).toBeNull();
    expect((await upload(otherPage, jpeg, "image/jpeg", book.id)).status()).toBe(403);
    expect((await service.from("community_profiles").update({ suspended_at: null }).eq("user_id", outsider.id)).error).toBeNull();
    fixtures.setEmailVerified(outsider.id, false);
    expect([401, 403]).toContain((await upload(otherPage, jpeg, "image/jpeg", book.id)).status());
    fixtures.setEmailVerified(outsider.id, true);
    const nonmemberPage = await fixtures.newPage(browser);
    await fixtures.login(nonmemberPage, nonmember);
    expect((await upload(nonmemberPage, jpeg, "image/jpeg", book.id)).status()).toBe(403);
    await fixtures.login(page, member);
    expect((await upload(page, jpeg, "image/jpeg", archived.id)).status()).toBe(403);

    const key = randomUUID();
    const responses = await Promise.all([upload(page, jpeg, "image/jpeg", book.id, key), upload(page, jpeg, "image/jpeg", book.id, key)]);
    const bodies = await Promise.all(responses.map(async (response) => ({ status: response.status(), body: await response.json() })));
    // A transient conflict may ask the second concurrent request to retry; its
    // stable key must eventually resolve to the same single finalized artwork.
    expect(bodies.some((result) => result.status === 200 || result.status === 201)).toBe(true);
    for (const response of bodies) expect([200, 201, 409]).toContain(response.status);
    const retried = await upload(page, jpeg, "image/jpeg", book.id, key);
    expect([200, 201]).toContain(retried.status());
    const body = await retried.json();
    const art = body.artwork;
    expect(art).toMatchObject({ status: "pending", revision: 1 });
    expect(art.id).toMatch(/^[0-9a-f-]{36}$/);
    const id = art.id as string;
    expect((await service.from("community_artworks").select("id", { count: "exact" }).eq("author_id", member.id)).count).toBe(1);
    expect((await upload(page, png, "image/png", book.id, key)).status()).toBe(409);
    const mediaUrl = `${artEndpoint}/${id}/media`;
    const ownerImage = await page.request.get(mediaUrl);
    expect(ownerImage.status()).toBe(200);
    expect(ownerImage.headers()["cache-control"]).toContain("no-store");
    expect(ownerImage.headers()["x-content-type-options"]).toBe("nosniff");
    const normalized = await sharp(await ownerImage.body()).metadata();
    expect(normalized.format).toBe("webp");
    expect(normalized.exif).toBeUndefined();
    expect(normalized.xmp).toBeUndefined();
    expect((normalized.width ?? 0) * (normalized.height ?? 0)).toBeGreaterThan(0);
    expect((await otherPage.request.get(mediaUrl)).status()).toBe(404);
    const visitor = await fixtures.newPage(browser);
    expect((await visitor.request.get(mediaUrl)).status()).toBe(404);
    const raw = await service.from("community_artworks").select("storage_path,storage_provider").eq("id", id).single();
    expect(raw.error).toBeNull();
    expect(raw.data?.storage_provider).toBe("supabase");
    expect(raw.data?.storage_path).toBe(`community/${member.id}/${key}`);
    expect((await anon.storage.from("collection-media").download(raw.data!.storage_path)).error).toBeTruthy();
    const signed = await anon.auth.signInWithPassword({ email: member.email, password: member.password });
    expect(signed.error).toBeNull();
    expect((await anon.storage.from("collection-media").download(raw.data!.storage_path)).error).toBeTruthy();
    expect((await anon.from("community_upload_reservations").select("*")).error?.code).toBe("42501");
    expect((await otherPage.request.patch(`${artEndpoint}/${id}`, { headers: { Origin: origin }, data: { revision: 1, description: "Cross-user mutation" } })).status()).toBeGreaterThanOrEqual(403);

    // Invalid file bytes and MIME mismatches cannot add an object or art row.
    expect((await upload(page, Buffer.from("not an image"), "image/jpeg", book.id)).status()).toBe(400);
    expect((await upload(page, png, "image/jpeg", book.id)).status()).toBe(400);
    expect([400, 413]).toContain((await upload(page, Buffer.alloc(4 * 1024 * 1024 + 1), "image/jpeg", book.id)).status());
    expect((await service.from("community_artworks").select("id", { count: "exact" }).eq("author_id", member.id)).count).toBe(1);
    const stored = await service.storage.from("collection-media").list(`community/${member.id}`);
    expect(stored.error).toBeNull();
    expect(stored.data?.filter((item) => item.id)).toHaveLength(1);

    const adminPage = await fixtures.newPage(browser);
    await fixtures.login(adminPage, moderator, "/en/account");
    expect((await adminPage.request.get(mediaUrl)).status()).toBe(200);
    expect((await service.rpc("community_moderate_artwork", { p_actor_user_id: moderator.id, p_artwork_id: id,
      p_expected_revision: 1, p_action: "approve", p_reason: null })).error).toBeNull();
    expect((await visitor.request.get(mediaUrl)).status()).toBe(200);
    const optimizer = `${origin}/_next/image?url=${encodeURIComponent(`/api/community/artworks/${id}/media`)}&w=640&q=75`;
    expect((await visitor.request.get(optimizer)).status()).toBe(400);
    expect((await service.from("products").update({ status: "archived" }).eq("id", book.id)).error).toBeNull();
    expect((await visitor.request.get(mediaUrl)).status()).toBe(404);
    expect((await service.from("products").update({ status: "published" }).eq("id", book.id)).error).toBeNull();
    expect((await visitor.request.get(mediaUrl)).status()).toBe(200);

    const edited = await page.request.patch(`${artEndpoint}/${id}`, { headers: { Origin: origin }, data: { revision: 2, description: "A revised garden afternoon" } });
    expect(edited.status()).toBe(200);
    expect((await visitor.request.get(mediaUrl)).status()).toBe(404);
    expect((await page.request.get(mediaUrl)).status()).toBe(200);
    expect((await service.from("community_artworks").select("status,revision").eq("id", id).single()).data).toMatchObject({ status: "pending", revision: 3 });
    expect((await service.rpc("community_moderate_artwork", { p_actor_user_id: moderator.id, p_artwork_id: id,
      p_expected_revision: 3, p_action: "approve", p_reason: null })).error).toBeNull();
    expect((await visitor.request.get(mediaUrl)).status()).toBe(200);
    const deleted = await page.request.delete(`${artEndpoint}/${id}`, { headers: { Origin: origin }, data: { revision: 4 } });
    expect(deleted.status()).toBe(200);
    for (const target of [page, visitor, adminPage]) expect((await target.request.get(mediaUrl)).status()).toBe(404);
    expect((await visitor.request.get(optimizer)).status()).toBe(400);
    await expect.poll(async () => !(await service.storage.from("collection-media").download(raw.data!.storage_path)).data,
      { timeout: 15_000, message: "Deleted fixture bytes must be cleaned after access is revoked." }).toBe(true);
  } finally {
    await fixtures.cleanup();
  }
});

test("upload quota is persistent and atomic across simultaneous independent submissions", async ({ page }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_UPLOADS_E2E !== "1" || testInfo.project.name !== "chromium",
    "Requires the isolated real Supabase upload application.");
  test.setTimeout(120_000);
  const fixtures = await communityFixtures(testInfo);
  try {
    const member = await fixtures.actor("rate-owner", { username: "cc_rate_artist" });
    const book = await fixtures.product("Rate Limit Fixture Book");
    await fixtures.unlock(member.id, book.id);
    await fixtures.login(page, member);
    const image = await sharp({ create: { width: 120, height: 160, channels: 3, background: "#bc9077" } }).webp().toBuffer();
    const responses = await Promise.all(Array.from({ length: 7 }, () => page.request.post(`${COMMUNITY_TEST_ORIGIN}/api/community/artworks`, {
      headers: { Origin: COMMUNITY_TEST_ORIGIN }, multipart: {
        file: { name: "fixture.webp", mimeType: "image/webp", buffer: image },
        productId: book.id, description: "Quota fixture", idempotencyKey: randomUUID(), rulesAccepted: "true",
      },
    })));
    const statuses = responses.map((response) => response.status());
    expect(statuses.filter((status) => status === 200 || status === 201)).toHaveLength(6);
    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    expect((await fixtures.service.from("community_artworks").select("id", { count: "exact" }).eq("author_id", member.id)).count).toBe(6);
    const stored = await fixtures.service.storage.from("collection-media").list(`community/${member.id}`);
    expect(stored.error).toBeNull();
    expect(stored.data?.filter((entry) => entry.id)).toHaveLength(6);
    await page.reload();
    await expect(page.getByTestId("localized-route-loading")).toHaveCount(0);
    expect((await fixtures.service.from("community_artworks").select("id", { count: "exact" }).eq("author_id", member.id)).count).toBe(6);
  } finally {
    await fixtures.cleanup();
  }
});

test("a genuine isolated storage rejection leaves no artwork or orphan and the same upload key can retry", async ({ page }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_UPLOADS_E2E !== "1" || testInfo.project.name !== "chromium",
    "Requires exclusive use of the isolated local storage bucket; never run against cloud resources.");
  test.setTimeout(120_000);
  const fixtures = await communityFixtures(testInfo);
  let restoreBucket: (() => Promise<void>) | undefined;
  try {
    const member = await fixtures.actor("storage-failure", { username: "cc_storage_artist" });
    const book = await fixtures.product("Storage Failure Fixture Book");
    await fixtures.unlock(member.id, book.id);
    await fixtures.login(page, member);
    const inspected = await fixtures.service.storage.getBucket("collection-media");
    expect(inspected.error).toBeNull();
    if (!inspected.data || inspected.data.public) throw new Error("Expected the isolated private collection-media bucket.");
    const prior = inspected.data;
    restoreBucket = async () => {
      expect((await fixtures.service.storage.updateBucket("collection-media", { public: false,
        fileSizeLimit: prior.file_size_limit, allowedMimeTypes: prior.allowed_mime_types })).error).toBeNull();
    };
    expect((await fixtures.service.storage.updateBucket("collection-media", { public: false,
      fileSizeLimit: 1, allowedMimeTypes: prior.allowed_mime_types })).error).toBeNull();
    const image = await sharp({ create: { width: 120, height: 160, channels: 3, background: "#bc9077" } }).webp().toBuffer();
    const key = randomUUID();
    const send = () => page.request.post(`${COMMUNITY_TEST_ORIGIN}/api/community/artworks`, {
      headers: { Origin: COMMUNITY_TEST_ORIGIN }, multipart: {
        file: { name: "fixture.webp", mimeType: "image/webp", buffer: image }, productId: book.id,
        description: "Safe retry after provider rejection", idempotencyKey: key, rulesAccepted: "true",
      },
    });
    const failed = await send();
    expect([409, 503]).toContain(failed.status());
    expect((await fixtures.service.from("community_artworks").select("id", { count: "exact" }).eq("author_id", member.id)).count).toBe(0);
    expect((await fixtures.service.storage.from("collection-media").list(`community/${member.id}`)).data?.filter((entry) => entry.id)).toHaveLength(0);
    await restoreBucket();
    restoreBucket = undefined;
    const retried = await send();
    expect([200, 201]).toContain(retried.status());
    expect((await retried.json()).artwork).toMatchObject({ status: "pending", revision: 1 });
    expect((await fixtures.service.from("community_artworks").select("id", { count: "exact" }).eq("author_id", member.id)).count).toBe(1);
  } finally {
    try {
      if (restoreBucket) await restoreBucket();
    } finally {
      await fixtures.cleanup();
    }
  }
});

test("three previews become independent private creations with persistent statuses and author controls", async ({ page }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_UPLOADS_E2E !== "1" || testInfo.project.name !== "chromium",
    "Requires the isolated real Supabase upload application.");
  test.setTimeout(240_000);
  page.setDefaultTimeout(12_000);
  const fixtures = await communityFixtures(testInfo);
  const runId = process.env.COMMUNITY_BROWSER_RUN_ID ?? "cc03-local-supabase-1";
  const screenshots: Array<{ path: string; testedSha: string; runId: string }> = [];
  const runtimeErrors: string[] = [];
  const failures: Array<{ path: string; error: string | undefined }> = [];
  const navigationAborts: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const pathname = new URL(request.url()).pathname;
    const error = request.failure()?.errorText;
    if (error === "net::ERR_ABORTED" && (pathname === "/en/login" || pathname.startsWith("/__nextjs_font/"))) navigationAborts.push(pathname);
    else failures.push({ path: pathname, error });
  });
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  let cleaned = false;
  try {
    const owner = await fixtures.actor("batch-owner", { username: "cc_batch_artist" });
    const moderator = await fixtures.actor("batch-admin", { admin: true });
    const book = await fixtures.product("Quiet Garden Coloring Book");
    const locked = await fixtures.product("Locked Fixture Book");
    const archived = await fixtures.product("Archived Fixture Book", "archived");
    await fixtures.unlock(owner.id, book.id);
    await fixtures.unlock(owner.id, archived.id);
    await fixtures.login(page, owner);
    await expect(page.getByRole("heading", { name: "My Creations", exact: true })).toBeVisible();
    const form = page.getByTestId("community-upload-form");
    if (!await form.isVisible()) await page.getByRole("button", { name: "Share your art", exact: true }).click();
    await expect(form).toBeVisible();
    const selector = page.getByTestId("community-product-select");
    await expect(selector.locator("option", { hasText: book.title })).toHaveCount(1);
    await expect(selector.locator(`option[value="${locked.id}"]`)).toHaveCount(0);
    await expect(selector.locator(`option[value="${archived.id}"]`)).toHaveCount(0);
    await selector.selectOption(book.id);
    const input = page.getByTestId("community-upload-file-input");
    const pictures = ["rose-fox.webp", "coastal-light.webp", "cottage.webp"].map((file) => path.resolve("docs/design/coloring-club/assets", file));
    await input.setInputFiles([...pictures, pictures[0]]);
    await expect(page.getByRole("alert").filter({ hasText: "Choose up to three" })).toContainText("three");
    await expect(page.getByTestId("community-selected-artwork")).toHaveCount(0);
    await input.setInputFiles(pictures);
    const previews = page.getByTestId("community-selected-artwork");
    await expect(previews).toHaveCount(3);
    const descriptions = ["Rose garden afternoon", "Quiet coastal colours", "A peaceful cottage"];
    for (let index = 0; index < 3; index++) {
      await previews.nth(index).getByRole("textbox").fill(descriptions[index]);
      await expect(previews.nth(index).locator("img")).toBeVisible();
    }
    await expect(page.getByTestId("community-upload-submit")).toBeDisabled();
    await page.getByTestId("community-upload-rules").check();
    screenshots.push(...await communityScreenshots(page, "cc03", "upload-previews", runId));
    await page.getByTestId("community-upload-submit").click();
    await expect(page.getByRole("status").filter({ hasText: "artworks were sent" })).toContainText("3 artworks were sent for review");
    await expect(previews).toHaveCount(0);
    const cards = page.getByTestId("community-artwork-card");
    await expect(cards).toHaveCount(3);
    await readyArtworkPreviews(page);
    await page.reload();
    await expect(cards).toHaveCount(3);
    const rows = await fixtures.service.from("community_artworks").select("id,description,status,revision").eq("author_id", owner.id);
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(3);
    expect(rows.data?.map((item) => item.description).sort()).toEqual([...descriptions].sort());
    expect(rows.data?.every((item) => item.status === "pending" && item.revision === 1)).toBe(true);
    await readyArtworkPreviews(page);
    screenshots.push(...await communityScreenshots(page, "cc03", "my-creations-pending", runId));
    const rose = rows.data!.find((item) => item.description === descriptions[0])!;
    const coast = rows.data!.find((item) => item.description === descriptions[1])!;
    const cottage = rows.data!.find((item) => item.description === descriptions[2])!;
    for (const [id, action, revision, reason] of [
      [rose.id, "approve", 1, null], [coast.id, "reject", 1, "Please share your own finished colouring."],
      [cottage.id, "approve", 1, null], [cottage.id, "remove", 2, "Please remove identifying information."],
    ] as const) {
      expect((await fixtures.service.rpc("community_moderate_artwork", { p_actor_user_id: moderator.id,
        p_artwork_id: id, p_expected_revision: revision, p_action: action, p_reason: reason })).error).toBeNull();
    }
    await page.reload();
    await expect(cards).toHaveCount(3);
    await expect(page.getByText("Please share your own finished colouring.", { exact: true })).toBeVisible();
    await expect(page.getByText("Please remove identifying information.", { exact: true })).toBeVisible();
    await readyArtworkPreviews(page);
    screenshots.push(...await communityScreenshots(page, "cc03", "my-creations-reviewed", runId));
    const published = cards.filter({ hasText: "Published" });
    await published.getByTestId("community-artwork-edit-description").click();
    await published.getByTestId("community-artwork-description").fill("A revised rose garden afternoon");
    await published.getByTestId("community-artwork-save-description").click();
    await expect(page.getByRole("status").filter({ hasText: "pending review again" })).toContainText("pending review again");
    expect((await fixtures.service.from("community_artworks").select("status,revision").eq("id", rose.id).single()).data).toMatchObject({ status: "pending", revision: 3 });
    const removed = cards.filter({ hasText: "Removed" });
    await removed.getByTestId("community-artwork-delete").click();
    await expect(removed.getByRole("group", { name: "Confirm artwork deletion" })).toBeVisible();
    screenshots.push(...await communityScreenshots(page, "cc03", "delete-confirmation", runId));
    await removed.getByTestId("community-artwork-confirm-delete").click();
    await expect(cards).toHaveCount(2);
    await page.reload();
    await expect(cards).toHaveCount(2);
    await readyArtworkPreviews(page);
    expect(runtimeErrors).toEqual([]);
    expect(failures).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } finally {
    try {
      await fixtures.cleanup();
      cleaned = true;
    } finally {
      await mkdir("docs/verification/issue-77/cc03", { recursive: true });
      await writeFile("docs/verification/issue-77/cc03/browser-run.json", `${JSON.stringify({ runId, screenshots,
        viewports: [390, 768, 1440], backend: "isolated real Supabase/Auth/Storage", runtimeErrors,
        networkFailures: failures, navigationAborts, consoleErrors, fixtureCleanup: cleaned }, null, 2)}\n`);
    }
  }
});

test("authorized maintenance drains a real queued deletion without another owner visit", async ({ page }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_UPLOADS_E2E !== "1" || testInfo.project.name !== "chromium",
    "Requires the isolated local application and private local cron credential.");
  test.setTimeout(120_000);
  const fixtures = await communityFixtures(testInfo);
  try {
    const owner = await fixtures.actor("scheduler-owner", { username: "cc_scheduler_artist" });
    const book = await fixtures.product("Scheduled Cleanup Fixture Book");
    await fixtures.unlock(owner.id, book.id);
    await fixtures.login(page, owner);
    const image = await sharp({ create: { width: 120, height: 160, channels: 3, background: "#8b9c87" } }).webp().toBuffer();
    const key = randomUUID();
    const uploaded = await page.request.post(`${COMMUNITY_TEST_ORIGIN}/api/community/artworks`, {
      headers: { Origin: COMMUNITY_TEST_ORIGIN }, multipart: {
        file: { name: "cleanup.webp", mimeType: "image/webp", buffer: image }, productId: book.id,
        description: "Scheduled physical deletion fixture", idempotencyKey: key, rulesAccepted: "true",
      },
    });
    expect([200, 201]).toContain(uploaded.status());
    const artwork = (await uploaded.json()).artwork;
    const storagePath = `community/${owner.id}/${key}`;
    expect((await fixtures.service.storage.from("collection-media").download(storagePath)).data).toBeTruthy();
    expect((await fixtures.service.rpc("community_delete_artwork", { p_actor_user_id: owner.id,
      p_artwork_id: artwork.id, p_expected_revision: 1 })).error).toBeNull();
    expect((await page.request.get(`${COMMUNITY_TEST_ORIGIN}/api/community/artworks/${artwork.id}/media`)).status()).toBe(404);
    // Simulate time passing only on this fixture's queue lease. No other jobs
    // or accounts are modified; the stored object remains for maintenance.
    expect((await fixtures.service.from("community_upload_reservations").update({ cleanup_expires_at: "2020-01-01T00:00:00Z" })
      .eq("author_id", owner.id).eq("idempotency_key", key)).error).toBeNull();
    const endpoint = `${COMMUNITY_TEST_ORIGIN}/api/internal/community/cleanup`;
    expect((await page.request.get(endpoint)).status()).toBe(401);
    expect((await page.request.get(endpoint, { headers: { Authorization: "Bearer invalid-fixture-token" } })).status()).toBe(401);
    expect((await fixtures.service.storage.from("collection-media").download(storagePath)).data).toBeTruthy();
    const secret = (await readFile("/tmp/lamilia-p0-preflight/community-cron-secret", "utf8")).trim();
    const cleaned = await page.request.get(endpoint, { headers: { Authorization: `Bearer ${secret}` } });
    expect(cleaned.status()).toBe(200);
    expect(await cleaned.json()).toEqual({ ok: true, passes: 10 });
    expect((await fixtures.service.storage.from("collection-media").download(storagePath)).error).toBeTruthy();
    expect((await fixtures.service.from("community_upload_reservations").select("state").eq("author_id", owner.id)
      .eq("idempotency_key", key).single()).data?.state).toBe("cleaned");
  } finally {
    await fixtures.cleanup();
  }
});

test("keyboard drawer state and a dropped successful response recover without a duplicate artwork", async ({ page }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_UPLOADS_E2E !== "1" || testInfo.project.name !== "chromium",
    "Requires the isolated real Supabase upload application.");
  test.setTimeout(120_000);
  page.setDefaultTimeout(12_000);
  const fixtures = await communityFixtures(testInfo);
  let intercepted = false;
  try {
    const owner = await fixtures.actor("retry-owner", { username: "cc_retry_artist" });
    const book = await fixtures.product("Retry Fixture Book");
    await fixtures.unlock(owner.id, book.id);
    await fixtures.login(page, owner);
    const trigger = page.getByTestId("community-upload-open");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Share your art", exact: true });
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await page.getByTestId("community-product-select").selectOption(book.id);
    await page.getByTestId("community-upload-file-input").setInputFiles([
      path.resolve("docs/design/coloring-club/assets/rose-fox.webp"),
      path.resolve("docs/design/coloring-club/assets/cottage.webp"),
    ]);
    await page.getByTestId("community-selected-artwork").first().getByRole("textbox").fill("Preserved across a lost response");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-slot="admin-drawer"]')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await expect(page.getByTestId("community-selected-artwork")).toHaveCount(2);
    await expect(page.getByTestId("community-selected-artwork").first().getByRole("textbox")).toHaveValue("Preserved across a lost response");
    await page.getByTestId("community-upload-rules").check();
    // The real server commits. Only the first response to the browser is lost,
    // exercising the advertised stable-key recovery rather than a fake backend.
    await page.route("**/api/community/artworks", async (route) => {
      const response = await route.fetch();
      if (!intercepted) {
        intercepted = true;
        expect([200, 201]).toContain(response.status());
        await route.abort("failed");
      } else await route.fulfill({ response });
    });
    await page.getByTestId("community-upload-submit").click();
    await expect(page.getByTestId("community-artwork-retry")).toBeVisible();
    await expect(dialog).toBeVisible();
    expect((await fixtures.service.from("community_artworks").select("id", { count: "exact" }).eq("author_id", owner.id)).count).toBe(2);
    await expect(page.getByTestId("community-selected-artwork")).toHaveCount(1);
    await expect(page.getByTestId("community-selected-artwork").getByRole("textbox")).toBeDisabled();
    await page.getByTestId("community-artwork-retry").click();
    await expect(page.getByTestId("community-selected-artwork")).toHaveCount(0);
    expect((await fixtures.service.from("community_artworks").select("id", { count: "exact" }).eq("author_id", owner.id)).count).toBe(2);
    if (await dialog.isVisible()) await page.keyboard.press("Escape");
    await expect(page.locator('[data-slot="admin-drawer"]')).toHaveCount(0);
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(2);
    await page.reload();
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(2);
  } finally {
    await page.unroute("**/api/community/artworks");
    await fixtures.cleanup();
  }
});
