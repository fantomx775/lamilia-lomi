import { expect, type APIRequestContext, type Browser, type BrowserContext, type BrowserContextOptions, type Page, type TestInfo } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { COMMUNITY_RULES_VERSION } from "../../../src/lib/community/rules";

export const COMMUNITY_TEST_ORIGIN = "https://127.0.0.1:3443";

/** Keep exact-head rerun manifests outside Git without rewriting prior checkpoints. */
export async function communityArtifactPath(folderName: string, filename = "browser-run.json") {
  if (!/^[a-z0-9_-]+$/i.test(folderName) || !/^[a-z0-9_.-]+$/i.test(filename)) throw new Error("Unsafe evidence path.");
  const base = process.env.COMMUNITY_ARTIFACT_DIR;
  if (base && !path.isAbsolute(base)) throw new Error("Evidence directory must be absolute.");
  const folder = base ? path.join(base, folderName) : path.resolve("docs/verification/issue-77", folderName);
  await mkdir(folder, { recursive: true });
  return path.join(folder, filename);
}

/** Test-only safety boundary: never run controlled destructive cases on cloud resources. */
export async function communityFixtures(testInfo: TestInfo) {
  if (testInfo.project.use.baseURL !== COMMUNITY_TEST_ORIGIN || process.env.LAMILIA_BACKEND !== "supabase") {
    throw new Error("Community browser fixtures require the isolated local HTTPS application.");
  }
  const status = JSON.parse(await readFile("/tmp/lamilia-p0-preflight/local-supabase-status.json", "utf8"));
  if (status.API_URL !== "http://127.0.0.1:55421") throw new Error("Unexpected community fixture database target.");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
  const anon = createClient(status.API_URL, status.ANON_KEY, options);
  const users: string[] = [];
  const products: string[] = [];
  const normalizedDisplayRows = new Set<string>();
  const canonicalDisplayEpoch = Date.parse("2026-10-24T12:00:00.000Z");
  const canonicalDisplayTimestamp = (index: number) => new Date(canonicalDisplayEpoch + index * 10_000).toISOString();
  const curatedObjects = new Map<string, string>();
  const contexts: BrowserContext[] = [];
  const password = `Cc-${randomUUID()}-9!`;
  const trackedPages = new Set<Page>();
  const activeMutations = new Map<object, Promise<void>>();
  function observeMutations(page: Page) {
    if (trackedPages.has(page)) return;
    trackedPages.add(page);
    const completions = new Map<object, () => void>();
    page.on("request", (request) => {
      if (!/^\/api\/(?:admin\/)?community\/artworks/.test(new URL(request.url()).pathname) || request.method() === "GET") return;
      activeMutations.set(request, new Promise<void>((resolve) => completions.set(request, resolve)));
    });
    const finish = (request: object) => { completions.get(request)?.(); completions.delete(request); activeMutations.delete(request); };
    page.on("requestfinished", finish);
    page.on("requestfailed", finish);
  }
  const runToken = randomUUID().slice(0, 8);

  async function actor(label: string, options: { admin?: boolean; username?: string; verified?: boolean; stableEmail?: boolean } = {}) {
    const email = `cc-browser-${label}${options.stableEmail ? "" : `-${runToken}`}@example.test`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: options.verified !== false,
      user_metadata: { role: "admin", terms_accepted: true, preferred_locale: "en" } });
    if (created.error || !created.data.user) throw new Error("Unable to create isolated community test account.");
    const id = created.data.user.id;
    users.push(id);
    if (options.admin) expect((await service.from("profiles").update({ role: "admin" }).eq("id", id)).error).toBeNull();
    if (options.username) {
      expect((await service.rpc("community_join", { p_actor_user_id: id, p_username: options.username,
        p_adult_attested: true, p_rules_version: COMMUNITY_RULES_VERSION })).error).toBeNull();
      expect((await service.from("community_profiles").update({ avatar_seed: "11111111-1111-4111-8111-111111111111" }).eq("user_id", id)).error).toBeNull();
    }
    return { id, email, password };
  }

  async function product(label: string, status: "published" | "draft" | "archived" = "published") {
    const id = randomUUID();
    const slug = `cc-browser-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${runToken}`;
    expect((await service.from("products").insert({ id, slug, status, audience: "adults", product_type: "coloring-book" })).error).toBeNull();
    products.push(id);
    expect((await service.from("product_translations").insert({ product_id: id, locale: "en", title: label,
      short_description: "Isolated community test book", long_description: "Controlled local browser fixture" })).error).toBeNull();
    return { id, slug, title: label };
  }

  async function unlock(userId: string, productId: string) {
    expect(users).toContain(userId);
    expect(products).toContain(productId);
    expect((await service.from("user_product_unlocks").insert({ user_id: userId, product_id: productId })).error).toBeNull();
  }

  /** Stabilize controlled UI evidence only after checking the server-generated time was plausible. */
  async function normalizeDisplayTimestamps(input: { artworkIds?: string[]; reportIds?: string[] }) {
    const normalized = new Set<string>();
    const assertTimestamp = (key: string, value: string | null, alreadyNormalized: boolean) => {
      if (!value) return;
      const timestamp = Date.parse(value);
      const canonical = Date.parse(key);
      if (alreadyNormalized && Math.abs(timestamp - canonical) < 60_000) return;
      if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 10 * 60_000) {
        throw new Error("A controlled community fixture has an implausible server-generated timestamp.");
      }
    };
    for (const id of input.artworkIds ?? []) {
      if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Unsafe community artwork fixture ID.");
      const result = await service.from("community_artworks")
        .select("id,author_id,created_at,updated_at,published_at").eq("id", id).maybeSingle();
      if (result.error || !result.data || !users.includes(result.data.author_id)) {
        throw new Error("Refusing to normalize a community artwork outside this fixture run.");
      }
      const canonical = canonicalDisplayTimestamp(normalized.size);
      const artworkKey = `artwork:${id}`;
      for (const field of ["created_at", "updated_at", "published_at"] as const) {
        const value = result.data[field];
        if (value) assertTimestamp(canonical, value, normalizedDisplayRows.has(artworkKey));
      }
      const update: { created_at: string; updated_at: string; published_at?: string } = {
        created_at: canonical,
        updated_at: canonical,
      };
      if (result.data.published_at) update.published_at = canonical;
      expect((await service.from("community_artworks").update(update).eq("id", id).eq("author_id", result.data.author_id)).error).toBeNull();
      normalized.add(id);
      normalizedDisplayRows.add(artworkKey);

      const events = await service.from("community_moderation_events").select("id,created_at").eq("artwork_id", id).order("created_at", { ascending: true });
      if (events.error) throw new Error("Cannot read controlled moderation fixture history.");
      for (let index = 0; index < (events.data ?? []).length; index++) {
        const event = events.data![index];
        const eventTime = canonicalDisplayTimestamp(normalized.size + index + 1);
        const eventKey = `moderation-event:${event.id}`;
        assertTimestamp(canonical, event.created_at, normalizedDisplayRows.has(eventKey));
        setLocalFixtureTimestamp("community_moderation_events", event.id, eventTime);
        normalizedDisplayRows.add(eventKey);
      }
    }
    for (const id of input.reportIds ?? []) {
      if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Unsafe community report fixture ID.");
      const result = await service.from("community_artwork_reports")
        .select("id,reporter_user_id,created_at,updated_at,resolved_at").eq("id", id).maybeSingle();
      if (result.error || !result.data || !users.includes(result.data.reporter_user_id)) {
        throw new Error("Refusing to normalize a community report outside this fixture run.");
      }
      const canonical = canonicalDisplayTimestamp(normalized.size);
      const reportKey = `report:${id}`;
      assertTimestamp(canonical, result.data.created_at, normalizedDisplayRows.has(reportKey));
      assertTimestamp(canonical, result.data.updated_at, normalizedDisplayRows.has(reportKey));
      if (result.data.resolved_at) assertTimestamp(canonical, result.data.resolved_at, normalizedDisplayRows.has(reportKey));
      const update: { created_at: string; updated_at: string; resolved_at?: string } = { created_at: canonical, updated_at: canonical };
      if (result.data.resolved_at) update.resolved_at = canonical;
      expect((await service.from("community_artwork_reports").update(update).eq("id", id).eq("reporter_user_id", result.data.reporter_user_id)).error).toBeNull();
      normalizedDisplayRows.add(reportKey);
      const events = await service.from("community_artwork_report_events").select("id,created_at").eq("report_id", id).order("created_at", { ascending: true });
      if (events.error) throw new Error("Cannot read controlled report fixture history.");
      for (let index = 0; index < (events.data ?? []).length; index++) {
        const event = events.data![index];
        const eventTime = canonicalDisplayTimestamp(normalized.size + index + 1);
        const eventKey = `report-event:${event.id}`;
        assertTimestamp(canonical, event.created_at, normalizedDisplayRows.has(eventKey));
        setLocalFixtureTimestamp("community_artwork_report_events", event.id, eventTime);
        normalizedDisplayRows.add(eventKey);
      }
    }
  }

  function setLocalFixtureTimestamp(table: "community_moderation_events" | "community_artwork_report_events", id: string, timestamp: string) {
    if (!/^\d{1,18}$/.test(id)) throw new Error("Unsafe community event fixture ID.");
    const safeTimestamp = new Date(timestamp).toISOString();
    execFileSync("docker", ["exec", "-i", "supabase_db_lamilia-coloring-club-p0", "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
      input: `UPDATE public.${table} SET created_at='${safeTimestamp}'::timestamptz WHERE id=${id}::bigint;`,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  async function readerArtwork(productId: string, displayName: string, sortOrder: number, filename: string) {
    if (!products.includes(productId) || !/^[a-z0-9-]+\.webp$/.test(filename)) throw new Error("Unsafe curated fixture.");
    const bytes = await readFile(path.resolve("docs/design/coloring-club/assets", filename));
    const id = randomUUID();
    const storagePath = `reader-artworks/${productId}/image/${id}-${filename}`;
    expect((await service.storage.from("collection-media").upload(storagePath, bytes, { contentType: "image/webp", upsert: false })).error).toBeNull();
    curatedObjects.set(id, storagePath);
    expect((await service.from("product_reader_artworks").insert({ id, product_id: productId, storage_path: storagePath,
      storage_provider: "supabase", filename, content_type: "image/webp", size_bytes: bytes.length,
      display_name: displayName, description: `Curated artwork by ${displayName}`, sort_order: sortOrder, is_visible: true })).error).toBeNull();
    return { id, storagePath };
  }

  function setEmailVerified(userId: string, verified: boolean) {
    if (!users.includes(userId) || !/^[a-f0-9-]{36}$/.test(userId)) throw new Error("Unsafe fixture identity.");
    execFileSync("docker", ["exec", "-i", "supabase_db_lamilia-coloring-club-p0", "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
      input: `UPDATE auth.users SET email_confirmed_at=${verified ? "now()" : "NULL"} WHERE id='${userId}'::uuid;`,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  async function newPage(browser: Browser, contextOptions: BrowserContextOptions = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...contextOptions, ignoreHTTPSErrors: true });
    contexts.push(context);
    return context.newPage();
  }

  async function login(page: Page, account: { email: string; password: string }, returnTo = "/en/library/creations", expectedDestination = returnTo) {
    observeMutations(page);
    await page.goto(`${COMMUNITY_TEST_ORIGIN}/en/login?returnTo=${encodeURIComponent(returnTo)}`);
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(`${COMMUNITY_TEST_ORIGIN}${expectedDestination}`);
    await expect(page.getByTestId("localized-route-loading")).toHaveCount(0);
    if (!returnTo.startsWith("/admin")) await essentials(page);
  }

  async function cleanup() {
    try {
      // A failed UI assertion must not delete its account while its own upload
      // loop is still in flight. Requests finish before fixture data is removed.
      for (const page of trackedPages) {
        if (!page.isClosed()) await page.getByTestId("community-upload-submit").filter({ hasText: "Sending artwork" }).waitFor({ state: "hidden", timeout: 90_000 });
      }
      await Promise.all([...activeMutations.values()]);
      for (const [id, storagePath] of curatedObjects) {
        expect((await service.storage.from("collection-media").remove([storagePath])).error).toBeNull();
        expect((await service.from("product_reader_artworks").delete().eq("id", id).in("product_id", products)).error).toBeNull();
      }
      // Each object prefix belongs exclusively to an account created by this fixture.
      // Remove stored bytes even if an interrupted upload did not finalize an art row.
      for (const id of users) {
        if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Unsafe fixture identity.");
        const prefix = `community/${id}`;
        const listed = await service.storage.from("collection-media").list(prefix, { limit: 1000 });
        if (listed.error) throw new Error("Cannot inspect isolated community fixture objects.");
        const objects = (listed.data ?? []).filter((item) => item.id).map((item) => `${prefix}/${item.name}`);
        if (objects.length) expect((await service.storage.from("collection-media").remove(objects)).error).toBeNull();
      }
      if (users.length) {
        const identities = users.map((id) => `'${id}'::uuid`).join(",");
        const productIds = products.length ? products.map((id) => `'${id}'::uuid`).join(",") : "NULL::uuid";
        const ownedArt = `SELECT id FROM public.community_artworks WHERE author_id IN (${identities}) OR product_id IN (${productIds})`;
        execFileSync("docker", ["exec", "-i", "supabase_db_lamilia-coloring-club-p0", "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
          input: `BEGIN;
            DELETE FROM public.community_account_media_cleanup_jobs WHERE split_part(storage_path, '/', 2)::uuid IN (${identities});
            DELETE FROM public.community_upload_reservations WHERE author_id IN (${identities}) OR product_id IN (${productIds});
            DELETE FROM public.community_artwork_report_events WHERE report_id IN
              (SELECT id FROM public.community_artwork_reports WHERE artwork_id IN (${ownedArt}));
            DELETE FROM public.community_artwork_reports WHERE artwork_id IN (${ownedArt});
            DELETE FROM public.community_moderation_email_outbox WHERE moderation_event_id IN
              (SELECT id FROM public.community_moderation_events WHERE artwork_id IN (${ownedArt}));
            DELETE FROM public.community_moderation_events WHERE artwork_id IN (${ownedArt});
            DELETE FROM public.community_artworks WHERE id IN (${ownedArt}); COMMIT;`,
          stdio: ["pipe", "pipe", "pipe"],
        });
      }
      for (const id of products) expect((await service.from("products").delete().eq("id", id)).error).toBeNull();
      for (const id of users) {
        const existing = await service.auth.admin.getUserById(id);
        if (existing.error?.code === "user_not_found") continue;
        expect(existing.error).toBeNull();
        expect((await service.auth.admin.deleteUser(id)).error).toBeNull();
      }
    } finally {
      for (const context of contexts) await context.close();
      await anon.auth.signOut();
    }
  }

  return { service, anon, actor, product, unlock, readerArtwork, normalizeDisplayTimestamps, setEmailVerified, newPage, login, cleanup, users, products };
}

export async function essentials(page: Page) {
  const accept = page.getByRole("button", { name: "Essential only", exact: true });
  await expect(accept.or(page.getByRole("button", { name: "Cookie settings", exact: true }))).toBeVisible();
  if (await accept.isVisible()) await accept.click();
}

export async function communityScreenshots(page: Page, folderName: string, view: string, runId: string) {
  if (!/^[a-z0-9_-]+$/i.test(folderName) || !/^[a-z0-9_-]+$/i.test(view)) throw new Error("Unsafe screenshot path.");
  const set = process.env.COMMUNITY_SCREENSHOT_SET;
  if (set && !/^[a-z0-9_-]+$/i.test(set)) throw new Error("Unsafe screenshot set.");
  if (set) folderName = `${set}-${folderName}`;
  const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const folder = path.resolve("docs/verification/issue-77", folderName);
  await mkdir(folder, { recursive: true });
  const screenshots = [];
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByTestId("localized-route-loading")).toHaveCount(0);
    const dialog = page.getByRole("dialog").filter({ visible: true });
    const dialogOpen = await dialog.count() === 1;
    if (dialogOpen) {
      await dialog.evaluate((element) => { element.scrollTop = 0; });
      for (const scroller of await dialog.locator(".overflow-y-auto").all()) await scroller.evaluate((element) => { element.scrollTop = 0; });
    }
    else if (!new URL(page.url()).pathname.startsWith("/admin")) await essentials(page);
    const imageScope = dialogOpen ? dialog : page;
    for (const photo of await imageScope.locator('img[src*="/api/community/artworks/"],img[src*="/api/reader-artworks/"]').all()) {
      if (!await photo.isVisible()) continue;
      await photo.scrollIntoViewIfNeeded();
      await expect.poll(() => photo.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: "nextjs-portal { display:none !important; }" });
    await page.evaluate(() => scrollTo(0, 0));
    const overflow = await page.evaluate(() => ({
      width: innerWidth, contentWidth: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll("body *")].flatMap((element) => {
        const box = element.getBoundingClientRect();
        return box.width && (box.left < -1 || box.right > innerWidth + 1)
          ? [{ tag: element.tagName, className: element.getAttribute("class"), left: box.left, right: box.right,
            text: element.textContent?.slice(0, 90) }] : [];
      }).slice(0, 12),
    }));
    expect(overflow.contentWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(width + 1);
    const filename = `${view}-${width}.png`;
    await page.screenshot({ path: path.join(folder, filename), fullPage: !dialogOpen, caret: "hide", animations: "disabled" });
    screenshots.push({ path: `docs/verification/issue-77/${folderName}/${filename}`, testedSha, runId });
  }
  return screenshots;
}

/** Observe actual HTTP responses; no claim is emitted before every assertion passes. */
export async function communityHtmlCheck(request: APIRequestContext, pathname: string, statusCode: 200 | 404, expectedText: string) {
  const response = await request.get(`${COMMUNITY_TEST_ORIGIN}${pathname}`, { maxRedirects: 0 });
  const final = new URL(response.url());
  const contentType = response.headers()["content-type"]?.split(";")[0].trim();
  expect(response.status()).toBe(statusCode);
  expect(contentType).toBe("text/html");
  expect(final.origin).toBe(COMMUNITY_TEST_ORIGIN);
  expect(final.pathname + final.search + final.hash).toBe(pathname);
  expect(await response.text()).toContain(expectedText);
  return { path: pathname, statusCode: response.status(), contentType,
    expectedText, expectedTextMatched: true, sameOrigin: true, finalPathUnchanged: true };
}
