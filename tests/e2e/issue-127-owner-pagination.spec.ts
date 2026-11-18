import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { communityFixtures, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

test("F29 owner reaches tied-timestamp artwork 52 and persists edit/delete with access isolation", async ({ page, browser }, testInfo) => {
  test.skip(process.env.RUN_ISSUE_127_OWNER_E2E !== "1", "Requires guarded exclusive local Supabase/Auth/Storage and upload flags ON.");
  test.setTimeout(240_000);
  const fixture = await communityFixtures(testInfo);
  const runId = `ux127-owner-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
  const screenshotBase = `ux127-owner-${testInfo.project.name}`;
  const manifestDirectory = path.resolve(".task/ux127/runtime-manifests");
  const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  try {
    const owner = await fixture.actor("owner-pages", { username: `owner_${randomUUID().slice(0, 8)}` });
    const outsider = await fixture.actor("owner-stranger", { username: `other_${randomUUID().slice(0, 8)}` });
    const admin = await fixture.actor("owner-admin", { admin: true });
    const book = await fixture.product("Owner pagination book");
    await fixture.unlock(owner.id, book.id);
    const image = await sharp({ create: { width: 120, height: 160, channels: 3, background: "#a4b49c" } }).webp().toBuffer();
    const timestamp = new Date().toISOString();
    const ids = Array.from({ length: 52 }, () => randomUUID()).sort().reverse();
    // Direct fixture creation deliberately bypasses upload pacing, not application authorization.
    for (const id of ids) {
      const storagePath = `community/${owner.id}/${id}`;
      expect((await fixture.service.storage.from("collection-media").upload(storagePath, image, { contentType: "image/webp" })).error).toBeNull();
    }
    expect((await fixture.service.from("community_artworks").insert(ids.map((id, index) => ({ id, author_id: owner.id, product_id: book.id,
      storage_path: `community/${owner.id}/${id}`, storage_provider: "supabase", content_type: "image/webp", size_bytes: image.length,
      description: `Owner page ${index + 1}`, status: "pending", revision: 1, created_at: timestamp, updated_at: timestamp })))).error).toBeNull();
    await fixture.login(page, owner);
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(50);
    const firstPage = await page.request.get(`${COMMUNITY_TEST_ORIGIN}/api/community/my-artworks`);
    expect(firstPage.status()).toBe(200);
    const cursor = (await firstPage.json()).nextCursor as string;
    expect(cursor).toBeTruthy();
    let injectedFailure = false;
    await page.route("**/api/community/my-artworks?cursor=*", async (route) => {
      if (!injectedFailure) { injectedFailure = true; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) }); }
      else await route.continue();
    });
    await page.getByTestId("community-my-artworks-more").click();
    await expect(page.getByRole("alert").filter({ hasText: "Your older artworks could not be loaded" })).toBeVisible();
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(50);
    await page.getByTestId("community-my-artworks-more").click();
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(52);
    await expect(page.getByTestId("community-my-artworks-more")).toHaveCount(0);
    expect(await page.getByTestId("community-artwork-card").evaluateAll((nodes) => nodes.map((node) => node.id.replace("creation-", "")))).toEqual(ids);
    const oldest = page.locator(`#creation-${ids[51]}`);
    await oldest.getByTestId("community-artwork-actions").click();
    await oldest.getByTestId("community-artwork-edit-description").click();
    await oldest.getByTestId("community-artwork-description").fill("Oldest artwork edited on real backend");
    const savedDescription = page.waitForResponse((response) => {
      const target = new URL(response.url());
      return response.request().method() === "PATCH" && target.origin === COMMUNITY_TEST_ORIGIN
        && target.pathname === `/api/community/artworks/${ids[51]}`;
    });
    await oldest.getByTestId("community-artwork-save-description").click();
    const savedResponse = await savedDescription;
    expect(savedResponse.status()).toBe(200);
    const savedPayload = await savedResponse.json();
    expect(savedPayload.ok).toBe(true);
    expect(savedPayload.artwork).toMatchObject({ id: ids[51], description: "Oldest artwork edited on real backend", revision: 2 });
    // A textarea already contains its draft before PATCH finishes. The editor
    // must close on the confirmed response before rendered text or DB proves save.
    await expect(oldest.getByTestId("community-artwork-description")).toHaveCount(0);
    await expect(oldest.getByTestId("community-artwork-save-description")).toHaveCount(0);
    await expect(oldest).toContainText("Oldest artwork edited on real backend");
    const readback = await fixture.service.from("community_artworks").select("description,revision").eq("id", ids[51]).single();
    expect(readback.error).toBeNull();
    expect(readback.data).toMatchObject({ description: "Oldest artwork edited on real backend", revision: 2 });
    await page.reload();
    await page.getByTestId("community-my-artworks-more").click();
    await expect(oldest).toContainText("Oldest artwork edited on real backend");
    await oldest.getByTestId("community-artwork-actions").click();
    await oldest.getByTestId("community-artwork-delete").click();
    await page.getByTestId("community-artwork-confirm-delete").click();
    await expect(oldest).toHaveCount(0);
    const deleted = await fixture.service.from("community_artworks").select("deleted_at").eq("id", ids[51]).single();
    expect(deleted.data?.deleted_at).toBeTruthy();
    await page.reload();
    await page.getByTestId("community-my-artworks-more").click();
    await expect(page.getByTestId("community-artwork-card")).toHaveCount(51);
    await expect(oldest).toHaveCount(0);
    for (const actor of [outsider, admin]) {
      const otherPage = await fixture.newPage(browser);
      await fixture.login(otherPage, actor);
      const response = await otherPage.request.get(`${COMMUNITY_TEST_ORIGIN}/api/community/my-artworks?cursor=${encodeURIComponent(cursor)}`);
      expect(response.status()).toBe(200);
      expect((await response.json()).items).toEqual([]);
    }
    const anonymous = await fixture.newPage(browser);
    expect((await anonymous.request.get(`${COMMUNITY_TEST_ORIGIN}/api/community/my-artworks?cursor=${encodeURIComponent(cursor)}`)).status()).toBe(401);
    const directory = path.resolve("docs/verification/issue-127");
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `${screenshotBase}.png`), fullPage: true });
    await mkdir(manifestDirectory, { recursive: true });
    await writeFile(path.join(manifestDirectory, `${runId}.json`), JSON.stringify({ testedSha, runId, status: "PASS", browser: testInfo.project.name,
      checks: ["52 tied timestamps without duplicate or omission", "failed page keeps 50 rows", "real edit and revision readback", "reload", "real delete and reload", "owner/stranger/admin/anonymous isolation"],
      screenshots: [{ path: `docs/verification/issue-127/${screenshotBase}.png`, testedSha, runId }] }, null, 2));
  } finally { await fixture.cleanup(); }
});
