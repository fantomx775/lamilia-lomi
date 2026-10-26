import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { communityArtifactPath } from "./helpers/community-fixtures";
import { COMMUNITY_RULES_VERSION } from "../../src/lib/community/rules";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

test("real club membership, concurrency, privacy and responsive account/profile views", async ({ page, browser }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_PROFILES_E2E !== "1" || testInfo.project.name !== "chromium",
    "Requires the explicitly isolated Lamilia Supabase/HTTPS application; run once with one worker.");
  test.setTimeout(240_000);
  const appOrigin = "https://127.0.0.1:3443";
  if (testInfo.project.use.baseURL !== appOrigin || process.env.LAMILIA_BACKEND !== "supabase") {
    throw new Error("Community browser fixtures require Supabase mode and the isolated HTTPS app on port 3443.");
  }
  const status = JSON.parse(await readFile("/tmp/lamilia-p0-preflight/local-supabase-status.json", "utf8"));
  if (status.API_URL !== "http://127.0.0.1:55421") throw new Error("Wrong local Supabase test target.");
  const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ids: string[] = [];
  const contexts: BrowserContext[] = [];
  const password = `P0-${randomUUID()}-8!`;
  const runId = process.env.COMMUNITY_BROWSER_RUN_ID ?? "cc02-local-supabase-1";
  if (!/^[a-z0-9_-]+$/i.test(runId)) throw new Error("Unsafe browser run identifier.");
  const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const set = process.env.COMMUNITY_SCREENSHOT_SET;
  if (set && !/^[a-z0-9_-]+$/i.test(set)) throw new Error("Unsafe screenshot set.");
  const folderName = set ? `${set}-cc02` : "cc02";
  const folder = path.resolve("docs/verification/issue-77", folderName);
  const screenshots: Array<{ path: string; testedSha: string; runId: string }> = [];
  const runtimeErrors: string[] = [];
  const networkFailures: Array<{ path: string; error: string | undefined }> = [];
  const consoleDiagnostics: string[] = [];
  const navigationAborts: Array<{ path: string; error: string }> = [];
  await mkdir(folder, { recursive: true });
  function observe(target: Page) {
    target.on("pageerror", (error) => runtimeErrors.push(error.message));
    target.on("requestfailed", (request) => {
      const pathname = new URL(request.url()).pathname;
      const error = request.failure()?.errorText;
      // Login navigation cancels Next prefetches and its in-flight font request.
      // Retain these observed cancellations separately from transport failures.
      if (error === "net::ERR_ABORTED" && (pathname === "/en/login" || pathname === "/__nextjs_font/geist-latin.woff2")) {
        navigationAborts.push({ path: pathname, error });
      } else networkFailures.push({ path: pathname, error });
    });
    target.on("console", (message) => {
      if (message.type() === "error") consoleDiagnostics.push(message.text());
    });
  }
  observe(page);
  async function makeActor(label: string, isAdmin = false) {
    const email = `p0-browser-${label}@example.test`;
    const result = await service.auth.admin.createUser({ email, password, email_confirm: true,
      user_metadata: { terms_accepted: true, preferred_locale: "en", role: "admin" } });
    if (result.error || !result.data.user) throw new Error(`Could not create isolated ${label} fixture; do not overwrite existing accounts.`);
    const id = result.data.user.id;
    ids.push(id);
    if (isAdmin) {
      const result = await service.from("profiles").update({ role: "admin" }).eq("id", id);
      if (result.error) throw new Error("Could not provision isolated moderator role.");
    }
    return { id, email };
  }
  async function essentials(target: Page) {
    const button = target.getByRole("button", { name: "Essential only", exact: true });
    await expect(button.or(target.getByRole("button", { name: "Cookie settings", exact: true }))).toBeVisible();
    if (await button.isVisible()) await button.click();
  }
  async function login(target: Page, email: string) {
    await target.goto(`${appOrigin}/en/login?returnTo=%2Fen%2Faccount`);
    await expect(target.getByLabel("Email", { exact: true })).toHaveValue("");
    await target.getByLabel("Email", { exact: true }).fill(email);
    await target.getByLabel("Password", { exact: true }).fill(password);
    await target.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(target).toHaveURL(`${appOrigin}/en/account`);
    await expect(target.getByTestId("community-account-panel")).toBeVisible();
    await essentials(target);
  }
  async function newPage() {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
    contexts.push(context);
    const target = await context.newPage();
    observe(target);
    return target;
  }
  async function capture(target: Page, view: string) {
    for (const width of [390, 768, 1440]) {
      await target.setViewportSize({ width, height: 1000 });
      await expect(target.getByTestId("localized-route-loading")).toHaveCount(0);
      await expect(target.getByRole("heading", { level: 1 }).first()).toBeVisible();
      if (new URL(target.url()).pathname === "/en/account") {
        await expect(target.getByTestId("community-account-panel")).toBeVisible();
      }
      await target.evaluate(() => scrollTo(0, 0));
      await essentials(target);
      await target.mouse.move(0, 0);
      await target.evaluate(() => document.fonts.ready);
      await target.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const filename = `${view}-${width}.png`;
      await target.screenshot({ path: path.join(folder, filename), fullPage: true, caret: "hide", animations: "disabled" });
      screenshots.push({ path: `docs/verification/issue-77/${folderName}/${filename}`, testedSha, runId });
    }
  }
  async function postJoin(target: Page, username: string, extra: Record<string, unknown> = {}) {
    // These are backend validation/concurrency probes. APIRequestContext shares
    // the real browser cookies without creating resource errors in its console.
    const response = await target.request.post(`${appOrigin}/api/community/join`, {
      headers: { Origin: appOrigin },
      data: { username, adultAttested: true, rulesAccepted: true, rulesVersion: COMMUNITY_RULES_VERSION, ...extra },
    });
    return { status: response.status(), body: await response.json() };
  }
  let fixtureCleanup = false;
  try {
    const owner = await makeActor("owner");
    const racerOne = await makeActor("racer-one");
    const racerTwo = await makeActor("racer-two");
    const unverified = await makeActor("unverified");
    const moderator = await makeActor("moderator", true);

    await page.goto(`${appOrigin}/en/account`);
    await expect(page.getByRole("link", { name: "Log in to join Coloring Club" })).toHaveAttribute("href", /returnTo=%2Fen%2Faccount/);
    const guest = await page.request.post(`${appOrigin}/api/community/join`, {
      headers: { Origin: appOrigin }, data: { username: "p0_guest", adultAttested: true, rulesAccepted: true, rulesVersion: COMMUNITY_RULES_VERSION },
    });
    expect(guest.status()).toBe(401);
    await login(page, owner.email);
    const panel = page.getByTestId("community-account-panel");
    await expect(panel.getByRole("checkbox", { name: /18|adult/i })).not.toBeChecked();
    await expect(panel.getByRole("checkbox", { name: /I accept the current community guidelines/ })).not.toBeChecked();
    await capture(page, "account-join");
    await panel.getByLabel("Public username", { exact: true }).fill("p0_artist_fixture");
    await panel.getByRole("checkbox", { name: /18|adult/i }).check();
    await panel.getByRole("checkbox", { name: /I accept the current community guidelines/ }).check();
    await panel.getByRole("button", { name: "Join the Coloring Club", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("You joined");
    const profile = await service.from("community_profiles").select("username,accepted_at,rules_version").eq("user_id", owner.id).single();
    expect(profile.error).toBeNull();
    expect(profile.data).toMatchObject({ username: "p0_artist_fixture", rules_version: COMMUNITY_RULES_VERSION });
    expect(profile.data?.accepted_at).toBeTruthy();
    const accountConsent = await service.from("profiles").select("marketing_consent").eq("id", owner.id).single();
    expect(accountConsent.error).toBeNull();
    expect(accountConsent.data?.marketing_consent).toBe(false);
    await page.reload();
    await expect(panel.getByLabel("Change public username")).toHaveValue("p0_artist_fixture");

    const longUsername = "p0_artist_abcdefghijklmn";
    expect(longUsername.length).toBe(24);
    await panel.getByLabel("Change public username").fill(longUsername);
    await panel.getByRole("button", { name: "Save username", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("updated");
    expect((await service.from("community_profiles").update({ avatar_seed: "12345678-1234-4234-8234-123456789abc" }).eq("user_id", owner.id)).error).toBeNull();
    await page.reload();
    await expect(panel.getByLabel("Change public username")).toHaveValue(longUsername);
    await capture(page, "account-settings");

    const visitor = await newPage();
    await visitor.goto(`${appOrigin}/en/club/creators/${longUsername}`);
    await expect(visitor.getByRole("heading", { name: `@${longUsername}`, exact: true })).toBeVisible();
    await expect(visitor.getByTestId("creator-empty-state")).toBeVisible();
    await capture(visitor, "creator-empty");
    const oldProfile = await visitor.request.get(`${appOrigin}/en/club/creators/p0_artist_fixture`);
    expect(oldProfile.status()).toBe(404);

    // Use the actual validated upload pipeline and private provider, not metadata-only rows.
    const productId = "11111111-1111-4111-8111-111111111111";
    expect((await service.from("user_product_unlocks").insert({ user_id: owner.id, product_id: productId })).error).toBeNull();
    const fixtureImage = await sharp({ create: { width: 160, height: 120, channels: 3, background: "#9aa58e" } }).png().toBuffer();
    async function art(description: string, state: "pending" | "approved" | "rejected" | "removed"): Promise<string> {
      const result = await page.request.post(`${appOrigin}/api/community/artworks`, {
        headers: { Origin: appOrigin }, multipart: {
          file: { name: "garden.png", mimeType: "image/png", buffer: fixtureImage }, productId,
          description, idempotencyKey: randomUUID(), rulesAccepted: "true",
        },
      });
      expect([200, 201]).toContain(result.status());
      const artwork = (await result.json()).artwork;
      if (state !== "pending") {
        const decision = await service.rpc("community_moderate_artwork", { p_actor_user_id: moderator.id,
          p_artwork_id: artwork.id, p_expected_revision: 1, p_action: state === "rejected" ? "reject" : "approve",
          p_reason: state === "rejected" ? "private_reason_cc02" : null });
        if (decision.error) throw new Error("Could not moderate isolated profile fixture.");
        if (state === "removed") {
          const removal = await service.rpc("community_moderate_artwork", { p_actor_user_id: moderator.id,
            p_artwork_id: artwork.id, p_expected_revision: 2, p_action: "remove", p_reason: "private_reason_cc02" });
          if (removal.error) throw new Error("Could not remove isolated profile fixture.");
        }
      }
      return artwork.id as string;
    }
    const warmGardenId = await art("Warm garden afternoon", "approved");
    const pendingId = await art("private_pending_cc02", "pending");
    const rejectedId = await art("private_rejected_cc02", "rejected");
    const removedId = await art("private_removed_cc02", "removed");
    const orderedFixtures = [
      { id: warmGardenId, description: "Warm garden afternoon", createdAt: "2026-10-25T10:00:03Z" },
      { id: pendingId, description: "private_pending_cc02", createdAt: "2026-10-25T10:00:02Z" },
      { id: rejectedId, description: "private_rejected_cc02", createdAt: "2026-10-25T10:00:01Z" },
      { id: removedId, description: "private_removed_cc02", createdAt: "2026-10-25T10:00:00Z" },
    ];
    const fixtureRows = await service.from("community_artworks")
      .select("id,author_id,description,created_at").in("id", orderedFixtures.map((artwork) => artwork.id));
    expect(fixtureRows.error).toBeNull();
    expect(fixtureRows.data?.map((artwork) => artwork.id).sort()).toEqual(orderedFixtures.map((artwork) => artwork.id).sort());
    expect(fixtureRows.data).toHaveLength(4);
    const currentTime = Date.now();
    for (const fixture of orderedFixtures) {
      const row = fixtureRows.data?.find((artwork) => artwork.id === fixture.id);
      expect(row).toMatchObject({ id: fixture.id, author_id: owner.id, description: fixture.description });
      const originalCreatedAt = Date.parse(row?.created_at ?? "");
      expect(Number.isFinite(originalCreatedAt) && Math.abs(currentTime - originalCreatedAt) <= 10 * 60_000).toBe(true);
      expect((await service.from("community_artworks").update({
        created_at: fixture.createdAt,
        updated_at: "2026-10-25T10:00:00Z",
        published_at: "2026-10-25T10:00:00Z",
      }).eq("id", fixture.id).eq("author_id", owner.id)).error).toBeNull();
    }
    await visitor.reload();
    await expect(visitor.getByText("Warm garden afternoon", { exact: true })).toBeVisible();
    const publicHtml = await visitor.content();
    for (const forbidden of [owner.email, owner.id, "private_pending_cc02", "private_rejected_cc02", "private_removed_cc02", "private_reason_cc02", "storage_path", "author_id"]) {
      expect(publicHtml).not.toContain(forbidden);
    }
    await capture(visitor, "creator-approved");
    await page.goto(`${appOrigin}/en/library/creations`);
    await expect(page.getByRole("heading", { name: "My Creations", exact: true })).toBeVisible();
    const creationCards = page.getByTestId("community-artwork-card");
    await expect(creationCards).toHaveCount(4);
    for (const [index, fixture] of orderedFixtures.entries()) {
      await expect(creationCards.nth(index)).toContainText(fixture.description);
    }
    for (const image of await page.getByTestId("community-artwork-preview").all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
    await capture(page, "my-creations");
    await visitor.goto(`${appOrigin}/en/community-guidelines`);
    await expect(visitor.getByRole("heading", { name: /Community guidelines/i }).first()).toBeVisible();
    await capture(visitor, "guidelines");

    const racePageOne = await newPage();
    const racePageTwo = await newPage();
    await login(racePageOne, racerOne.email);
    await login(racePageTwo, racerTwo.email);
    const race = await Promise.all([postJoin(racePageOne, "p0_racing_artist"), postJoin(racePageTwo, "P0_RACING_ARTIST")]);
    expect(race.map((response) => response.status).sort()).toEqual([201, 409]);
    const loser = race[0].status === 409 ? racePageOne : racePageTwo;
    expect((await postJoin(loser, "p0_extra", { author_id: owner.id, role: "admin" })).status).toBe(400);
    expect((await postJoin(loser, "p0_extra", { adultAttested: false })).status).toBe(400);
    expect((await postJoin(loser, "p0_extra", { rulesVersion: "obsolete-rules" })).status).toBe(400);
    expect((await postJoin(loser, "admin")).status).toBe(400);
    const noOrigin = await loser.request.patch(`${appOrigin}/api/community/profile`, { data: { username: "p0_no_origin" } });
    expect(noOrigin.status()).toBe(403);

    const unverifiedPage = await newPage();
    await login(unverifiedPage, unverified.email);
    if (!/^[0-9a-f-]{36}$/.test(unverified.id)) throw new Error("Unsafe local fixture identity.");
    execFileSync("docker", ["exec", "-i", "supabase_db_lamilia-coloring-club-p0", "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
      input: `UPDATE auth.users SET email_confirmed_at=NULL WHERE id='${unverified.id}'::uuid;`, stdio: ["pipe", "pipe", "pipe"],
    });
    expect([401, 403]).toContain((await postJoin(unverifiedPage, "p0_unverified")).status);
    expect((await service.from("community_profiles").select("user_id").eq("user_id", unverified.id)).data).toEqual([]);

    await page.goto(`${appOrigin}/en/account`);
    await panel.getByRole("button", { name: "Leave the Coloring Club", exact: true }).click();
    await panel.getByRole("button", { name: "Confirm leave", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("You left");
    expect((await visitor.request.get(`${appOrigin}/en/club/creators/${longUsername}`)).status()).toBe(404);
    await page.reload();
    await expect(panel.getByLabel("Public username", { exact: true })).toHaveValue(longUsername);
    expect(runtimeErrors).toEqual([]);
    expect(networkFailures).toEqual([]);
    expect(consoleDiagnostics).toEqual([]);
  } finally {
    // Remove exactly these controlled local accounts/artwork audit rows; nothing
    // is deleted from a cloud project or another local project's infrastructure.
    try {
      if (ids.length) {
        if (ids.some((id) => !/^[0-9a-f-]{36}$/.test(id))) throw new Error("Unsafe local cleanup identity.");
        for (const id of ids) {
          const prefix = `community/${id}`;
          const listed = await service.storage.from("collection-media").list(prefix);
          if (listed.error) throw new Error("Isolated profile fixture object listing failed.");
          const objects = (listed.data ?? []).filter((item) => item.id).map((item) => `${prefix}/${item.name}`);
          if (objects.length && (await service.storage.from("collection-media").remove(objects)).error) throw new Error("Isolated profile fixture object cleanup failed.");
        }
        const literals = ids.map((id) => `'${id}'::uuid`).join(",");
        execFileSync("docker", ["exec", "-i", "supabase_db_lamilia-coloring-club-p0", "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
          input: `BEGIN; DELETE FROM public.community_upload_reservations WHERE author_id IN (${literals});
            DELETE FROM public.community_moderation_email_outbox WHERE moderation_event_id IN
              (SELECT id FROM public.community_moderation_events WHERE artwork_id IN
                (SELECT id FROM public.community_artworks WHERE author_id IN (${literals})));
            DELETE FROM public.community_moderation_events WHERE artwork_id IN
            (SELECT id FROM public.community_artworks WHERE author_id IN (${literals}));
            DELETE FROM public.community_artworks WHERE author_id IN (${literals}); COMMIT;`, stdio: ["pipe", "pipe", "pipe"],
        });
        for (const id of ids) {
          const result = await service.auth.admin.deleteUser(id);
          if (result.error) throw new Error("Isolated community Auth fixture cleanup failed.");
        }
      }
      fixtureCleanup = true;
    } finally {
      for (const context of contexts) await context.close();
      await writeFile(await communityArtifactPath("cc02"), `${JSON.stringify({ testedSha, runId, screenshots,
        viewports: [390, 768, 1440], backend: "isolated real Supabase/Auth/PostgREST", runtimeErrors,
        networkFailures, navigationAborts, consoleDiagnostics, fixtureCleanup,
        note: "Checkpoint run with real validated uploads and private image-byte fixtures. Development badge hidden for captures. Intentional HTTP denials are tested separately from JavaScript runtime errors. Visual screenshot review recorded separately by actual reviewers." }, null, 2)}\n`);
    }
  }
});
