import { execFileSync } from "node:child_process";
import { communityHttpEvidence } from "./helpers/community-http-evidence";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { communityArtifactPath, communityFixtures, communityScreenshots, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });
const origin = COMMUNITY_TEST_ORIGIN;
const endpoint = `${origin}/api/admin/community/artworks`;

async function upload(page: Page, productId: string, description: string, filename?: string) {
  const image = filename
    ? await readFile(path.resolve("docs/design/coloring-club/assets", filename))
    : await sharp({ create: { width: 160, height: 120, channels: 3, background: "#9caa8d" } }).webp().toBuffer();
  const response = await page.request.post(`${origin}/api/community/artworks`, { headers: { Origin: origin }, multipart: {
    file: { name: filename ?? "fixture.webp", mimeType: "image/webp", buffer: image }, productId,
    description, idempotencyKey: randomUUID(), rulesAccepted: "true",
  } });
  expect([200, 201]).toContain(response.status());
  return (await response.json()).artwork as { id: string; revision: number; status: string; description: string };
}

async function decision(page: Page, id: string, revision: number, action: string, reason?: string) {
  return page.request.post(`${endpoint}/${id}/moderation`, { headers: { Origin: origin }, data: {
    action, revision, ...(reason === undefined ? {} : { reason }),
  } });
}

test("actual admin authorization, filtered pagination, conflict fencing and private audit history", async ({ page, browser }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_MODERATION_E2E !== "1" || testInfo.project.name !== "chromium",
    "Requires the isolated local Supabase application with community uploads ON.");
  test.setTimeout(240_000);
  const fixtures = await communityFixtures(testInfo);
  try {
    const owner = await fixtures.actor("moderation-owner", { username: "cc_mod_artist" });
    const outsider = await fixtures.actor("moderation-other", { username: "cc_mod_other" });
    const admin = await fixtures.actor("moderation-admin", { admin: true });
    const secondAdmin = await fixtures.actor("moderation-admin-two", { admin: true });
    const book = await fixtures.product("Moderation Garden Book");
    const secondBook = await fixtures.product("Moderation Coast Book");
    await fixtures.unlock(owner.id, book.id);
    await fixtures.unlock(owner.id, secondBook.id);
    await fixtures.unlock(outsider.id, book.id);
    expect([401, 403]).toContain((await page.request.get(endpoint)).status());
    await fixtures.login(page, owner);
    expect((await page.request.get(endpoint)).status()).toBe(403);
    const artworks = [];
    for (const [productId, description] of [[book.id, "Moderation rose study"], [book.id, "Moderation coast study"],
      [book.id, "Moderation cottage study"], [secondBook.id, "Other book study"]]) {
      artworks.push(await upload(page, productId, description));
    }
    const otherPage = await fixtures.newPage(browser);
    await fixtures.login(otherPage, outsider);
    const otherArt = await upload(otherPage, book.id, "Other creator study");
    const allIds = [...artworks.map((art) => art.id), otherArt.id];
    expect((await otherPage.request.get(`${endpoint}/${artworks[0].id}`)).status()).toBe(403);
    expect((await decision(otherPage, artworks[0].id, 1, "approve")).status()).toBe(403);
    const adminPage = await fixtures.newPage(browser);
    const secondAdminPage = await fixtures.newPage(browser);
    await fixtures.login(adminPage, admin, "/admin/community");
    await fixtures.login(secondAdminPage, secondAdmin, "/admin/community");
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let index = 0; index < 3; index++) {
      const response = await adminPage.request.get(`${endpoint}?${new URLSearchParams({ status: "all", limit: "2", ...(cursor ? { cursor } : {}) })}`);
      const body = await response.json();
      expect({ page: index, status: response.status(), error: body.error, message: body.message }).toMatchObject({ status: 200 });
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      expect(body.counts).toEqual({ pending: 5, approved: 0, rejected: 0, removed: 0 });
      seen.push(...body.items.map((item: { id: string }) => item.id));
      cursor = body.nextCursor;
    }
    expect(cursor).toBeNull();
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort()).toEqual([...allIds].sort());
    const filtered = await adminPage.request.get(`${endpoint}?${new URLSearchParams({ status: "all", productId: book.id, creator: "@CC_MOD_ARTIST" })}`);
    expect(filtered.status()).toBe(200);
    const filterBody = await filtered.json();
    expect(filterBody.items.map((item: { id: string }) => item.id).sort()).toEqual(artworks.slice(0, 3).map((art) => art.id).sort());
    expect(filterBody.counts.pending).toBe(3);
    for (const query of ["status=unknown", "limit=1000", "creator=%25", "cursor=invalid_cursor"]) {
      expect((await adminPage.request.get(`${endpoint}?${query}`)).status()).toBe(400);
    }
    expect((await decision(adminPage, artworks[1].id, 1, "reject", "  ")).status()).toBe(400);
    expect((await decision(adminPage, artworks[1].id, 1, "reject", "x".repeat(501))).status()).toBe(400);
    expect((await adminPage.request.post(`${endpoint}/${artworks[0].id}/moderation`, { data: { action: "approve", revision: 1 } })).status()).toBe(403);
    expect((await adminPage.request.post(`${endpoint}/${artworks[0].id}/moderation`, { headers: { Origin: "https://attacker.test" }, data: { action: "approve", revision: 1 } })).status()).toBe(403);
    expect((await adminPage.request.post(`${endpoint}/${artworks[0].id}/moderation`, { headers: { Origin: origin }, data: { action: "approve", revision: 1, actorUserId: secondAdmin.id } })).status()).toBe(400);
    const simultaneous = await Promise.all([decision(adminPage, artworks[0].id, 1, "approve"), decision(secondAdminPage, artworks[0].id, 1, "approve")]);
    expect(simultaneous.map((response) => response.status()).sort()).toEqual([200, 409]);
    const detail = await adminPage.request.get(`${endpoint}/${artworks[0].id}`);
    expect(detail.status()).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.artwork).toMatchObject({ id: artworks[0].id, status: "approved", revision: 2, creatorUsername: "cc_mod_artist" });
    expect(detailBody.history).toHaveLength(1);
    for (const forbidden of [owner.id, owner.email, admin.id, secondAdmin.id, "storage_path", "storagePath", "actor_user_id"]) {
      expect(JSON.stringify(detailBody)).not.toContain(forbidden);
    }
    expect((await decision(adminPage, artworks[1].id, 1, "reject", "Please share your own finished artwork.")).status()).toBe(200);
    expect((await decision(adminPage, artworks[0].id, 2, "remove", "Remove identifying information.")).status()).toBe(200);
    expect((await decision(adminPage, artworks[0].id, 3, "restore")).status()).toBe(200);
    const history = (await (await adminPage.request.get(`${endpoint}/${artworks[0].id}`)).json()).history;
    expect(history.map((event: { toStatus: string }) => event.toStatus)).toEqual(["approved", "removed", "pending"]);
    const edited = await page.request.patch(`${origin}/api/community/artworks/${artworks[2].id}`, { headers: { Origin: origin }, data: { revision: 1, description: "Revised before approval" } });
    expect(edited.status()).toBe(200);
    expect((await decision(adminPage, artworks[2].id, 1, "approve")).status()).toBe(409);
    expect((await fixtures.service.from("products").update({ status: "archived" }).eq("id", secondBook.id)).error).toBeNull();
    expect((await decision(adminPage, artworks[3].id, 1, "approve")).status()).toBe(403);
    fixtures.setEmailVerified(admin.id, false);
    expect((await adminPage.request.get(endpoint)).status()).toBe(403);
    fixtures.setEmailVerified(admin.id, true);
  } finally {
    await fixtures.cleanup();
  }
});

