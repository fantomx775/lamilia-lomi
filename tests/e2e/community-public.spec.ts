import { devices, expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { communityArtifactPath, communityHtmlCheck, communityFixtures, communityScreenshots, essentials, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });
const origin = COMMUNITY_TEST_ORIGIN;
type Fixtures = Awaited<ReturnType<typeof communityFixtures>>;
const photos = ["rose-fox.webp", "flower-kitten.webp", "bunny-garden.webp"];

// This slice tests public reads. Upload validation/reservation/quotas are exercised
// separately in community-uploads.spec.ts. Controlled pending records and real
// private bytes are seeded here; approval still uses the actual database RPC.
async function artwork(fixtures: Fixtures, authorId: string, productId: string, moderatorId: string,
  description: string, index = 0, state: "approved" | "pending" | "rejected" | "removed" = "approved") {
  expect(fixtures.users).toContain(authorId);
  expect(fixtures.products).toContain(productId);
  const bytes = await readFile(path.resolve("docs/design/coloring-club/assets", photos[index % photos.length]));
  const id = randomUUID();
  const storagePath = `community/${authorId}/${randomUUID()}`;
  expect((await fixtures.service.storage.from("collection-media").upload(storagePath, bytes, { contentType: "image/webp", upsert: false })).error).toBeNull();
  expect((await fixtures.service.from("community_artworks").insert({ id, author_id: authorId, product_id: productId,
    storage_path: storagePath, storage_provider: "supabase", content_type: "image/webp", size_bytes: bytes.length,
    description, status: "pending" })).error).toBeNull();
  if (state !== "pending") {
    expect((await fixtures.service.rpc("community_moderate_artwork", { p_actor_user_id: moderatorId, p_artwork_id: id,
      p_expected_revision: 1, p_action: state === "rejected" ? "reject" : "approve",
      p_reason: state === "rejected" ? "Private rejection fixture reason" : null })).error).toBeNull();
    if (state === "removed") {
      expect((await fixtures.service.rpc("community_moderate_artwork", { p_actor_user_id: moderatorId, p_artwork_id: id,
        p_expected_revision: 2, p_action: "remove", p_reason: "Private removal fixture reason" })).error).toBeNull();
    }
  }
  return { id, storagePath, description };
}

function enabled(testInfo: { project: { name: string } }) {
  test.skip(process.env.RUN_COMMUNITY_PUBLIC_E2E !== "1" || testInfo.project.name !== "chromium",
    "Requires explicitly isolated real Supabase/Auth/Storage with both community flags ON.");
}

async function loadedImages(page: Page, selector: string) {
  const images = page.locator(selector);
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
}

