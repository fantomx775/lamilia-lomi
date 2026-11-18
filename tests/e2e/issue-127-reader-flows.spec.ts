import { expect, test, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { communityFixtures, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";
import { isLocalDemoAppTarget, isLoopbackPlaywrightTarget } from "./local-target";
import { loadIsolatedCommunityTarget } from "../../scripts/testing/isolated-community-target.mjs";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
});

function requireExclusive(info: import("@playwright/test").TestInfo) {
  if (info.config.workers !== 1) throw new Error("UX127 controlled fixtures require --workers=1.");
}
async function capture(page: Page, info: import("@playwright/test").TestInfo, phase: string) {
  await page.screenshot({ path: info.outputPath(`${phase}.png`), animations: "disabled", fullPage: false });
}

/** No test hook or schema/security change: a local transaction owns this lock.
 * Cancellation is limited to readers blocked by this exact transaction PID. */
async function holdReaderTable() {
  const target = loadIsolatedCommunityTarget();
  const args = ["exec", "-i", target.databaseContainerId, "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"];
  const options = { env: { ...process.env, DOCKER_HOST: target.dockerEndpoint, DOCKER_CONTEXT: "" }, windowsHide: true };
  const child = spawn(target.dockerExecutable, args, options);
  let output = "";
  let acquisitionTimer: ReturnType<typeof setTimeout> | undefined;
  const ready = new Promise<number>((resolve, reject) => {
    acquisitionTimer = setTimeout(() => reject(new Error("Fixture reader lock acquisition timed out.")), 15_000);
    child.on("error", () => reject(new Error("The isolated fixture lock process could not start.")));
    child.on("exit", (code) => { if (!output.includes("UX127_LOCK_READY:")) reject(new Error(`Fixture lock exited before acquisition (${code}).`)); });
    child.stdout.on("data", (part) => {
      output += part.toString();
      const found = output.match(/UX127_LOCK_READY:(\d+)/);
      if (found) resolve(Number(found[1]));
    });
    child.stderr.resume();
  });
  child.stdin.on("error", () => undefined);
  child.stdin.write("BEGIN; SET LOCAL statement_timeout = '10s'; SET LOCAL idle_in_transaction_session_timeout = '30s'; LOCK TABLE public.product_reader_artworks IN ACCESS EXCLUSIVE MODE; SELECT 'UX127_LOCK_READY:' || pg_backend_pid();\n");
  let pid: number;
  try { pid = await ready; }
  catch (cause) { child.stdin.end("ROLLBACK;\n"); throw cause; }
  finally { if (acquisitionTimer) clearTimeout(acquisitionTimer); }
  return {
    cancelOwnBlockedReaders() {
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Unsafe fixture blocker PID.");
      const canceled = execFileSync(target.dockerExecutable, args, { ...options, encoding: "utf8", input: `SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid)) AND query ILIKE '%product_reader_artworks%';` });
      expect(canceled.trim().split(/\s+/)).toContain("t");
    },
    async release() {
      if (child.exitCode !== null) return;
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.stdin.end("ROLLBACK;\n");
      await exited;
    },
  };
}

test("F28 rendered public page titles are unique, descriptive and include the brand once", async ({ page }, info) => {
  test.skip(!isLoopbackPlaywrightTarget(info.project.use.baseURL), "Metadata acceptance is scoped to the local application.");
  test.setTimeout(120_000);
  const titles = new Set<string>();
  const pages = [
    ["/en/products", "Books & Coloring Books", false],
    ["/en/contact", "Contact", false],
    ["/en/about", "About", false],
    ["/en/community-guidelines", "Community guidelines", false],
    ["/en/privacy", "Privacy Policy", false],
    ["/en/terms", "Terms", false],
    ["/en/reset-password", "Reset password", true],
    ["/en/login", "Log in", true],
    ["/en/register", "Create account", true],
    ["/en/library", "My Library", true],
    ["/en/account", "Account", true],
  ] as const;
  for (const [url, title, privatePage] of pages) {
    const response = await page.goto(url);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(`${title} | LamiliaLomi`);
    const actual = await page.title();
    expect(actual.match(/LamiliaLomi/g)).toHaveLength(1);
    expect(titles.has(actual)).toBe(false); titles.add(actual);
    await expect(page.locator('head meta[name="description"]')).toHaveAttribute("content", /\S.{15,}/);
    if (privatePage) await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  }
});

