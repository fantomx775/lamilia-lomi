import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

test("admin reads authorize every page before querying protected tables", async ({ browser, context, page }, testInfo) => {
  test.skip(process.env.RUN_ADMIN_READ_SUPABASE_E2E !== "1", "Requires an explicitly owned isolated Supabase stack.");
  test.setTimeout(240_000);
  const appUrl = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "");
  const apiUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (appUrl.origin !== "https://localhost:3443" || apiUrl.origin !== "http://127.0.0.1:55421" ||
    apiUrl.pathname !== "/" || apiUrl.search || apiUrl.hash || apiUrl.username || apiUrl.password ||
    appUrl.pathname !== "/" || appUrl.search || appUrl.hash || appUrl.username || appUrl.password ||
    process.env.LAMILIA_BACKEND !== "supabase") {
    throw new Error("Admin regression fixtures only support the exclusive loopback test stack.");
  }
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !secret) throw new Error("Isolated fixture keys are missing.");
  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(apiUrl.origin, secret, clientOptions);
  const anonymous = createClient(apiUrl.origin, key, clientOptions);
  const password = `Admin-${randomUUID()}-9!`;
  const userIds: string[] = [];
  const contexts: BrowserContext[] = [];
  const token = randomUUID();
  const productId = randomUUID();
  const collectionId = randomUUID();
  const errors: string[] = [];
  const networkFailures: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", (request) => networkFailures.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  const evidence = path.resolve("docs/verification/issue-94");

  async function account(role: "admin" | "user") {
    const email = `admin-read-${role}-${token}@example.test`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true,
      user_metadata: { role: "admin", terms_accepted: true, preferred_locale: "en" } });
    expect(created.error).toBeNull();
    const id = created.data.user!.id;
    userIds.push(id);
    if (role === "admin") expect((await service.from("profiles").update({ role }).eq("id", id)).error).toBeNull();
    return { email, id };
  }

  async function signIn(target: BrowserContext, email: string) {
    const client = createServerClient(apiUrl.origin, key!, { cookies: {
      getAll: () => [],
      setAll: async (cookies) => {
        await target.addCookies(cookies.map(({ name, value, options }) => ({ name, value,
          domain: appUrl.hostname, path: options.path ?? "/", secure: true,
          httpOnly: options.httpOnly ?? false, sameSite: "Lax" as const })));
      },
    } });
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    return client;
  }

  const paths = ["/admin", "/admin/products", "/admin/products/new", `/admin/products/${productId}`,
    "/admin/collections", "/admin/pages/about", "/admin/pages/privacy", "/admin/pages/terms"];
  async function denied(target: BrowserContext) {
    for (const pathname of paths) {
      const response = await target.request.get(`${appUrl.origin}${pathname}`, { timeout: 90_000 });
      const html = await response.text();
      // The edit page intentionally calls notFound() for the empty denied
      // snapshot. Next may commit the layout's 200 before streaming that 404.
      expect(pathname === `/admin/products/${productId}` ? [200, 404] : [200]).toContain(response.status());
      expect(html).toContain("Brak dostępu");
      // RSC failures can be hidden behind a successful HTML status and denial UI.
      const digests = [...html.matchAll(/\\?"digest\\?":\\?"([^"\\]+)\\?"/g)].map((match) => match[1]);
      expect(digests.every((digest) => pathname === `/admin/products/${productId}` && digest === "NEXT_HTTP_ERROR_FALLBACK;404")).toBe(true);
      expect(html).not.toContain("permission denied");
      expect(html).not.toContain("Admin regression private book");
      expect(html).not.toContain("ADMIN-READ-PRIVATE-CODE");
    }
  }

  try {
    const admin = await account("admin");
    const user = await account("user");
    expect((await service.from("products").insert({ id: productId, slug: `admin-read-${token}`, status: "draft",
      audience: "adults", product_type: "coloring-book" })).error).toBeNull();
    expect((await service.from("product_translations").insert({ product_id: productId, locale: "en",
      title: "Admin regression private book", short_description: "Owned isolated fixture", long_description: "Owned isolated fixture" })).error).toBeNull();
    expect((await service.from("collections").insert({ id: collectionId, name: `Admin read ${token}`, slug: `admin-read-${token}` })).error).toBeNull();
    expect((await service.from("product_collections").insert({ product_id: productId, collection_id: collectionId })).error).toBeNull();
    expect((await service.from("premium_codes").insert({ product_id: productId, code: `ADMIN-READ-PRIVATE-CODE-${token}` })).error).toBeNull();

    await denied(context);
    await page.goto("/admin/products/new");
    await expect(page.getByRole("heading", { name: "Brak dostępu" })).toBeVisible();
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, `denied-${testInfo.project.name}.png`) });

    const regular = await browser.newContext({ ignoreHTTPSErrors: true });
    contexts.push(regular);
    const regularClient = await signIn(regular, user.email);
    await denied(regular);
    const expired = await browser.newContext({ ignoreHTTPSErrors: true });
    contexts.push(expired);
    await expired.addCookies([{ name: "sb-127-auth-token", value: "base64-expired-invalid-session", domain: appUrl.hostname,
      path: "/", secure: true, sameSite: "Lax" }]);
    await denied(expired);

    const adminClient = await signIn(context, admin.email);
    for (const table of ["collections", "product_collections", "premium_codes"]) {
      expect((await anonymous.from(table).select("id").limit(1)).error?.code).toBe("42501");
      const regularRows = await regularClient.from(table).select("id").limit(1);
      expect(regularRows.error).toBeNull();
      expect(regularRows.data).toEqual([]);
      const adminRows = await adminClient.from(table).select("id").limit(1);
      expect(adminRows.error).toBeNull();
      expect(adminRows.data).toHaveLength(1);
    }
    for (const pathname of paths) {
      const response = await context.request.get(`${appUrl.origin}${pathname}`, { timeout: 90_000 });
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect(html).not.toMatch(/:E\{\\?"digest/);
      expect(html).not.toContain("permission denied");
      expect(html).not.toContain("Panel admina jest dostępny tylko");
    }
    await page.goto("/admin/products/new");
    await expect(page.getByRole("heading", { name: "Nowy produkt" })).toBeVisible();
    await page.screenshot({ path: path.join(evidence, `editor-${testInfo.project.name}.png`) });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Nowy produkt" })).toBeVisible();
    const publicResponse = await anonymous.from("products").select("id").eq("id", productId);
    expect(publicResponse.error).toBeNull();
    expect(publicResponse.data).toEqual([]);
    expect(errors).toEqual([]);
    expect(networkFailures).toEqual([]);
    if (process.env.ADMIN_READ_BROWSER_EVIDENCE_PATH) {
      await writeFile(`${process.env.ADMIN_READ_BROWSER_EVIDENCE_PATH}-${testInfo.project.name}.json`, JSON.stringify({
        testedSha: process.env.ADMIN_READ_TESTED_SHA, runId: process.env.ADMIN_READ_RUN_ID,
        project: testInfo.project.name, paths, roles: ["anonymous", "regular", "invalid-session", "admin"],
        consoleErrors: errors, failedNetworkRequests: networkFailures, persistence: "editor remains available after reload",
        screenshots: [`docs/verification/issue-94/denied-${testInfo.project.name}.png`, `docs/verification/issue-94/editor-${testInfo.project.name}.png`],
      }, null, 2));
    }
  } finally {
    for (const target of contexts) await target.close();
    expect((await service.from("products").delete().eq("id", productId)).error).toBeNull();
    expect((await service.from("collections").delete().eq("id", collectionId)).error).toBeNull();
    for (const id of userIds) expect((await service.auth.admin.deleteUser(id)).error).toBeNull();
  }
});