test("Polish moderation UI publishes, rejects, removes, restores and recovers a stale review", async ({ page, browser }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_MODERATION_E2E !== "1" || testInfo.project.name !== "chromium",
    "Requires the isolated local Supabase moderation application.");
  test.setTimeout(240_000);
  page.setDefaultTimeout(12_000);
  const fixtures = await communityFixtures(testInfo);
  const screenshots: Array<{ path: string; testedSha: string; runId: string }> = [];
  const runId = process.env.COMMUNITY_BROWSER_RUN_ID ?? "cc04-local-supabase-1";
  const runtimeErrors: string[] = [];
  const httpEvidence = communityHttpEvidence(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), runId);
  let httpDiagnostics: ReturnType<typeof httpEvidence.finish> | undefined;
  const transportFailures: Array<{ path: string; error: string | undefined; phase: string }> = [];
  let observationPhase = "fixture setup";
  const navigationAborts: Array<{ path: string; resource: string }> = [];
  const activeQueueReads = new Set<object>();
  function observe(target: Page) {
    target.on("pageerror", (error) => runtimeErrors.push(error.message));
    httpEvidence.observe(target);
    target.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname === "/api/admin/community/artworks") activeQueueReads.add(request);
    });
    const settleQueueRead = (request: object) => { activeQueueReads.delete(request); };
    target.on("requestfinished", settleQueueRead);
    target.on("requestfailed", settleQueueRead);
    target.on("requestfailed", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (request.failure()?.errorText === "net::ERR_ABORTED" && (pathname === "/en/login"
        || pathname.startsWith("/__nextjs_font/") || (request.resourceType() === "image" && pathname.startsWith("/api/community/artworks/")))) {
        navigationAborts.push({ path: pathname, resource: request.resourceType() });
      } else transportFailures.push({ path: pathname, error: request.failure()?.errorText, phase: observationPhase });
    });
  }
  observe(page);
  let cleaned = false;
  try {
    const owner = await fixtures.actor("moderation-ui-owner", { username: "cc_mod_ui_artist" });
    const admin = await fixtures.actor("moderation-ui-admin", { admin: true });
    const book = await fixtures.product("Quiet Garden Coloring Book");
    await fixtures.unlock(owner.id, book.id);
    await fixtures.login(page, owner);
    const rose = await upload(page, book.id, "Rose garden afternoon", "rose-fox.webp");
    const coast = await upload(page, book.id, "Quiet coastal colours", "coastal-light.webp");
    const cottage = await upload(page, book.id, "A peaceful cottage", "cottage.webp");
    const artworkIds = [rose.id, coast.id, cottage.id];
    await fixtures.normalizeDisplayTimestamps({ artworkIds });
    const adminPage = await fixtures.newPage(browser);
    adminPage.setDefaultTimeout(12_000);
    observe(adminPage);
    await fixtures.login(adminPage, admin, "/admin/community");
    await expect(adminPage.getByTestId("community-moderation-page")).toBeVisible();
    await expect(adminPage.getByRole("heading", { name: "Moderacja prac", exact: true })).toBeVisible();
    await expect(adminPage.getByTestId("community-moderation-item")).toHaveCount(3);
    await waitForQueueReadsToSettle();
    await waitForQueueFetch(() => adminPage.getByTestId("community-moderation-product-filter").selectOption(book.id), "product filter");
    await adminPage.getByTestId("community-moderation-author-filter").fill("@cc_mod_ui_artist");
    await waitForQueueFetch(() => adminPage.getByRole("button", { name: "Filtruj", exact: true }).click(), "author filter");
    await expect(adminPage.getByTestId("community-moderation-item")).toHaveCount(3);
    const detail = adminPage.getByTestId("community-moderation-detail");
    async function waitForQueueFetch(trigger: () => Promise<unknown>, label: string) {
      observationPhase = `${label}: waiting for request`;
      // Register before the control action so an older in-flight filter response
      // cannot satisfy this wait. Await the body as well as the response headers.
      const requestPromise = adminPage.waitForRequest((request) => {
        const url = new URL(request.url());
        return request.method() === "GET" && url.pathname === "/api/admin/community/artworks";
      });
      await trigger();
      const request = await requestPromise;
      const response = await request.response();
      if (!response) throw new Error("The moderation queue request ended without a response.");
      expect(await response.finished()).toBeNull();
      expect(response.status()).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({ ok: true });
      expect(Array.isArray(payload.items)).toBe(true);
      await waitForQueueReadsToSettle();
      observationPhase = `${label}: response body completed`;
    }
    async function waitForQueueReadsToSettle() {
      await expect.poll(() => activeQueueReads.size, { timeout: 12_000 }).toBe(0);
    }
    async function select(description: string) {
      await adminPage.getByTestId("community-moderation-item").filter({ hasText: description }).click();
      await expect(detail.getByText(description, { exact: true })).toBeVisible();
      const image = adminPage.getByTestId("community-moderation-preview");
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
    async function apply(action: string, reason?: string) {
      await adminPage.getByTestId(`community-moderation-${action}`).click();
      if (reason !== undefined) await adminPage.getByTestId("community-moderation-reason").fill(reason);
      await waitForQueueFetch(() => adminPage.getByTestId("community-moderation-confirm").click(), `moderate ${action}`);
      await expect(adminPage.getByTestId("community-moderation-confirm")).toHaveCount(0);
    }
    await select(rose.description);
    screenshots.push(...await communityScreenshots(adminPage, "cc04", "moderation-pending", runId));
    await apply("approve");
    await fixtures.normalizeDisplayTimestamps({ artworkIds });
    observationPhase = "reload after approval";
    await waitForQueueFetch(() => adminPage.reload(), "queue after approval reload");
    await expect(adminPage.getByTestId("community-count-approved")).toContainText("1");
    const visitor = await fixtures.newPage(browser);
    expect((await visitor.request.get(`${origin}/api/community/artworks/${rose.id}/media`)).status()).toBe(200);
    await select(coast.description);
    await adminPage.getByTestId("community-moderation-reject").click();
    await adminPage.getByTestId("community-moderation-confirm").click();
    await expect(adminPage.getByTestId("community-moderation-reason")).toHaveAttribute("aria-invalid", "true");
    await adminPage.getByTestId("community-moderation-reason").fill("Please share your own finished colouring.");
    screenshots.push(...await communityScreenshots(adminPage, "cc04", "moderation-rejection", runId));
    await waitForQueueFetch(() => adminPage.getByTestId("community-moderation-confirm").click(), "moderate rejection after reason preview");
    await fixtures.normalizeDisplayTimestamps({ artworkIds });
    observationPhase = "reload after rejection";
    await waitForQueueFetch(() => adminPage.reload(), "queue after rejection reload");
    await expect(adminPage.getByTestId("community-count-rejected")).toContainText("1");
    expect((await visitor.request.get(`${origin}/api/community/artworks/${coast.id}/media`)).status()).toBe(404);
    expect((await visitor.request.get(`${origin}/api/community/artworks/${cottage.id}/media`)).status()).toBe(404);
    await waitForQueueFetch(() => adminPage.getByTestId("community-moderation-status-filter").selectOption("approved"), "approved status filter");
    await select(rose.description);
    await apply("remove", "Please remove identifying information.");
    await fixtures.normalizeDisplayTimestamps({ artworkIds });
    await waitForQueueFetch(() => adminPage.reload(), "queue after removal reload");
    expect((await visitor.request.get(`${origin}/api/community/artworks/${rose.id}/media`)).status()).toBe(404);
    await waitForQueueFetch(() => adminPage.getByTestId("community-moderation-status-filter").selectOption("removed"), "removed status filter");
    await select(rose.description);
    await expect(adminPage.getByTestId("community-moderation-history")).toContainText("Please remove identifying information.");
    screenshots.push(...await communityScreenshots(adminPage, "cc04", "moderation-removal-history", runId));
    observationPhase = "owner library navigation";
    await page.goto(`${origin}/en/library/creations`);
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(3);
    await expect(page.getByText("Please share your own finished colouring.", { exact: true })).toBeVisible();
    await expect(page.getByText("Please remove identifying information.", { exact: true })).toBeVisible();
    for (const image of await page.getByTestId("community-artwork-preview").all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
    screenshots.push(...await communityScreenshots(page, "cc04", "author-review-statuses", runId));
    await apply("restore");
    await waitForQueueFetch(() => adminPage.getByTestId("community-moderation-status-filter").selectOption("pending"), "pending status filter");
    await select(rose.description);
    expect((await page.request.patch(`${origin}/api/community/artworks/${rose.id}`, { headers: { Origin: origin },
      data: { revision: 4, description: "Revised rose garden afternoon" } })).status()).toBe(200);
    await adminPage.getByTestId("community-moderation-approve").click();
    const conflictPath = `/api/admin/community/artworks/${rose.id}/moderation`;
    const conflictResponse = adminPage.waitForResponse((response) => new URL(response.url()).pathname === conflictPath && response.request().method() === "POST");
    await adminPage.getByTestId("community-moderation-confirm").click();
    await expect(adminPage.getByRole("alert").filter({ hasText: "zmieniona" })).toBeVisible();
    await httpEvidence.assertOutcome(await conflictResponse, { id: "stale-moderation-decision", path: conflictPath,
      method: "POST", status: 409, error: "conflict", details: "An author edit invalidated the displayed revision; the actual stale moderation POST returned conflict and the Polish stale-review alert appeared. Refresh and approval recovery are asserted in the same test." });
    await waitForQueueFetch(() => adminPage.getByRole("button", { name: "Odśwież", exact: true }).click(), "stale decision refresh");
    await expect(detail.getByText("Revised rose garden afternoon", { exact: true })).toBeVisible();
    await apply("approve");
    expect((await visitor.request.get(`${origin}/api/community/artworks/${rose.id}/media`)).status()).toBe(200);
    await adminPage.getByTestId("community-moderation-author-filter").fill("cc_nobody_exists");
    await waitForQueueFetch(() => adminPage.getByRole("button", { name: "Filtruj", exact: true }).click(), "empty author filter");
    await expect(adminPage.getByTestId("community-moderation-item")).toHaveCount(0);
    await expect(adminPage.getByText("Brak prac w tej kolejce.", { exact: false })).toBeVisible();
    observationPhase = "final screenshot and diagnostics";
    screenshots.push(...await communityScreenshots(adminPage, "cc04", "moderation-empty", runId));
    await waitForQueueReadsToSettle();
    expect(runtimeErrors).toEqual([]);
    expect(transportFailures).toEqual([]);
    httpDiagnostics = httpEvidence.finish();
  } finally {
    try {
      await fixtures.cleanup();
      cleaned = true;
    } finally {
      await mkdir("docs/verification/issue-77/cc04", { recursive: true });
      await writeFile(await communityArtifactPath("cc04"), `${JSON.stringify({ runId, screenshots,
        viewports: [390, 768, 1440], backend: "isolated real Supabase/Auth/Storage", runtimeErrors,
        transportFailures, navigationAborts, ...httpDiagnostics, fixtureCleanup: cleaned }, null, 2)}\n`);
    }
  }
});