test("F18 core book is usable while real reader query waits, fails, and recovers", async ({ page }, info) => {
  test.skip(process.env.RUN_ISSUE_127_READER_E2E !== "1", "Requires exclusive guarded isolated Supabase app and database.");
  requireExclusive(info); test.setTimeout(120_000);
  const fixture = await communityFixtures(info);
  let lock: Awaited<ReturnType<typeof holdReaderTable>> | undefined;
  try {
    const book = await fixture.product("UX127 streamed reader section");
    expect((await fixture.service.from("amazon_links").insert({ id: randomUUID(), product_id: book.id, market: "amazon.com", url: "https://www.amazon.com/dp/B0TESTONLY", is_primary: true })).error).toBeNull();
    await fixture.readerArtwork(book.id, "Controlled artist", 0, "rose-fox.webp");
    lock = await holdReaderTable();
    await page.goto(`/en/products/${book.slug}`, { waitUntil: "commit" });
    await expect(page.getByTestId("product-hero").getByRole("heading", { name: book.title })).toBeVisible();
    await expect(page.getByRole("link", { name: "View on Amazon" })).toBeVisible();
    await expect(page.getByTestId("product-community-loading")).toBeVisible();
    await capture(page, info, "f18-main-before-secondary");
    lock.cancelOwnBlockedReaders();
    await expect(page.getByTestId("product-community-error")).toBeVisible();
    await expect(page.getByTestId("product-hero")).toBeVisible();
    await capture(page, info, "f18-error");
    await lock.release(); lock = undefined;
    await page.getByTestId("product-community-error").getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Colored by Our Readers" })).toBeVisible();
    await expect(page.getByTestId("product-community-error")).toHaveCount(0);
    await capture(page, info, "f18-recovered");
  } finally { await lock?.release(); await fixture.cleanup(); }
});

