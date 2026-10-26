import { devices, expect, test, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { communityArtifactPath, communityFixtures, communityScreenshots, essentials, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });
const origin = COMMUNITY_TEST_ORIGIN;
type Fixtures = Awaited<ReturnType<typeof communityFixtures>>;
const endpoint = (id: string) => `${origin}/api/community/artworks/${id}/heart`;

async function upload(page: Page, productId: string, index: number) {
  const files = ["rose-fox.webp", "flower-kitten.webp", "bunny-garden.webp"];
  const file = files[index % files.length];
  const response = await page.request.post(`${origin}/api/community/artworks`, { headers: { Origin: origin }, multipart: {
    file: { name: file, mimeType: "image/webp", buffer: await readFile(path.resolve("docs/design/coloring-club/assets", file)) },
    productId, description: ["A rose-colored woodland friend", "A kitten among the flowers", "A quiet garden moment"][index % 3],
    idempotencyKey: randomUUID(), rulesAccepted: "true",
  } });
  expect([200, 201]).toContain(response.status());
  return (await response.json()).artwork as { id: string; revision: number };
}

async function setLike(page: Page, id: string, liked: boolean) {
  return liked
    ? page.request.put(endpoint(id), { headers: { Origin: origin } })
    : page.request.delete(endpoint(id), { headers: { Origin: origin } });
}

async function approve(fixtures: Fixtures, moderatorId: string, artwork: { id: string; revision: number }) {
  expect((await fixtures.service.rpc("community_moderate_artwork", { p_actor_user_id: moderatorId,
    p_artwork_id: artwork.id, p_expected_revision: artwork.revision, p_action: "approve", p_reason: null })).error).toBeNull();
}

function enabled(testInfo: { project: { name: string } }) {
  test.skip(process.env.RUN_COMMUNITY_HEARTS_E2E !== "1" || testInfo.project.name !== "chromium",
    "Requires the isolated HTTPS Supabase app with both community flags ON and the heart migration.");
}