test("public read model uses stable microsecond keysets and hides all ineligible artwork", async ({ page, browser }, testInfo) => {
  enabled(testInfo);
  test.setTimeout(180_000);
  const fixtures = await communityFixtures(testInfo);
  try {
    const owner = await fixtures.actor("public-reader", { username: "cc_public_reader" });
    const moderator = await fixtures.actor("public-moderator", { admin: true });
    const book = await fixtures.product("Public Garden Book");
    const kids = await fixtures.product("Public Kids Book");
    expect((await fixtures.service.from("products").update({ audience: "kids" }).eq("id", kids.id)).error).toBeNull();
    const archived = await fixtures.product("Archived Gallery Book");
    for (const product of [book, kids, archived]) await fixtures.unlock(owner.id, product.id);
    const approved = [];
    for (let index = 0; index < 5; index++) {
      const art = await artwork(fixtures, owner.id, book.id, moderator.id, `Public garden ${index + 1}`, index);
      // Fixed controlled fixture timestamps test sub-millisecond ordering, after
      // the real approval RPC has established a valid publication state.
      expect((await fixtures.service.from("community_artworks").update({ published_at: `2026-10-25T10:00:00.12345${index}Z` }).eq("id", art.id)).error).toBeNull();
      approved.push(art);
    }
    const kidsArt = await artwork(fixtures, owner.id, kids.id, moderator.id, "Kids garden", 1);
    const hidden = [];
    for (const state of ["pending", "rejected", "removed"] as const) hidden.push(await artwork(fixtures, owner.id, book.id, moderator.id, `Private ${state} garden`, 2, state));
    hidden.push(await artwork(fixtures, owner.id, archived.id, moderator.id, "Archived private garden"));
    expect((await fixtures.service.from("products").update({ status: "archived" }).eq("id", archived.id)).error).toBeNull();

    let cursor: string | null = null;
    const seen: string[] = [];
    for (let index = 0; index < 3; index++) {
      const query = new URLSearchParams({ productId: book.id, limit: "2", sort: "latest" });
      if (cursor) query.set("cursor", cursor);
      const response = await page.request.get(`${origin}/api/community/artworks?${query}`);
      expect(response.status()).toBe(200);
      const payload = await response.json();
      expect(payload.ok).toBe(true);
      seen.push(...payload.items.map((item: { id: string }) => item.id));
      cursor = payload.nextCursor;
      const serialized = JSON.stringify(payload);
      for (const privateValue of [owner.id, owner.email, moderator.id, ...hidden.map((item) => item.id),
        ...approved.map((item) => item.storagePath), "Private rejection fixture reason", "Private removal fixture reason"]) {
        expect(serialized).not.toContain(privateValue);
      }
    }
    expect(cursor).toBeNull();
    expect(seen).toEqual(approved.toReversed().map((item) => item.id));
    const kidsResponse = await page.request.get(`${origin}/api/community/artworks?audience=kids&productId=${kids.id}`);
    expect(kidsResponse.status()).toBe(200);
    expect((await kidsResponse.json()).items.map((item: { id: string }) => item.id)).toEqual([kidsArt.id]);
    for (const query of ["limit=0", "limit=49", "limit=1.5", "cursor=garbage", "productId=bogus", "audience=unknown", "sort=bogus"]) {
      expect((await page.request.get(`${origin}/api/community/artworks?${query}`)).status()).toBe(400);
    }
    for (const item of hidden) {
      const response = await page.request.get(`${origin}/en/club/artworks/${item.id}`);
      expect(response.status()).toBe(404);
      expect(await response.text()).toContain('name="robots" content="noindex');
      expect((await page.request.get(`${origin}/api/community/artworks/${item.id}/media`)).status()).toBe(404);
    }
    const creatorHtml = await page.request.get(`${origin}/en/club/creators/cc_public_reader`);
    expect(creatorHtml.status()).toBe(200);
    const creatorBody = await creatorHtml.text();
    for (const privateValue of [owner.id, owner.email, ...hidden.map((item) => item.storagePath), "Private rejection fixture reason"]) {
      expect(creatorBody).not.toContain(privateValue);
    }
    const sitemap = await page.request.get(`${origin}/sitemap.xml`);
    expect(sitemap.status()).toBe(200);
    const sitemapText = await sitemap.text();
    for (const item of approved) expect(sitemapText).toContain(`/en/club/artworks/${item.id}`);
    for (const item of hidden) expect(sitemapText).not.toContain(`/en/club/artworks/${item.id}`);
    const photo = await page.request.get(`${origin}/api/community/artworks/${approved[0].id}/media`);
    expect(photo.status()).toBe(200);
    expect(photo.headers()["cache-control"]).toBe("private, no-store");
    expect(photo.headers()["content-type"]).toContain("image/webp");

    const ownerPage = await fixtures.newPage(browser);
    await fixtures.login(ownerPage, owner, "/en/account");
    expect((await ownerPage.request.get(`${origin}/api/community/artworks/${hidden[0].id}/media`)).status()).toBe(200);
    expect((await ownerPage.request.get(`${origin}/en/club/artworks/${hidden[0].id}`)).status()).toBe(404);
    expect((await fixtures.service.from("community_profiles").update({ suspended_at: new Date().toISOString() }).eq("user_id", owner.id)).error).toBeNull();
    expect((await page.request.get(`${origin}/en/club/creators/cc_public_reader`)).status()).toBe(404);
    expect((await page.request.get(`${origin}/api/community/artworks/${approved[0].id}/media`)).status()).toBe(404);
    expect((await page.request.get(`${origin}/api/community/artworks?productId=${book.id}`).then((r) => r.json())).items).toEqual([]);
    expect((await fixtures.service.from("community_profiles").update({ suspended_at: null, participation_revoked_at: new Date().toISOString() }).eq("user_id", owner.id)).error).toBeNull();
    expect((await page.request.get(`${origin}/en/club/artworks/${approved[0].id}`)).status()).toBe(404);
  } finally {
    await fixtures.cleanup();
  }
});