test("F07 F10 F23 catalog Enter, all filter context, Back and native GET", async ({ page, browser }, info) => {
  test.skip(process.env.RUN_ISSUE_127_READER_E2E !== "1", "Requires guarded isolated catalogue fixture.");
  requireExclusive(info); test.setTimeout(120_000);
  const fixture = await communityFixtures(info);
  const categoryId = randomUUID();
  try {
    const book = await fixture.product("UX127 Catalog Context Book");
    const category = `ux127-${categoryId.slice(0, 8)}`;
    expect((await fixture.service.from("categories").insert({ id: categoryId, slug: category, sort_order: 1 })).error).toBeNull();
    expect((await fixture.service.from("category_translations").insert({ category_id: categoryId, locale: "en", name: "UX127 context" })).error).toBeNull();
    expect((await fixture.service.from("product_categories").insert({ product_id: book.id, category_id: categoryId })).error).toBeNull();
    const query = new URLSearchParams({ q: book.title, audience: "adults", type: "coloring-book", category, sort: "az" });
    await page.setViewportSize({ width: 390, height: 844 });
    const initialQuery = new URLSearchParams(query); initialQuery.delete("q");
    await page.goto(`/en/products?${initialQuery}`);
    await page.getByTestId("catalog-mobile-filter-disclosure").getByText("Filters", { exact: true }).click();
    await page.getByTestId("catalog-mobile-search").getByRole("textbox", { name: "Search catalog" }).fill(book.title);
    await page.getByTestId("catalog-mobile-search").getByRole("textbox", { name: "Search catalog" }).press("Enter");
    await expect(page.getByTestId("catalog-mobile-filter-disclosure")).toHaveAttribute("open");
    const card = page.locator(`#catalog-product-${book.id}`);
    await expect(card.getByRole("heading", { name: book.title })).toBeVisible();
    await card.getByRole("link").click();
    await expect(page).toHaveURL(/\?catalog=/);
    await page.getByRole("link", { name: "Back to catalog" }).click();
    await expect(page).toHaveURL(new RegExp(`#catalog-product-${book.id}$`));
    const returned = new URL(page.url());
    for (const [key, value] of query) expect(returned.searchParams.get(key)).toBe(value);
    await expect(card).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(page, info, "f23-returned-context");
    await page.goto(`/en/products/${book.slug}`);
    await expect(page.getByRole("link", { name: "Back to catalog" })).toHaveAttribute("href", "/en/products");
    const context = await browser.newContext({ baseURL: COMMUNITY_TEST_ORIGIN, javaScriptEnabled: false, ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
    try {
      const native = await context.newPage();
      await native.goto(`/en/products?${initialQuery}`);
      await native.getByTestId("catalog-mobile-search").getByRole("textbox", { name: "Search catalog" }).fill(book.title);
      await native.getByTestId("catalog-mobile-search").getByRole("textbox", { name: "Search catalog" }).press("Enter");
      await expect(native.locator(`#catalog-product-${book.id}`)).toBeVisible();
      expect(new URL(native.url()).searchParams.get("q")).toBe(book.title);
    } finally { await context.close(); }
  } finally {
    await fixture.cleanup();
    expect((await fixture.service.from("categories").delete().eq("id", categoryId)).error).toBeNull();
  }
});

test("F06 Club retains real artwork through rapid filters, an injected failure and retry", async ({ page }, info) => {
  test.skip(process.env.RUN_ISSUE_127_READER_E2E !== "1", "Requires guarded real Supabase/Auth/Storage and Club ON.");
  requireExclusive(info); test.setTimeout(180_000);
  const fixture = await communityFixtures(info);
  const release: Array<() => void> = [];
  try {
    const owner = await fixture.actor("filter-owner", { username: `ux127_filter_${info.project.name.replace(/[^a-z0-9]/g, "").slice(0, 8)}` });
    const admin = await fixture.actor("filter-admin", { admin: true });
    const book = await fixture.product("UX127 Club filter book");
    const emptyBook = await fixture.product("UX127 empty filter book");
    await fixture.unlock(owner.id, book.id); await fixture.login(page, owner);
    const bytes = await sharp({ create: { width: 120, height: 160, channels: 3, background: "#a4b49c" } }).png().toBuffer();
    const uploaded = await page.request.post(`${COMMUNITY_TEST_ORIGIN}/api/community/artworks`, { headers: { Origin: COMMUNITY_TEST_ORIGIN }, multipart: { file: { name: "filter.png", mimeType: "image/png", buffer: bytes }, productId: book.id, description: "UX127 real filtered artwork", idempotencyKey: randomUUID(), rulesAccepted: "true" } });
    expect(uploaded.ok()).toBe(true); const artwork = (await uploaded.json()).artwork;
    expect((await fixture.service.rpc("community_moderate_artwork", { p_actor_user_id: admin.id, p_artwork_id: artwork.id, p_expected_revision: 1, p_action: "approve", p_reason: null })).error).toBeNull();
    await fixture.normalizeDisplayTimestamps({ artworkIds: [artwork.id] });
    await page.goto(`/en/club?productId=${book.id}`);
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(1);
    const historyLength = await page.evaluate(() => history.length);
    await page.route("**/api/community/artworks?*", async (route) => {
      await new Promise<void>((resolve) => release.push(resolve));
      await route.continue().catch(() => undefined); // Superseded filter requests are intentionally aborted.
    });
    const select = page.getByTestId("community-gallery-product-filter");
    for (const [index, value] of [emptyBook.id, "", book.id].entries()) {
      await select.selectOption(value);
      await expect.poll(() => release.length).toBe(index + 1);
    }
    await expect(page.getByTestId("community-artwork-grid")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByText("UX127 real filtered artwork", { exact: true })).toBeVisible();
    await capture(page, info, "f06-retained-pending");
    release[2](); release[0](); release[1]();
    await expect(page.getByTestId("community-artwork-grid")).toHaveAttribute("aria-busy", "false");
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(1);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    await page.unrouteAll({ behavior: "wait" });
    await page.route("**/api/community/artworks?*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) }), { times: 1 });
    await select.selectOption(emptyBook.id);
    await expect(page.getByRole("alert").filter({ hasText: "current gallery is still here" })).toBeVisible();
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(1);
    await capture(page, info, "f06-retained-error");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByTestId("community-gallery-empty-state")).toBeVisible();
    await select.selectOption(book.id);
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(1);
    await page.getByTestId("community-artwork-card").getByRole("link").first().click();
    await page.goBack();
    await expect(select).toHaveValue(book.id);
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(1);
  } finally { release.forEach((resolve) => resolve()); await page.unrouteAll({ behavior: "ignoreErrors" }); await fixture.cleanup(); }
});

test("F24 F25 real role fixtures open private files directly and explain sharing readiness", async ({ page, browser }, info) => {
  test.skip(process.env.RUN_ISSUE_127_READER_E2E !== "1", "Requires isolated real accounts, Storage, unlocks and Club ON.");
  requireExclusive(info); test.setTimeout(180_000);
  const fixture = await communityFixtures(info);
  let assetPath: string | undefined;
  try {
    const book = await fixture.product("UX127 direct library files");
    const owner = await fixture.actor("library-owner", { username: `lib_${randomUUID().slice(0, 8)}` });
    const noBooks = await fixture.actor("library-empty", { username: `empty_${randomUUID().slice(0, 8)}` });
    const join = await fixture.actor("library-join");
    const unverified = await fixture.actor("library-unverified");
    await fixture.unlock(owner.id, book.id); await fixture.unlock(join.id, book.id); await fixture.unlock(unverified.id, book.id);
    const assetId = randomUUID(); assetPath = `products/${book.id}/premium/${assetId}.pdf`;
    const bytes = Buffer.from("%PDF-1.4\nControlled UX127 test bonus\n%%EOF");
    expect((await fixture.service.storage.from("premium-files").upload(assetPath, bytes, { contentType: "application/pdf" })).error).toBeNull();
    expect((await fixture.service.from("product_assets").insert({ id: assetId, product_id: book.id, kind: "premium_download", bucket: "premium-files", path: assetPath, filename: "test-bonus.pdf", content_type: "application/pdf", size_bytes: bytes.length, title: "Controlled bonus PDF", is_public: false, is_active: true, storage_provider: "supabase" })).error).toBeNull();
    const files = `/en/library/books/${book.slug}`;
    await page.goto(files); await expect(page.getByTestId("library-files-denied")).toBeVisible();
    await page.goto(`/en/club?productId=${book.id}`);
    await expect(page.getByTestId("community-gallery-share")).toHaveText("Log in to share your art");
    for (const [account, label] of [[noBooks, "Unlock a book to share your art"], [join, "Review Coloring Club requirements"], [unverified, "Verify your email to share"], [owner, "Share your art"]] as const) {
      const memberPage = await fixture.newPage(browser);
      await fixture.login(memberPage, account, "/en/club");
      if (account.id === unverified.id) {
        fixture.setEmailVerified(account.id, false);
        await memberPage.goto("/en/library");
        await expect(memberPage.getByTestId("library-unverified-state")).toBeVisible();
        await expect(memberPage.getByText("No unlocked products yet", { exact: true })).toHaveCount(0);
        await expect(memberPage.getByRole("link", { name: "Open my files", exact: true })).toHaveCount(0);
        await memberPage.reload();
        await expect(memberPage.getByTestId("library-unverified-state")).toBeVisible();
        const preservedUnlock = await fixture.service.from("user_product_unlocks").select("product_id").eq("user_id", unverified.id).eq("product_id", book.id).single();
        expect(preservedUnlock.error).toBeNull();
        expect(preservedUnlock.data?.product_id).toBe(book.id);
      }
      await memberPage.goto(`/en/club?productId=${book.id}`);
      await expect(memberPage.getByTestId("community-gallery-share")).toHaveText(label);
    }
    await fixture.login(page, owner, "/en/library");
    const privateTitles = new Set<string>();
    for (const [url, title] of [["/en/account", "Account"], ["/en/library/creations", "My Creations"], ["/en/library", "My Library"], ["/en/club", "Coloring Club"]] as const) {
      await page.goto(url);
      await expect(page).toHaveTitle(`${title} | LamiliaLomi`);
      const actual = await page.title();
      expect(actual.match(/LamiliaLomi/g)).toHaveLength(1);
      expect(privateTitles.has(actual)).toBe(false); privateTitles.add(actual);
      await expect(page.locator('head meta[name="description"]')).toHaveAttribute("content", /\S.{15,}/);
      if (url !== "/en/club") await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    }
    await page.goto("/en/library");
    await expect(page).toHaveURL(`${COMMUNITY_TEST_ORIGIN}/en/library`);
    await expect(page.getByTestId("library-page")).toBeVisible();
    const card = page.getByTestId("library-book-card").filter({ hasText: book.title });
    await expect(card).toContainText("1 bonus file"); await card.getByRole("link", { name: "Open my files" }).click();
    await expect(page).toHaveURL(`${COMMUNITY_TEST_ORIGIN}${files}`);
    const download = page.getByRole("link", { name: "Controlled bonus PDF Download PDF" });
    const href = await download.getAttribute("href"); expect(href).toContain(`/api/downloads/${assetId}`);
    const response = await page.request.get(href!); expect(response.status()).toBe(200); expect(await response.body()).toEqual(bytes);
    await page.reload(); await expect(download).toBeVisible();
    await capture(page, info, "f24-direct-private-files");
    const guest = await fixture.newPage(browser); const denied = await guest.request.get(`${COMMUNITY_TEST_ORIGIN}/api/downloads/${assetId}`); expect(denied.status()).toBe(401);
  } finally {
    if (assetPath) expect((await fixture.service.storage.from("premium-files").remove([assetPath])).error).toBeNull();
    await fixture.cleanup();
  }
});

test("F01 real guarded mail sink acceptance and timeout/retry keep the draft", async ({ page }, info) => {
  test.skip(process.env.RUN_ISSUE_127_CONTACT_E2E !== "1", "Requires explicit loopback local-demo app with LAMILIA_CONTACT_TEST_SINK=1.");
  requireExclusive(info); test.setTimeout(90_000);
  if (!(await isLocalDemoAppTarget(page, info.project.use.baseURL))) throw new Error("Refusing Contact fixture outside verified local demo.");
  await page.goto("/en/contact");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/contact$/);
  await expect(page.getByLabel("Name", { exact: true })).toHaveAttribute("aria-invalid", "true");
  const payload = { name: "UX127 controlled reader", email: "ux127-contact@example.test", message: "Controlled local-only Contact acceptance.", locale: "en" };
  await page.getByLabel("Name", { exact: true }).fill(payload.name); await page.getByLabel("Email", { exact: true }).fill(payload.email); await page.getByLabel("Message", { exact: true }).fill(payload.message);
  const requestId = await page.locator('input[name="requestId"]').inputValue();
  const key = createHash("sha256").update(requestId).update(JSON.stringify(payload)).digest("hex");
  const filename = path.resolve(".data/contact-test-outbox", `${key}.json`);
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.clock.install();
  await page.route("**/api/contact", async (route) => { await gate; await route.continue().catch(() => undefined); });
  try {
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sending…", exact: true })).toBeDisabled();
    await page.clock.fastForward(15000);
    await expect(page.locator("form p[role=alert]")).toContainText("could not confirm delivery");
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(payload.message);
    release(); await page.unrouteAll({ behavior: "ignoreErrors" });
    const accepted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/contact" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    expect(await (await accepted).json()).toEqual({ ok: true, mode: "local-test-sink" });
    await expect(page.locator("form p[role=status]")).toContainText("accepted");
    const stored = await readFile(filename, "utf8"); expect(JSON.parse(stored).text).toContain(payload.message);
    const origin = new URL(page.url()).origin;
    const repeated = await page.request.post(`${origin}/api/contact`, { headers: { origin }, form: { ...payload, requestId } });
    expect(await repeated.json()).toEqual({ ok: true, mode: "local-test-sink" }); expect(await readFile(filename, "utf8")).toBe(stored);
    await capture(page, info, "f01-sink-accepted");
  } finally { release(); await page.unrouteAll({ behavior: "ignoreErrors" }); await unlink(filename).catch(() => undefined); }
});
