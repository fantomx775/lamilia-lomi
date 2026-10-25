import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getContentSnapshot } from "@/lib/content-store";
import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test("reader upload previews, per-image credits, placement and management persist", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "One owned fixture; desktop and mobile are checked in this browser.");
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  test.skip(!(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)), "Owned local-demo fixtures only.");
  const release = await acquireLocalContentStoreLock();
  const filename = path.resolve("data/lamilialomi-content.local.json");
  const original = fs.existsSync(filename) ? fs.readFileSync(filename) : undefined;
  const productId = "11111111-1111-4111-8111-111111111111";
  const endpoint = `/api/admin/products/${productId}/reader-artworks`;
  const editor = `/admin/products/${productId}`;
  const ids: string[] = [];
  const errors = { console: [] as string[], page: [] as string[], responses: [] as number[] };
  const output = path.resolve(process.env.READER_UX_SCREENSHOT_DIR ?? testInfo.outputDir);
  fs.mkdirSync(output, { recursive: true });
  let uploads = 0;
  page.on("console", m => { if (m.type() === "error") errors.console.push(m.text()); });
  page.on("pageerror", e => errors.page.push(e.message));
  page.on("response", r => { if (r.status() >= 400) errors.responses.push(r.status()); if (r.request().method() === "POST" && new URL(r.url()).pathname === endpoint) uploads += 1; });
  await page.addInitScript(() => { if (location.hostname === "127.0.0.1") localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })); });
  const capture = async (name: string, locator = page.getByTestId("reader-artwork-manager")) => {
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await expect.poll(() => locator.locator("img").evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)), { timeout: 20_000 }).toBe(true);
    await page.addStyleTag({ content: "nextjs-portal { display:none !important } * { caret-color:transparent !important }" });
    await locator.evaluate(element => element.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -80));
    await locator.screenshot({ path: path.join(output, name), animations: "disabled", caret: "initial" });
  };
  try {
    await page.goto("/en/login?redirectTo=/admin/products");
    await page.getByLabel("Email", { exact: true }).fill("admin@lamilialomi.test");
    await page.getByLabel("Password", { exact: true }).fill("demo-password");
    await Promise.all([page.waitForURL(u => u.pathname === "/admin/products"), page.getByRole("button", { name: "Continue", exact: true }).click()]);
    await page.goto(editor);
    await page.getByRole("textbox", { name: "Długi opis", exact: true }).waitFor();
    const manager = page.getByTestId("reader-artwork-manager");
    const picker = manager.getByRole("button", { name: "Wybierz pliki prac czytelniczek" });
    await expect(picker).toBeEnabled({ timeout: 20_000 });
    await expect(manager.getByTestId("reader-artwork-item")).toHaveCount(0);
    const headings = await page.locator("h2").allTextContents();
    expect(headings.slice(headings.indexOf("GALERIA"), headings.indexOf("GALERIA") + 3)).toEqual(["GALERIA", "Pokolorowane prace czytelniczek", "WIDEO FLIPTHROUGH"]);
    const before = getContentSnapshot();
    const originalAssets = before.products.find(p => p.id === productId)?.assets;
    expect(originalAssets).toBeDefined();
    const png = await sharp({ create: { width: 120, height: 160, channels: 3, background: "#c57b62" } }).png().toBuffer();
    await manager.getByLabel("Obrazy prac czytelniczek").setInputFiles({ name: "lila.png", mimeType: "image/png", buffer: png });
    const firstDraft = manager.getByTestId("reader-artwork-draft");
    await expect(firstDraft.getByRole("img", { name: "Podgląd lila.png" })).toBeVisible();
    await expect(firstDraft.getByRole("button", { name: "Dodaj pracę" })).toBeDisabled();
    await firstDraft.getByLabel("Pseudonim").fill("Lila");
    await firstDraft.getByLabel("Opis obrazu (opcjonalnie)").fill("Kwiaty w ciepłych kolorach");
    await page.setViewportSize({ width: 390, height: 1000 });
    await capture("preview-390.png");
    await page.setViewportSize({ width: 1440, height: 1500 });
    await picker.evaluate((element, base64) => {
      const transfer = new DataTransfer();
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      for (const name of ["mila.png", "ola.png"]) transfer.items.add(new File([bytes], name, { type: "image/png" }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, png.toString("base64"));
    await expect(manager.getByTestId("reader-artwork-draft")).toHaveCount(3);
    for (const [file, name] of [["mila.png", "Mila"], ["ola.png", "Ola"]]) await manager.getByTestId("reader-artwork-draft").filter({ hasText: file }).getByLabel("Pseudonim").fill(name);
    expect(uploads).toBe(0);
    await capture("previews-1440.png");
    for (const file of ["lila.png", "mila.png", "ola.png"]) {
      const response = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === endpoint);
      await manager.getByTestId("reader-artwork-draft").filter({ hasText: file }).getByRole("button", { name: "Dodaj pracę" }).click();
      const uploaded = await response;
      expect(uploaded.status()).toBe(201);
      ids.push((await uploaded.json()).artwork.id);
    }
    const rows = manager.getByTestId("reader-artwork-item");
    await expect(rows).toHaveCount(3);
    await expect(manager.getByTestId("reader-artwork-draft")).toHaveCount(0);
    await expect(rows.first().getByRole("button", { name: "Przesuń wyżej" })).toBeDisabled();
    await expect(rows.last().getByRole("button", { name: "Przesuń niżej" })).toBeDisabled();
    await rows.last().getByRole("button", { name: "Przesuń wyżej" }).click();
    await expect(rows.locator("strong")).toHaveText(["Colored by Lila", "Colored by Ola", "Colored by Mila"]);
    await rows.first().getByRole("button", { name: "Przesuń niżej" }).click();
    await expect(rows.locator("strong")).toHaveText(["Colored by Ola", "Colored by Lila", "Colored by Mila"]);
    await rows.nth(1).getByRole("button", { name: "Edytuj" }).click();
    await rows.nth(1).getByLabel("Pseudonim").fill("Lila M.");
    await rows.nth(1).getByLabel("Opis alternatywny").fill("Poprawiony opis");
    await rows.nth(1).getByRole("button", { name: "Zapisz", exact: true }).click();
    await expect(rows.nth(1)).toContainText("Colored by Lila M.");
    await page.reload();
    await expect(rows.locator("strong")).toHaveText(["Colored by Ola", "Colored by Lila M.", "Colored by Mila"]);
    await expect(rows.nth(1)).toContainText("Poprawiony opis");
    await capture("management-1440.png");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture("management-390.png", rows.first());
    page.once("dialog", d => d.accept());
    await rows.first().getByRole("button", { name: "Usuń", exact: true }).click();
    await expect(rows).toHaveCount(2);
    await rows.last().getByRole("button", { name: "Ukryj", exact: true }).click();
    await expect(rows.last()).toContainText("Ukryta");
    await page.goto("/en/products/moon-garden-coloring-book");
    await expect(page.getByTestId("reader-artwork-grid").getByRole("button")).toHaveCount(1);
    await expect(page.getByText("Colored by Lila M.", { exact: true })).toBeVisible();
    await page.goto(editor);
    await expect(rows).toHaveCount(2);
    await rows.last().getByRole("button", { name: "Pokaż", exact: true }).click();
    await expect(rows.last()).toContainText("Widoczna publicznie");
    const after = JSON.parse(fs.readFileSync(filename, "utf8"));
    expect(after.products.find((p: { id: string }) => p.id === productId).assets).toEqual(originalAssets);
    expect(errors).toEqual({ console: [], page: [], responses: [] });
    fs.writeFileSync(path.join(output, "browser-diagnostics.json"), JSON.stringify({ errors, uploads, originalAssetsPreserved: true }, null, 2));
  } finally {
    try {
      for (const id of ids) { const r = await page.request.delete(endpoint, { data: { id } }); expect([200, 404]).toContain(r.status()); }
    } finally {
      try { await page.goto("about:blank"); }
      finally {
        try { if (original) fs.writeFileSync(filename, original); else if (fs.existsSync(filename)) fs.unlinkSync(filename); }
        finally { release(); }
      }
    }
  }
});
