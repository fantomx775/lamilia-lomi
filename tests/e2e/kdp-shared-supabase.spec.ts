import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });
const productId = "11111111-1111-4111-8111-111111111111";
const assetId = "11111111-1111-4111-8111-111111111105";
const slug = "moon-garden-coloring-book";

test("real shared QR: concurrent readers, renamed book, cross-device email confirmation and private download", async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  test.skip(process.env.RUN_KDP_SUPABASE_E2E !== "1", "Requires explicitly configured isolated local Supabase.");
  test.skip(info.project.name !== "chromium", "Mutates isolated database fixtures once.");
  const app = new URL(process.env.PLAYWRIGHT_BASE_URL!);
  const api = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (app.hostname !== "127.0.0.1" || app.port !== "3031" || api.hostname !== "127.0.0.1" || api.port !== "57321") throw new Error("KDP integration requires the dedicated loopback app/database.");
  const admin = createClient(api.href, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const users: string[] = [];
  const credentials = [0, 1, 2].map(() => ({ email: `kdp-${randomUUID()}@example.test`, password: `${randomBytes(20).toString("hex")}A1!` }));
  const objectPath = `products/${productId}/premium_download/kdp-${randomUUID()}.pdf`;
  const originalAsset = await admin.from("product_assets").select("path,size_bytes").eq("id", assetId).single();
  expect(originalAsset.error).toBeNull();
  const existing = await admin.from("premium_codes").select("id,code,active").eq("product_id", productId).eq("code_type", "shared").maybeSingle();
  expect(existing.error).toBeNull();
  const codeId = existing.data?.id ?? randomUUID();
  const code = existing.data?.code ?? `KDP-${randomBytes(16).toString("hex").toUpperCase()}`;
  const changedSlug = `kdp-book-${randomBytes(5).toString("hex")}`;
  const context = await browser.newContext({ baseURL: app.origin, ignoreHTTPSErrors: true });
  try {
    const codeChange = existing.data
      ? await admin.from("premium_codes").update({ active: true }).eq("id", codeId)
      : await admin.from("premium_codes").insert({ id: codeId, product_id: productId, code, active: true, code_type: "shared" });
    expect(codeChange.error).toBeNull();
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
    expect((await admin.storage.from("premium-files").upload(objectPath, pdf, { contentType: "application/pdf" })).error).toBeNull();
    expect((await admin.from("product_assets").update({ path: objectPath, size_bytes: pdf.length }).eq("id", assetId)).error).toBeNull();
    const clients = [];
    for (const credential of credentials.slice(0, 2)) {
      const created = await admin.auth.admin.createUser({ ...credential, email_confirm: true });
      if (created.error || !created.data.user) throw new Error("Could not create local reader.");
      users.push(created.data.user.id);
      const client = createClient(api.href, anon, { auth: { persistSession: false, autoRefreshToken: false } });
      expect((await client.auth.signInWithPassword(credential)).error).toBeNull();
      clients.push(client);
    }
    const activations = await Promise.all(clients.flatMap(client => [0, 1].map(() => client.rpc("redeem_premium_code", { requested_product_id: productId, requested_code: code }))));
    expect(activations.every(result => !result.error)).toBe(true);
    expect(activations.filter(result => result.data?.status === "success")).toHaveLength(2);
    expect(activations.filter(result => result.data?.status === "already_unlocked")).toHaveLength(2);
    expect((await admin.from("user_product_unlocks").select("id").eq("premium_code_id", codeId)).data).toHaveLength(2);
    expect((await admin.from("products").update({ slug: changedSlug }).eq("id", productId)).error).toBeNull();
    const leaks: string[] = [];
    page.on("request", request => { if (request.url().includes(code)) leaks.push("code in request URL"); });
    await page.goto(`/en/unlock/${productId}#code=${code}&productId=${productId}`);
    await expect(page).toHaveURL(new RegExp(`/en/products/${changedSlug}#premium$`));
    await page.getByTestId("product-unlock-section").getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByLabel("Email").fill(credentials[2].email);
    await page.getByLabel("Password").fill(credentials[2].password);
    await page.getByRole("checkbox", { name: /Terms/ }).check();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByTestId("unlock-guest-state")).toBeVisible();
    const confirmation = await readConfirmation(credentials[2].email);
    expect(confirmation.includes(code)).toBe(false);
    const verified = await context.newPage();
    await verified.goto(confirmation);
    await expect(verified.getByTestId("unlock-success-state")).toBeVisible();
    const userList = await admin.auth.admin.listUsers();
    const registered = userList.data.users.find(user => user.email === credentials[2].email);
    if (!registered) throw new Error("Registered isolated account missing.");
    users.push(registered.id);
    const download = await context.request.get(`/api/downloads/${assetId}?locale=en`, { maxRedirects: 0 });
    expect(download.status()).toBe(200);
    expect(download.headers()["content-type"]).toContain("application/pdf");
    expect(download.headers()["location"]).toBeUndefined();
    expect(await download.body()).toEqual(pdf);
    const publicFile = await fetch(`${api.origin}/storage/v1/object/public/premium-files/${objectPath}`);
    expect(publicFile.ok).toBe(false);
    const screenshot = path.resolve("docs/verification/pr-102", "supabase-cross-device-unlocked.png");
    await mkdir(path.dirname(screenshot), { recursive: true });
    await verified.screenshot({ path: screenshot });
    await verified.goto(`/en/unlock/${productId}#code=${code}&productId=${productId}`);
    await expect(verified.getByTestId("unlock-success-state")).toBeVisible();
    // Historical slug-only printed links resolve even though the product was renamed.
    const oldQr = await context.request.get(`/api/unlock/en/${slug}`, { maxRedirects: 0 });
    expect(oldQr.headers().location).toContain(`/en/products/${changedSlug}`);
    const oldProduct = await context.request.get(
      `/en/products/${slug}?utm_source=legacy-qr&ref=preserved`,
      { maxRedirects: 0 },
    );
    expect(oldProduct.status()).toBe(308);
    expect(oldProduct.headers().location).toBe(
      `http://127.0.0.1:3031/en/products/${changedSlug}?utm_source=legacy-qr&ref=preserved`,
    );
    expect(leaks).toEqual([]);
    expect((await admin.from("premium_codes").update({ active: false }).eq("id", codeId)).error).toBeNull();
    await verified.reload();
    await expect(verified.getByTestId("unlock-success-state")).toBeVisible();
    expect((await context.request.get(`/api/downloads/${assetId}?locale=en`)).status()).toBe(200);
  } finally {
    await context.close();
    // Local-only persistent shared fixture is deactivated, never deleted or rotated.
    await admin.from("premium_codes").update({ active: existing.data?.active ?? false }).eq("id", codeId);
    await admin.from("products").update({ slug }).eq("id", productId);
    if (originalAsset.data) await admin.from("product_assets").update(originalAsset.data).eq("id", assetId);
    await admin.storage.from("premium-files").remove([objectPath]);
    const all = await admin.auth.admin.listUsers();
    for (const user of all.data.users.filter(user => credentials.some(credential => credential.email === user.email))) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }
});

async function readConfirmation(email: string) {
  const mail = "http://127.0.0.1:57324";
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await (await fetch(`${mail}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const id = search.messages?.[0]?.ID;
    if (id) {
      const detail = await (await fetch(`${mail}/api/v1/message/${id}`)).json();
      const content = `${detail.Text ?? ""}\n${detail.HTML ?? ""}`.replace(/&amp;/g, "&");
      for (const candidate of content.match(/https?:\/\/[^\s<>"']+/g) ?? []) {
        const url = new URL(candidate.replace(/[),.;]+$/, ""));
        if (url.hostname === "127.0.0.1" && url.port === "3031" && url.pathname === "/auth/callback" && url.searchParams.has("token_hash")) return url.href;
      }
      throw new Error("Missing local confirmation callback.");
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("No local confirmation email delivered.");
}
