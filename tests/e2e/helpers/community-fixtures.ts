import { expect, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { COMMUNITY_RULES_VERSION } from "../../../src/lib/community/rules";

export const COMMUNITY_TEST_ORIGIN = "https://127.0.0.1:3443";

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

  async function actor(label: string, options: { admin?: boolean; username?: string; verified?: boolean } = {}) {
    const email = `cc-browser-${label}-${runToken}@example.test`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: options.verified !== false,
      user_metadata: { role: "admin", terms_accepted: true, preferred_locale: "en" } });
    if (created.error || !created.data.user) throw new Error("Unable to create isolated community test account.");
    const id = created.data.user.id;
    users.push(id);
    if (options.admin) expect((await service.from("profiles").update({ role: "admin" }).eq("id", id)).error).toBeNull();
    if (options.username) {
      expect((await service.rpc("community_join", { p_actor_user_id: id, p_username: options.username,
        p_adult_attested: true, p_rules_version: COMMUNITY_RULES_VERSION })).error).toBeNull();
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

  function setEmailVerified(userId: string, verified: boolean) {
    if (!users.includes(userId) || !/^[a-f0-9-]{36}$/.test(userId)) throw new Error("Unsafe fixture identity.");
    execFileSync("docker", ["exec", "-i", "supabase_db_lamilia-coloring-club-p0", "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
      input: `UPDATE auth.users SET email_confirmed_at=${verified ? "now()" : "NULL"} WHERE id='${userId}'::uuid;`,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  async function newPage(browser: Browser) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
    contexts.push(context);
    return context.newPage();
  }

  async function login(page: Page, account: { email: string; password: string }, returnTo = "/en/library/creations") {
    observeMutations(page);
    await page.goto(`${COMMUNITY_TEST_ORIGIN}/en/login?returnTo=${encodeURIComponent(returnTo)}`);
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(`${COMMUNITY_TEST_ORIGIN}${returnTo}`);
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
        execFileSync("docker", ["exec", "-i", "supabase_db_lamilia-coloring-club-p0", "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
          input: `BEGIN; DELETE FROM public.community_upload_reservations WHERE author_id IN (${identities});
            DELETE FROM public.community_moderation_events WHERE artwork_id IN
            (SELECT id FROM public.community_artworks WHERE author_id IN (${identities}));
            DELETE FROM public.community_artworks WHERE author_id IN (${identities}); COMMIT;`,
          stdio: ["pipe", "pipe", "pipe"],
        });
      }
      for (const id of products) expect((await service.from("products").delete().eq("id", id)).error).toBeNull();
      for (const id of users) expect((await service.auth.admin.deleteUser(id)).error).toBeNull();
    } finally {
      for (const context of contexts) await context.close();
      await anon.auth.signOut();
    }
  }

  return { service, anon, actor, product, unlock, setEmailVerified, newPage, login, cleanup, users, products };
}

export async function essentials(page: Page) {
  const accept = page.getByRole("button", { name: "Essential only", exact: true });
  await expect(accept.or(page.getByRole("button", { name: "Cookie settings", exact: true }))).toBeVisible();
  if (await accept.isVisible()) await accept.click();
}

export async function communityScreenshots(page: Page, folderName: string, view: string, runId: string) {
  if (!/^[a-z0-9_-]+$/i.test(folderName) || !/^[a-z0-9_-]+$/i.test(view)) throw new Error("Unsafe screenshot path.");
  const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const folder = path.resolve("docs/verification/issue-77", folderName);
  await mkdir(folder, { recursive: true });
  const screenshots = [];
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByTestId("localized-route-loading")).toHaveCount(0);
    const dialog = page.getByRole("dialog", { name: "Share your art", exact: true });
    const dialogOpen = await dialog.isVisible();
    if (dialogOpen) await dialog.locator(".overflow-y-auto").evaluate((element) => { element.scrollTop = 0; });
    else if (!new URL(page.url()).pathname.startsWith("/admin")) await essentials(page);
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: "nextjs-portal { display:none !important; }" });
    await page.evaluate(() => scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const filename = `${view}-${width}.png`;
    await page.screenshot({ path: path.join(folder, filename), fullPage: !dialogOpen, caret: "initial" });
    screenshots.push({ path: `docs/verification/issue-77/${folderName}/${filename}`, testedSha, runId });
  }
  return screenshots;
}