test("anonymous gallery navigation and mixed PDP preserve real photos and the original lightbox", async ({ page, browser }, testInfo) => {
  enabled(testInfo);
  test.setTimeout(240_000);
  const fixtures = await communityFixtures(testInfo);
  const runId = process.env.COMMUNITY_BROWSER_RUN_ID ?? "cc05-local-supabase-1";
  const screenshots: { path: string; testedSha: string; runId: string }[] = [];
  const runtimeErrors: string[] = [];
  const consoleErrors: string[] = [];
  const transportFailures: string[] = [];
  let touchEvidence: { type: string; at: number; target?: string; open: boolean }[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") transportFailures.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`);
  });
  try {
    const owner = await fixtures.actor("gallery-artist", { username: "cc_gallery_artist" });
    const second = await fixtures.actor("gallery-pages", { username: "cc_gallery_pages" });
    const locked = await fixtures.actor("gallery-locked", { username: "cc_gallery_visitor" });
    const moderator = await fixtures.actor("gallery-admin", { admin: true });
    const book = await fixtures.product("Garden Coloring Collection");
    const paged = await fixtures.product("Little Garden Collection");
    const empty = await fixtures.product("A New Coloring Story");
    expect((await fixtures.service.from("products").update({ audience: "kids" }).eq("id", paged.id)).error).toBeNull();
    await fixtures.unlock(owner.id, book.id);
    await fixtures.unlock(second.id, paged.id);
    for (const id of [owner.id, second.id, locked.id]) {
      expect((await fixtures.service.from("community_profiles").update({ avatar_seed: "11111111-1111-4111-8111-111111111111" }).eq("user_id", id)).error).toBeNull();
    }
    const gallery = [];
    for (let index = 0; index < 3; index++) gallery.push(await artwork(fixtures, owner.id, book.id, moderator.id,
      ["A rose-colored woodland friend", "A kitten among the flowers", "A quiet moment in the garden"][index], index));
    for (let index = 0; index < 25; index++) await artwork(fixtures, second.id, paged.id, moderator.id, `Little garden creation ${index + 1}`, index);
    for (const [index, item] of gallery.entries()) {
      expect((await fixtures.service.from("community_artworks").update({ published_at: `2026-10-25T10:00:00.12345${index}Z` }).eq("id", item.id)).error).toBeNull();
    }
    await fixtures.readerArtwork(book.id, "Reader Rose", 1, "floral-portrait.webp");
    await fixtures.readerArtwork(book.id, "Reader Garden", 0, "cottage.webp");
    const insidePaths = ["/assets/gallery/moon-garden-page-1.svg", "/assets/gallery/moon-garden-page-2.svg"];
    expect((await fixtures.service.from("product_assets").insert(insidePaths.map((assetPath, index) => ({
      id: randomUUID(), product_id: book.id, kind: "gallery", bucket: "public-media", path: assetPath,
      filename: assetPath.split("/").at(-1), content_type: "image/svg+xml", is_public: true, sort_order: index,
      title: `Original uncolored page ${index + 1}`,
    })))).error).toBeNull();

    await page.goto(`${origin}/en/club?productId=${book.id}`);
    await essentials(page);
    await expect(page.getByTestId("community-gallery-product-filter")).toHaveValue(book.id);
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(3);
    await loadedImages(page, '[data-testid="community-artwork-grid"] img');
    screenshots.push(...await communityScreenshots(page, "cc05", "gallery-filtered", runId));

    await page.getByTestId("community-gallery-product-filter").selectOption(paged.id);
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(24);
    await page.getByTestId("community-gallery-load-more").click();
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(25);
    await expect(page.getByTestId("community-gallery-load-more")).toHaveCount(0);
    const uniqueLinks = await page.locator('[data-testid="community-artwork-card"] a[href^="/en/club/artworks/"]').evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(new Set(uniqueLinks).size).toBe(25);
    await page.getByTestId("community-gallery-audience-filter").selectOption("adults");
    await expect(page.getByTestId("community-gallery-empty-state")).toBeVisible();
    await page.getByTestId("community-gallery-audience-filter").selectOption("");
    await page.getByTestId("community-gallery-product-filter").selectOption(empty.id);
    await expect(page.getByTestId("community-gallery-empty-state")).toBeVisible();
    screenshots.push(...await communityScreenshots(page, "cc05", "gallery-empty", runId));
    await page.getByTestId("community-gallery-product-filter").selectOption(book.id);
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(3);
    await page.locator(`[data-testid="community-artwork-card"] a[href="/en/club/artworks/${gallery[0].id}"]`).click();
    await expect(page.getByTestId("community-artwork-detail")).toBeVisible();
    await loadedImages(page, '[data-testid="community-artwork-media"]');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${origin}/en/club/artworks/${gallery[0].id}`);
    await expect(page.getByTestId("community-artwork-book")).toContainText(book.title);
    screenshots.push(...await communityScreenshots(page, "cc05", "artwork-detail", runId));
    await page.getByTestId("community-artwork-creator").click();
    await expect(page.getByRole("heading", { name: "@cc_gallery_artist", exact: true })).toBeVisible();
    await expect(page.getByTestId("community-creator-page").locator("ul > li")).toHaveCount(3);
    await loadedImages(page, '[data-testid="community-creator-page"] img');
    expect(await page.getByTestId("community-creator-page").innerText()).not.toContain(owner.email);
    screenshots.push(...await communityScreenshots(page, "cc05", "creator-photos", runId));

    await page.goto(`${origin}/en/products/${empty.slug}`);
    await expect(page.getByRole("heading", { name: "Colored by Our Readers", exact: true })).toHaveCount(1);
    await expect(page.getByTestId("colored-by-our-readers-empty")).toBeVisible();
    await expect(page.getByTestId("reader-artwork-grid")).toHaveCount(0);
    screenshots.push(...await communityScreenshots(page, "cc05", "product-empty-gallery", runId));

    await page.goto(`${origin}/en/products/${book.slug}`);
    await expect(page.getByRole("heading", { name: "Colored by Our Readers", exact: true })).toHaveCount(1);
    const readerGrid = page.getByTestId("reader-artwork-grid");
    await expect(readerGrid).toHaveCount(1);
    await expect(readerGrid.locator("figure")).toHaveCount(4);
    await expect(readerGrid.locator("figure").nth(0)).toContainText("Reader Garden");
    await expect(readerGrid.locator("figure").nth(1)).toContainText("Reader Rose");
    await loadedImages(page, '[data-testid="reader-artwork-grid"] img');
    const inside = page.getByTestId("product-media-layout");
    await expect(inside.locator("img")).toHaveCount(2);
    expect(await inside.locator("img").evaluateAll((images) => images.map((image) => {
      const url = new URL((image as HTMLImageElement).src);
      return url.searchParams.get("url") ?? url.pathname;
    }))).toEqual(insidePaths);
    const originalButton = readerGrid.locator("button").first();
    await originalButton.click();
    const dialog = page.getByRole("dialog", { name: "Reader artwork preview", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Reader Garden");
    await page.keyboard.press("ArrowRight");
    await expect(dialog).toContainText("Reader Rose");
    await page.keyboard.press("ArrowRight");
    await expect(dialog).toContainText("cc_gallery_artist");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(originalButton).toBeFocused();
    screenshots.push(...await communityScreenshots(page, "cc05", "product-mixed-gallery", runId));
    await page.getByTestId("community-share-guest").click();
    await expect(page).toHaveURL(/\/en\/login\?returnTo=/);
    const returnTo = new URL(page.url()).searchParams.get("returnTo");
    expect(returnTo).toBe(`/en/library/creations?productId=${book.id}`);

    // Public browsing never depends on the visitor's unlocks. Submission does.
    const lockedPage = await fixtures.newPage(browser);
    await fixtures.login(lockedPage, locked, `/en/products/${book.slug}`, `/en/products/${book.slug}#premium`);
    await expect(lockedPage.getByTestId("community-share-locked")).toBeVisible();
    await expect(lockedPage.getByTestId("reader-artwork-grid")).toBeVisible();
    const ownerPage = await fixtures.newPage(browser);
    await fixtures.login(ownerPage, owner, `/en/products/${book.slug}`, `/en/products/${book.slug}#premium`);
    await expect(ownerPage.getByRole("link", { name: "Share your art", exact: true })).toBeVisible();
    await ownerPage.getByRole("link", { name: "Share your art", exact: true }).click();
    await expect(ownerPage).toHaveURL(/\/en\/library\/creations/);
    const phone = await fixtures.newPage(browser, { ...devices["Pixel 7"] });
    phone.on("pageerror", (error) => runtimeErrors.push(error.message));
    phone.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    phone.on("requestfailed", (request) => {
      if (request.failure()?.errorText !== "net::ERR_ABORTED") transportFailures.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`);
    });
    await phone.goto(`${origin}/en/club?productId=${book.id}`);
    await essentials(phone);
    await expect(phone.getByTestId("community-artwork-card")).toHaveCount(3);
    await phone.locator('[data-testid="community-artwork-card"] a[href^="/en/club/artworks/"]').first().tap();
    await expect(phone.getByTestId("community-artwork-detail")).toBeVisible();
    await phone.getByTestId("community-artwork-creator").tap();
    await expect(phone.getByTestId("community-creator-page")).toBeVisible();
    await phone.goto(`${origin}/en/products/${book.slug}`);
    await phone.getByTestId("reader-artwork-grid").locator("button").first().tap();
    const phonePreview = phone.getByRole("dialog", { name: "Reader artwork preview", exact: true });
    await expect(phonePreview).toBeVisible();
    await expect(phonePreview).toContainText("Reader Garden");
    await phonePreview.getByRole("button", { name: "Close preview", exact: true }).tap();
    await expect(phonePreview).not.toBeVisible();
    await phone.getByTestId("reader-artwork-grid").locator("button").first().tap();
    await expect(phonePreview).toBeVisible();
    const touch = await phone.context().newCDPSession(phone);
    await phone.evaluate(() => {
      const records: object[] = [];
      Reflect.set(window, "__communityTouchEvents", records);
      for (const type of ["pointerdown", "pointerup", "pointercancel", "touchstart", "touchend", "mousedown", "mouseup", "click", "close"]) {
        document.addEventListener(type, (event) => {
          records.push({ type, at: event.timeStamp, trusted: event.isTrusted, target: (event.target as Element)?.outerHTML?.slice(0, 140),
            open: document.querySelector('dialog[open]') !== null });
        }, true);
      }
    });
    const frame = await phonePreview.getByTestId("product-gallery-preview-frame").boundingBox();
    if (!frame) throw new Error("Missing actual touch preview frame.");
    const y = frame.y + frame.height / 2;
    // Chromium's supported touch gesture pipeline completes the touch sequence
    // without injecting momentum that suppresses the next tap after raw input.
    await touch.send("Input.synthesizeScrollGesture", { x: frame.x + frame.width * 0.8, y,
      xDistance: -frame.width * 0.6, yDistance: 0, speed: 600, preventFling: true, gestureSourceType: "touch" });
    await expect(phonePreview).toContainText("Reader Rose");
    await phonePreview.getByRole("button", { name: "Close preview", exact: true }).tap();
    const touchEvents = await phone.evaluate(() => Reflect.get(window, "__communityTouchEvents"));
    await expect(phonePreview, JSON.stringify(touchEvents)).not.toBeVisible();
    await expect.poll(() => phone.evaluate(() => Reflect.get(window, "__communityTouchEvents").some((event: { type: string }) => event.type === "close"))).toBe(true);
    touchEvidence = await phone.evaluate(() => Reflect.get(window, "__communityTouchEvents"));
    expect(touchEvidence.filter((event) => event.type === "touchend")).toHaveLength(2);
    expect(touchEvidence.some((event) => event.type === "click")).toBe(true);
    await touch.detach();
    expect(runtimeErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(transportFailures).toEqual([]);
    const checks = [
      await communityHtmlCheck(page.request, "/en/club", 200, "Coloring, shared with care"),
      await communityHtmlCheck(page.request, `/en/club/artworks/${gallery[0].id}`, 200, "A rose-colored woodland friend"),
      await communityHtmlCheck(page.request, "/en/club/creators/cc_gallery_artist", 200, "@cc_gallery_artist"),
    ];
    await writeFile(await communityArtifactPath("cc05", "public-on-proof.json"), JSON.stringify({
      status: "PASS", testedSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      runId, publicEnabled: true,
      command: "LAMILIA_BACKEND=supabase PLAYWRIGHT_BASE_URL=https://127.0.0.1:3443 RUN_COMMUNITY_PUBLIC_E2E=1 npx playwright test tests/e2e/community-public.spec.ts --project=chromium --workers=1",
      checks,
    }, null, 2));
  } finally {
    await fixtures.cleanup();
  }
  await mkdir(path.resolve("docs/verification/issue-77/cc05"), { recursive: true });
  await writeFile(await communityArtifactPath("cc05"), JSON.stringify({
    runId, screenshots, viewports: [390, 768, 1440], backend: "isolated real Supabase/Auth/Storage",
    runtimeErrors, consoleErrors, transportFailures, fixtureCleanup: true,
    mobileTouch: { device: "emulated Pixel 7", gesture: "CDP touch-source synthesizeScrollGesture with preventFling, followed by locator touchscreen tap-close", events: touchEvidence },
  }, null, 2) + "\n");
});
