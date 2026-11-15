import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { communityFixtures, COMMUNITY_TEST_ORIGIN, communityArtifactPath } from "./helpers/community-fixtures";

test.use({ ignoreHTTPSErrors: true });
test.setTimeout(90_000);
test("moderation hydrates real first batch and preserves only correctly scoped loading data", async ({ page }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_UPLOADS_E2E !== "1" || !["chromium", "webkit-mobile"].includes(testInfo.project.name),
    "Requires isolated real Supabase/Auth/Storage and community flags.");
  const fixtures = await communityFixtures(testInfo);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  try {
    const owner = await fixtures.actor("loading-owner", { username: `loading_${randomUUID().slice(0, 8)}` });
    const admin = await fixtures.actor("loading-admin", { admin: true });
    const book = await fixtures.product("Moderation loading regression");
    await fixtures.unlock(owner.id, book.id);
    await fixtures.login(page, owner);
    const bytes = await sharp({ create: { width: 100, height: 120, channels: 3, background: "#accbaa" } }).png().toBuffer();
    const upload = await page.request.post(`${COMMUNITY_TEST_ORIGIN}/api/community/artworks`, {
      headers: { Origin: COMMUNITY_TEST_ORIGIN }, multipart: { file: { name: "loading.png", mimeType: "image/png", buffer: bytes }, productId: book.id, description: "Moderation initial SSR work", idempotencyKey: randomUUID(), rulesAccepted: "true" },
    });
    expect(upload.status()).toBe(200);
    const id = (await upload.json()).artwork.id;
    const queueReads: string[] = [];
    page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/admin/community/artworks") queueReads.push(request.url()); });
    await fixtures.login(page, admin, "/admin/community");
    await expect(page.getByTestId("community-moderation-item").filter({ hasText: owner.email })).toHaveCount(0);
    await expect(page.getByTestId("community-count-pending")).not.toHaveText("Do sprawdzenia0");
    await expect(page.getByTestId("community-count-skeleton")).toHaveCount(0);
    expect(queueReads).toHaveLength(0); // server queue and detail, no hydration fetch waterfall
    const apiTimes: number[] = [];
    for (let sample = 0; sample < 7; sample++) {
      const start = performance.now();
      const response = await page.request.get(`${COMMUNITY_TEST_ORIGIN}/api/admin/community/artworks?status=pending&limit=30&productId=${book.id}`);
      expect(response.status()).toBe(200);
      expect((await response.json()).counts.pending).toBe(1);
      if (sample > 1) apiTimes.push(performance.now() - start);
    }
    console.log(JSON.stringify({ moderationApi: "authenticated loopback final implementation", samples: apiTimes.length, medianMs: +apiTimes.sort((a, b) => a - b)[2].toFixed(3) }));
    await page.getByTestId("community-moderation-product-filter").selectOption(book.id);
    await expect(page.getByTestId("community-moderation-queue")).toContainText("loading_");
    await expect(page.getByTestId("community-moderation-preview")).toHaveAttribute("src", `/api/community/artworks/${id}/media`);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/admin/community/artworks?**", async (route) => { await barrier; await route.continue(); });
    await page.getByRole("button", { name: "Filtruj", exact: true }).click();
    await expect(page.getByText("Odświeżanie prac…")).toBeVisible();
    await expect(page.getByTestId("community-count-pending")).toContainText("1");
    await expect(page.getByTestId("community-moderation-item")).toHaveCount(1);
    release();
    await expect(page.getByText("Odświeżanie prac…")).toHaveCount(0);
    await page.unroute("**/api/admin/community/artworks?**");
    await page.getByTestId("community-moderation-status-filter").selectOption("approved");
    await expect(page.getByText(/Brak prac w tej kolejce/)).toBeVisible();
    await expect(page.getByTestId("community-count-approved")).toContainText("0");
    if (process.env.COMMUNITY_ARTIFACT_DIR) await page.screenshot({ path: await communityArtifactPath("issue-121", `moderation-empty-${testInfo.project.name}.png`) });
    expect(errors).toEqual([]);
  } finally { await fixtures.cleanup(); }
});
