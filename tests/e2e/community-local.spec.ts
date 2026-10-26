import { expect, test } from "@playwright/test";
import { readFile, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { essentials } from "./helpers/community-fixtures";

test.use({ trace: "off", screenshot: "off", video: "off" });

test("local demo persists a private upload and safely edits and deletes its actual file", async ({ page, browser }, testInfo) => {
  test.skip(process.env.RUN_COMMUNITY_LOCAL_E2E !== "1" || testInfo.project.name !== "chromium",
    "Requires an explicitly isolated local-demo server with both community flags ON.");
  test.setTimeout(90_000);
  if (testInfo.project.use.baseURL !== "http://127.0.0.1:3100" || process.env.LAMILIA_BACKEND !== "local") {
    throw new Error("Unexpected local-demo test target.");
  }
  const file = path.resolve("data/lamilialomi-community.local.json");
  if (await stat(file).then(() => true, () => false)) throw new Error("Preserve existing local community data; this fixture requires a clean dedicated worktree.");
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  try {
    await page.goto("/en/login?returnTo=%2Fen%2Faccount");
    await page.getByLabel("Email", { exact: true }).fill("demo@lamilialomi.test");
    await page.getByLabel("Password", { exact: true }).fill("demo-password");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL("http://127.0.0.1:3100/en/account");
    await essentials(page);
    const panel = page.getByTestId("community-account-panel");
    await panel.getByLabel("Public username", { exact: true }).fill("cc_local_demo_artist");
    await panel.getByRole("checkbox", { name: /18|adult/i }).check();
    await panel.getByRole("checkbox", { name: /I accept the current community guidelines/ }).check();
    await panel.getByRole("button", { name: "Join the Coloring Club", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("You joined");
    await page.getByRole("link", { name: "My Creations", exact: true }).click();
    await expect(page.getByRole("heading", { name: "My Creations", exact: true })).toBeVisible();
    await page.getByTestId("community-upload-open").click();
    await page.getByTestId("community-product-select").selectOption("11111111-1111-4111-8111-111111111111");
    await page.getByTestId("community-upload-file-input").setInputFiles(path.resolve("docs/design/coloring-club/assets/rose-fox.webp"));
    await page.getByTestId("community-selected-artwork").getByRole("textbox").fill("Local private garden fixture");
    await page.getByTestId("community-upload-rules").check();
    await page.getByTestId("community-upload-submit").click();
    const cards = page.getByTestId("community-artwork-card");
    await expect(cards).toHaveCount(1);
    await expect(page.locator('[data-slot="admin-drawer"]')).toHaveCount(0);
    await page.reload();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("Pending review");
    const image = cards.getByTestId("community-artwork-preview");
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const snapshot = JSON.parse(await readFile(file, "utf8"));
    expect(snapshot.artworks).toHaveLength(1);
    const storedFile = path.resolve("data/.collection-media", snapshot.artworks[0].storagePath);
    expect((await stat(storedFile)).size).toBeGreaterThan(0);
    await adminPage.goto("http://127.0.0.1:3100/en/login?returnTo=%2Fadmin%2Fcommunity");
    await adminPage.getByLabel("Email", { exact: true }).fill("admin@lamilialomi.test");
    await adminPage.getByLabel("Password", { exact: true }).fill("demo-password");
    await adminPage.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(adminPage).toHaveURL("http://127.0.0.1:3100/admin/community");
    await expect(adminPage.getByTestId("community-moderation-item")).toHaveCount(1);
    await adminPage.getByTestId("community-moderation-approve").click();
    await adminPage.getByTestId("community-moderation-confirm").click();
    await expect(adminPage.getByTestId("community-count-approved")).toContainText("1");
    await page.reload();
    await expect(cards).toContainText("Published");
    const artworkId = snapshot.artworks[0].id;
    await page.goto(`http://127.0.0.1:3100/en/club/artworks/${artworkId}`);
    const heart = page.getByTestId("community-heart-toggle");
    await heart.click();
    await expect(heart).toBeEnabled();
    await expect(heart).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("community-heart-count")).toHaveText("1");
    await page.reload();
    await expect(heart).toHaveAttribute("aria-pressed", "true");
    const repeated = await Promise.all([1, 2].map(() => page.request.put(`http://127.0.0.1:3100/api/community/artworks/${artworkId}/heart`, {
      headers: { Origin: "http://127.0.0.1:3100" },
    })));
    for (const response of repeated) {
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ liked: true, likesCount: 1 });
    }
    await heart.click();
    await expect(heart).toBeEnabled();
    await expect(heart).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("community-heart-count")).toHaveText("0");
    await page.goto("http://127.0.0.1:3100/en/library/creations");
    await cards.getByTestId("community-artwork-edit-description").click();
    await cards.getByTestId("community-artwork-description").fill("Updated local garden fixture");
    await cards.getByTestId("community-artwork-save-description").click();
    await expect(page.getByRole("status").filter({ hasText: "Your description was saved" })).toBeVisible();
    await expect(cards).toContainText("Revision 3");
    await expect(cards).toContainText("Pending review");
    await expect(cards).toContainText("Updated local garden fixture");
    await cards.getByTestId("community-artwork-delete").click();
    await cards.getByRole("button", { name: "Keep artwork", exact: true }).click();
    await cards.getByTestId("community-artwork-delete").click();
    await cards.getByTestId("community-artwork-confirm-delete").click();
    await expect(cards).toHaveCount(0);
    await expect(stat(storedFile)).rejects.toMatchObject({ code: "ENOENT" });
    await page.reload();
    await expect(cards).toHaveCount(0);
  } finally {
    await adminContext.close();
    const snapshot = await readFile(file, "utf8").then((text) => JSON.parse(text), () => null);
    if (snapshot) {
      if (snapshot.profiles.length !== 1 || snapshot.profiles[0].username !== "cc_local_demo_artist") {
        throw new Error("Local fixture cleanup refused: unexpected community records.");
      }
      for (const artwork of snapshot.artworks) {
        const expectedPrefix = `community/${snapshot.profiles[0].userId}/`;
        if (!artwork.storagePath.startsWith(expectedPrefix) || !/^community\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(artwork.storagePath)) {
          throw new Error("Refusing unexpected local fixture image path.");
        }
        await rm(path.resolve("data/.collection-media", artwork.storagePath), { force: true });
      }
      await unlink(file);
    }
  }
});