test("real heart intents are unique, atomic, private, eligibility-gated and independent of unlocks", async ({ page, browser }, testInfo) => {
  enabled(testInfo);
  test.setTimeout(180_000);
  page.setDefaultTimeout(12_000);
  const fixtures = await communityFixtures(testInfo);
  try {
    const owner = await fixtures.actor("hearts-api-owner", { username: "cc_heart_api_artist" });
    const member = await fixtures.actor("hearts-api-member", { username: "cc_heart_api_member" });
    const other = await fixtures.actor("hearts-api-other", { username: "cc_heart_api_other" });
    const nonmember = await fixtures.actor("hearts-api-nonmember");
    const unverified = await fixtures.actor("hearts-api-unverified");
    const suspended = await fixtures.actor("hearts-api-suspended", { username: "cc_heart_api_suspended" });
    const moderator = await fixtures.actor("hearts-api-admin", { admin: true });
    const book = await fixtures.product("Heart Garden Book");
    await fixtures.unlock(owner.id, book.id);
    expect((await fixtures.service.from("community_profiles").update({ suspended_at: new Date().toISOString() }).eq("user_id", suspended.id)).error).toBeNull();
    const ownerPage = await fixtures.newPage(browser);
    await fixtures.login(ownerPage, owner);
    const first = await upload(ownerPage, book.id, 0);
    const second = await upload(ownerPage, book.id, 1);
    const pending = await upload(ownerPage, book.id, 2);
    await approve(fixtures, moderator.id, first);
    await approve(fixtures, moderator.id, second);
    const before = await fixtures.service.from("community_artworks").select("revision,updated_at").eq("id", first.id).single();
    expect(before.error).toBeNull();
    const memberPage = await fixtures.newPage(browser);
    const otherPage = await fixtures.newPage(browser);
    await fixtures.login(memberPage, member, `/en/club/artworks/${first.id}`);
    await fixtures.login(otherPage, other, `/en/club/artworks/${first.id}`);
    expect((await fixtures.service.from("user_product_unlocks").select("product_id").eq("user_id", member.id)).data).toEqual([]);

    const anonymous = await page.request.get(endpoint(first.id));
    expect(anonymous.status()).toBe(200);
    expect(await anonymous.json()).toMatchObject({ ok: true, liked: false, likesCount: 0 });
    expect(anonymous.headers()["cache-control"]).toBe("private, no-store");
    expect((await setLike(page, first.id, true)).status()).toBe(401);
    expect((await memberPage.request.put(endpoint(first.id))).status()).toBe(403);
    expect((await memberPage.request.put(endpoint(first.id), { headers: { Origin: "https://attacker.example" } })).status()).toBe(403);
    expect((await memberPage.request.put(endpoint(first.id), { headers: { Origin: origin }, data: { userId: owner.id } })).status()).toBe(400);

    const concurrent = await Promise.all(Array.from({ length: 5 }, () => setLike(memberPage, first.id, true)));
    for (const response of concurrent) {
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ liked: true, likesCount: 1 });
    }
    expect((await setLike(otherPage, first.id, true)).status()).toBe(200);
    expect((await memberPage.request.get(endpoint(first.id)).then((response) => response.json()))).toMatchObject({ liked: true, likesCount: 2 });
    const guestState = await page.request.get(endpoint(first.id));
    expect(await guestState.json()).toMatchObject({ liked: false, likesCount: 2 });
    const publicPage = await page.request.get(`${origin}/api/community/artworks?productId=${book.id}`);
    const publicBody = await publicPage.json();
    expect(publicBody.items.find((item: { id: string }) => item.id === first.id)).toMatchObject({ likesCount: 2, likedByMe: false });
    for (const value of [owner.id, member.id, other.id, owner.email, member.email, other.email]) expect(JSON.stringify(publicBody)).not.toContain(value);
    const rows = await fixtures.service.from("community_artwork_likes").select("user_id").eq("artwork_id", first.id);
    expect(rows.data).toHaveLength(2);
    expect((await fixtures.anon.from("community_artwork_likes").select("*")).error?.code).toBe("42501");
    expect((await fixtures.anon.rpc("community_set_artwork_like", { p_actor_user_id: member.id,
      p_artwork_id: first.id, p_liked: true })).error?.code).toBe("42501");

    const firstUnlike = await setLike(memberPage, first.id, false);
    expect(firstUnlike.status()).toBe(200);
    expect(await firstUnlike.json()).toMatchObject({ liked: false, likesCount: 1 });
    const repeatedUnlike = await setLike(memberPage, first.id, false);
    expect(await repeatedUnlike.json()).toMatchObject({ liked: false, likesCount: 1 });
    const mixed = await Promise.all(Array.from({ length: 8 }, (_, index) => setLike(memberPage, first.id, index % 2 === 0)));
    for (const response of mixed) expect(response.status()).toBe(200);
    const aggregate = await fixtures.service.from("community_artworks").select("likes_count,revision,updated_at").eq("id", first.id).single();
    const actual = await fixtures.service.from("community_artwork_likes").select("user_id").eq("artwork_id", first.id);
    expect(aggregate.data?.likes_count).toBe(actual.data?.length);
    expect(aggregate.data?.revision).toBe(before.data?.revision);
    expect(aggregate.data?.updated_at).toBe(before.data?.updated_at);
    expect(await (await setLike(memberPage, first.id, true)).json()).toMatchObject({ liked: true, likesCount: 2 });

    for (const account of [nonmember, unverified, suspended]) {
      const deniedPage = await fixtures.newPage(browser);
      await fixtures.login(deniedPage, account, "/en/account");
      if (account.id === unverified.id) fixtures.setEmailVerified(account.id, false);
      expect((await setLike(deniedPage, first.id, true)).status()).toBe(403);
    }
    expect((await setLike(memberPage, pending.id, true)).status()).toBe(404);
    expect((await memberPage.request.get(endpoint(pending.id))).status()).toBe(404);
    expect((await fixtures.service.rpc("community_moderate_artwork", { p_actor_user_id: moderator.id, p_artwork_id: second.id,
      p_expected_revision: 2, p_action: "remove", p_reason: "Private takedown fixture" })).error).toBeNull();
    expect((await setLike(memberPage, second.id, true)).status()).toBe(404);
    expect((await fixtures.service.from("products").update({ status: "archived" }).eq("id", book.id)).error).toBeNull();
    expect((await setLike(memberPage, first.id, true)).status()).toBe(404);
    expect((await page.request.get(endpoint(first.id))).status()).toBe(404);
    expect((await fixtures.service.from("products").update({ status: "published" }).eq("id", book.id)).error).toBeNull();
    expect((await fixtures.service.from("community_profiles").update({ suspended_at: new Date().toISOString() }).eq("user_id", owner.id)).error).toBeNull();
    expect((await setLike(memberPage, first.id, true)).status()).toBe(404);
    expect((await fixtures.service.from("community_profiles").update({ suspended_at: null }).eq("user_id", owner.id)).error).toBeNull();
    const withdrawal = await memberPage.request.delete(`${origin}/api/community/profile`, { headers: { Origin: origin } });
    expect(withdrawal.status()).toBe(200);
    expect((await setLike(memberPage, first.id, true)).status()).toBe(403);
    expect((await page.request.get(endpoint(first.id)).then((response) => response.json()))).toMatchObject({ liked: false, likesCount: 1 });
    // Prime this fixture account's real persistent quota, rather than issuing a
    // noisy 120-request stress test. Actual HTTP requests consume/deny the boundary.
    const quotaKey = createHash("sha256").update(`artwork-heart:${other.id}`).digest("hex");
    expect((await fixtures.service.from("community_rate_limit_buckets").upsert({ bucket_key: quotaKey,
      window_started_at: new Date().toISOString(), updated_at: new Date().toISOString(), hit_count: 119 })).error).toBeNull();
    const finalAllowed = await setLike(otherPage, first.id, false);
    expect(finalAllowed.status()).toBe(200);
    expect(await finalAllowed.json()).toMatchObject({ liked: false, likesCount: 0 });
    expect((await setLike(otherPage, first.id, true)).status()).toBe(429);
    const anotherSession = await fixtures.newPage(browser);
    await fixtures.login(anotherSession, other, `/en/club/artworks/${first.id}`);
    expect((await setLike(anotherSession, first.id, true)).status()).toBe(429);
    expect((await page.request.get(endpoint(first.id)).then((response) => response.json()))).toMatchObject({ likesCount: 0 });
  } finally {
    try {
      if (fixtures.users.length) {
        const quotaKeys = fixtures.users.map((id) => createHash("sha256").update(`artwork-heart:${id}`).digest("hex"));
        expect((await fixtures.service.from("community_rate_limit_buckets").delete().in("bucket_key", quotaKeys)).error).toBeNull();
      }
    } finally {
      await fixtures.cleanup();
    }
  }
});

test("heart UI rolls back real denial, persists across tabs and renders bounded popular results", async ({ page, browser }, testInfo) => {
  enabled(testInfo);
  test.setTimeout(180_000);
  page.setDefaultTimeout(12_000);
  const fixtures = await communityFixtures(testInfo);
  const runId = process.env.COMMUNITY_BROWSER_RUN_ID ?? "cc06-local-supabase-1";
  const screenshots: { path: string; testedSha: string; runId: string }[] = [];
  const runtimeErrors: string[] = [];
  const transportFailures: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") transportFailures.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`);
  });
  let release = () => {};
  try {
    const owner = await fixtures.actor("hearts-ui-owner", { username: "cc_heart_ui_artist" });
    const member = await fixtures.actor("hearts-ui-member", { username: "cc_heart_ui_member" });
    const other = await fixtures.actor("hearts-ui-other", { username: "cc_heart_ui_other" });
    const moderator = await fixtures.actor("hearts-ui-admin", { admin: true });
    const book = await fixtures.product("Hearts in the Garden");
    await fixtures.unlock(owner.id, book.id);
    const ownerPage = await fixtures.newPage(browser);
    await fixtures.login(ownerPage, owner);
    const artworks = [];
    for (let index = 0; index < 3; index++) {
      const item = await upload(ownerPage, book.id, index);
      await approve(fixtures, moderator.id, item);
      expect((await fixtures.service.from("community_artworks").update({ published_at: `2026-10-25T10:00:00.12345${index}Z` }).eq("id", item.id)).error).toBeNull();
      artworks.push(item);
    }
    await fixtures.readerArtwork(book.id, "Reader Garden", 0, "cottage.webp");
    const first = artworks[0];
    const detailPath = `/en/club/artworks/${first.id}`;
    const selector = `[data-testid="community-heart-control"][data-artwork-id="${first.id}"]`;
    await page.goto(`${origin}${detailPath}`);
    await essentials(page);
    await page.locator(selector).getByRole("link", { name: /Log in to like/ }).click();
    await expect(page).toHaveURL(/\/en\/login\?returnTo=/);
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(detailPath);
    await fixtures.login(page, member, detailPath);
    const control = page.locator(selector);
    const button = control.getByTestId("community-heart-toggle");
    const count = control.getByTestId("community-heart-count");
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(count).toHaveText("0");
    let attempts = 0;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(endpoint(first.id), async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      attempts += 1;
      await held;
      const response = await route.fetch();
      await route.fulfill({ response });
    });
    await button.focus();
    await page.keyboard.press("Space");
    await expect.poll(() => attempts).toBe(1);
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(count).toHaveText("1");
    await page.keyboard.press("Space");
    await page.keyboard.press("Space");
    expect(attempts).toBe(1);
    // The actual server rejects the held request after current Auth verification
    // changes. No fabricated browser failure response is used for rollback.
    fixtures.setEmailVerified(member.id, false);
    release();
    await expect(button).toBeEnabled();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(count).toHaveText("0");
    await expect(control.getByRole("status")).toContainText("Your reaction was not saved");
    screenshots.push(...await communityScreenshots(page, "cc06", "heart-denial-rollback", runId));
    fixtures.setEmailVerified(member.id, true);
    await control.getByRole("button", { name: "Retry saving your reaction", exact: true }).click();
    await expect(button).toBeEnabled();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(count).toHaveText("1");
    await page.unroute(endpoint(first.id));
    screenshots.push(...await communityScreenshots(page, "cc06", "artwork-hearted", runId));

    const secondTab = await fixtures.newPage(browser);
    await fixtures.login(secondTab, member, detailPath);
    const secondControl = secondTab.locator(selector);
    await expect(secondControl.getByTestId("community-heart-toggle")).toHaveAttribute("aria-pressed", "true");
    await secondControl.getByTestId("community-heart-toggle").click();
    await expect(secondControl.getByTestId("community-heart-toggle")).toBeEnabled();
    await expect(secondControl.getByTestId("community-heart-count")).toHaveText("0");
    await page.reload();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(count).toHaveText("0");
    await button.click();
    await expect(button).toBeEnabled();
    for (const item of [first, artworks[1]]) {
      expect((await fixtures.service.rpc("community_set_artwork_like", { p_actor_user_id: other.id,
        p_artwork_id: item.id, p_liked: true })).error).toBeNull();
    }

    await page.goto(`${origin}/en/club?productId=${book.id}`);
    const sortedResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/community/artworks" && url.searchParams.get("sort") === "popular";
    });
    await page.getByTestId("community-gallery-sort").selectOption("popular");
    expect((await sortedResponse).status()).toBe(200);
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(3);
    await expect(page.locator(selector).getByTestId("community-heart-count")).toHaveText("2");
    await expect.poll(() => page.locator('[data-testid="community-artwork-card"] a[href^="/en/club/artworks/"]').evaluateAll((links) => links.map((link) => link.getAttribute("href")?.split("/").at(-1))))
      .toEqual(artworks.map((item) => item.id));
    let cursor: string | null = null;
    const ranked: string[] = [];
    for (let index = 0; index < 3; index++) {
      const query = new URLSearchParams({ sort: "popular", productId: book.id, limit: "1" });
      if (cursor) query.set("cursor", cursor);
      const response = await page.request.get(`${origin}/api/community/artworks?${query}`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      ranked.push(...body.items.map((item: { id: string }) => item.id));
      cursor = body.nextCursor;
    }
    expect(cursor).toBeNull();
    expect(ranked).toEqual(artworks.map((item) => item.id));
    screenshots.push(...await communityScreenshots(page, "cc06", "gallery-popular-hearts", runId));
    await page.goto(`${origin}/en/club/creators/cc_heart_ui_artist`);
    await expect(page.getByTestId("community-heart-control")).toHaveCount(3);
    await expect(page.locator(selector).getByTestId("community-heart-count")).toHaveText("2");
    screenshots.push(...await communityScreenshots(page, "cc06", "creator-hearts", runId));
    await page.goto(`${origin}/en/products/${book.slug}`);
    const readerGrid = page.getByTestId("reader-artwork-grid");
    await expect(readerGrid.locator("figure").first()).toContainText("Reader Garden");
    await expect(readerGrid.locator("figure").first().getByTestId("community-heart-control")).toHaveCount(0);
    await expect(readerGrid.getByTestId("community-heart-control")).toHaveCount(3);
    await expect(readerGrid.locator(selector).getByTestId("community-heart-count")).toHaveText("2");
    screenshots.push(...await communityScreenshots(page, "cc06", "product-community-hearts", runId));

    const phone = await fixtures.newPage(browser, { ...devices["Pixel 7"] });
    await fixtures.login(phone, member, detailPath);
    await phone.locator(selector).getByTestId("community-heart-toggle").tap();
    await expect(phone.locator(selector).getByTestId("community-heart-toggle")).toBeEnabled();
    await expect(phone.locator(selector).getByTestId("community-heart-toggle")).toHaveAttribute("aria-pressed", "false");
    await expect(phone.locator(selector).getByTestId("community-heart-count")).toHaveText("1");
    await phone.reload();
    await expect(phone.locator(selector).getByTestId("community-heart-count")).toHaveText("1");
    expect(runtimeErrors).toEqual([]);
    expect(transportFailures).toEqual([]);
    expect(consoleErrors.filter((message) => !/403 \(Forbidden\)/.test(message))).toEqual([]);
  } finally {
    release();
    try {
      if (!page.isClosed()) await page.unrouteAll({ behavior: "wait" });
    } finally {
      await fixtures.cleanup();
    }
  }
  await mkdir(path.resolve("docs/verification/issue-77/cc06"), { recursive: true });
  await writeFile(await communityArtifactPath("cc06"), JSON.stringify({
    runId, screenshots, viewports: [390, 768, 1440], backend: "isolated real Supabase/Auth/Storage",
    runtimeErrors, transportFailures, consoleErrors, expectedHttpErrors: ["403 current Auth verification intentionally revoked during held optimistic request"],
    fixtureCleanup: true, mobileTouch: "emulated Pixel7 real tap unlike and reload",
  }, null, 2) + "\n");
});
