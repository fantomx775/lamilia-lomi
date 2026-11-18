import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { communityFixtures, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";
import { loadIsolatedCommunityTarget } from "../../scripts/testing/isolated-community-target.mjs";

// Actual local backend faults, intentionally separate from clean primary records.
// No mocked503, changed RLS/grants/schema or application test-only feature.
test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

type Relation = "products" | "community_artworks";
async function holdOwnRelation(relation: Relation) {
  const target = loadIsolatedCommunityTarget();
  const args = ["exec", "-i", target.databaseContainerId, "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"];
  const options = { env: { ...process.env, DOCKER_HOST: target.dockerEndpoint, DOCKER_CONTEXT: "" }, windowsHide: true };
  const child = spawn(target.dockerExecutable, args, options);
  child.stderr.resume(); child.stdin.on("error", () => undefined);
  let output = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = new Promise<number>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Controlled relation lock acquisition timed out.")), 15_000);
    child.on("error", () => reject(new Error("Controlled local database fixture process could not start.")));
    child.on("exit", () => { if (!output.includes("UX127_ROUTE_LOCK:")) reject(new Error("Controlled lock process exited before acquisition.")); });
    child.stdout.on("data", (part) => { output += part.toString(); const found = output.match(/UX127_ROUTE_LOCK:(\d+)/); if (found) resolve(Number(found[1])); });
  });
  // Relation is a closed union of two literals, never a user-supplied SQL name.
  child.stdin.write(`BEGIN; SET LOCAL statement_timeout = '10s'; SET LOCAL idle_in_transaction_session_timeout = '30s'; LOCK TABLE public.${relation} IN ACCESS EXCLUSIVE MODE; SELECT 'UX127_ROUTE_LOCK:' || pg_backend_pid();\n`);
  let pid: number;
  try { pid = await ready; }
  catch (cause) { child.stdin.end("ROLLBACK;\n"); throw cause; }
  finally { if (timer) clearTimeout(timer); }
  if (!Number.isSafeInteger(pid) || pid < 1) { child.stdin.end("ROLLBACK;\n"); throw new Error("Invalid fixture-owned lock PID."); }
  const predicate = `${pid} = ANY(pg_blocking_pids(pid)) AND query ILIKE '%${relation}%'`;
  return {
    async cancelOwnBlockedReaders() {
      await expect.poll(() => Number(execFileSync(target.dockerExecutable, args, { ...options, encoding: "utf8", input: `SELECT count(*) FROM pg_stat_activity WHERE ${predicate};` }).trim()), { timeout: 15_000, message: "Wait for an actual reader blocked by this exact fixture transaction" }).toBeGreaterThan(0);
      const canceled = execFileSync(target.dockerExecutable, args, { ...options, encoding: "utf8", input: `SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE ${predicate};` });
      expect(canceled.trim().split(/\s+/)).toContain("t");
    },
    async release() {
      if (child.exitCode !== null) return;
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.stdin.end("ROLLBACK;\n"); await exited;
    },
  };
}

function safePath(url: string) { try { return new URL(url).pathname; } catch { return "[unknown source]"; } }
async function capture(page: Page, info: TestInfo, campaign: string, phase: string, testedSha: string, runId: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.locator("img").evaluateAll(async (nodes) => {
    for (const node of nodes) if (node instanceof HTMLImageElement) {
      const box = node.getBoundingClientRect();
      if (box.height > 0 && box.width > 0 && box.top < innerHeight && box.bottom > 0) await node.decode();
    }
  });
  const relative = `docs/verification/issue-127/ux127-fault-${campaign}-${info.project.name}-${phase}.png`;
  await mkdir(path.dirname(path.resolve(relative)), { recursive: true });
  await page.screenshot({ path: relative, fullPage: false, animations: "disabled", caret: "hide" });
  return { path: relative, testedSha, runId };
}

for (const campaign of ["catalog", "product", "club"] as const) {
  test(`F11 real ${campaign} route query failure offers Retry and recovers actual content`, async ({ page }, info) => {
    test.skip(process.env.RUN_ISSUE_127_ROUTE_RECOVERY_E2E !== "1", "Requires exclusive guarded isolated Supabase with public Club ON.");
    test.setTimeout(120_000);
    if (info.config.workers !== 1) throw new Error("Real DB query cancellation requires exclusive --workers=1.");
    const fixture = await communityFixtures(info);
    const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const runId = `ux127-route-fault-${campaign}-${info.project.name}-${Date.now()}`;
    const consoleErrors: Array<{ kind: string; path: string }> = [];
    const pageErrors: Array<{ kind: string }> = [];
    const httpErrors: Array<{ path: string; status: number; method: string }> = [];
    const failedRequests: Array<{ path: string; method: string; error: string }> = [];
    // Record occurrence/source/status only; raw exception text can contain server details.
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push({ kind: "console.error during controlled backend failure", path: safePath(message.location().url) }); });
    page.on("pageerror", () => pageErrors.push({ kind: "page exception during controlled backend failure" }));
    page.on("response", (response) => { if (response.status() >= 400) httpErrors.push({ path: safePath(response.url()), status: response.status(), method: response.request().method() }); });
    page.on("requestfailed", (request) => failedRequests.push({ path: safePath(request.url()), method: request.method(), error: request.failure()?.errorText ?? "request failed" }));
    await page.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
    let lock: Awaited<ReturnType<typeof holdOwnRelation>> | undefined;
    const screenshots: Awaited<ReturnType<typeof capture>>[] = [];
    let passed = false;
    try {
      const book = await fixture.product("UX127RouteRecovery actual controlled book");
      const relation = campaign === "club" ? "community_artworks" : "products";
      lock = await holdOwnRelation(relation);
      const route = campaign === "catalog" ? "/en/products?q=UX127RouteRecovery" : campaign === "club" ? "/en/club" : `/en/products/${book.slug}`;
      await page.goto(`${COMMUNITY_TEST_ORIGIN}${route}`, { waitUntil: "commit" });
      await lock.cancelOwnBlockedReaders();
      const title = campaign === "catalog" ? "The catalog could not be loaded" : campaign === "club" ? "Coloring Club could not be loaded" : "This book could not be loaded";
      const failure = page.getByRole("alert").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
      await expect(failure).toBeVisible();
      await expect(failure).toContainText("loading error, rather than an empty result");
      await expect(page.getByText("No products found", { exact: true })).toHaveCount(0);
      await expect(page.getByTestId("community-gallery-empty-state")).toHaveCount(0);
      screenshots.push(await capture(page, info, campaign, "error", testedSha, runId));
      await lock.release(); lock = undefined;
      await failure.getByRole("button", { name: "Try again", exact: true }).click();
      if (campaign === "catalog") await expect(page.locator(`#catalog-product-${book.id}`).getByRole("heading", { name: book.title, exact: true })).toBeVisible();
      else if (campaign === "product") await expect(page.getByTestId("product-hero").getByRole("heading", { name: book.title, exact: true })).toBeVisible();
      else {
        await expect(page.getByTestId("community-gallery-page")).toBeVisible();
        await expect(page.getByTestId("community-gallery-product-filter").locator(`option[value="${book.id}"]`)).toHaveCount(1);
      }
      await expect(failure).toHaveCount(0);
      screenshots.push(await capture(page, info, campaign, "recovered", testedSha, runId));
      passed = true;
    } finally {
      try {
        await lock?.release();
        const directory = path.resolve(".task/ux127/runtime-manifests"); await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, `ux127-route-fault-${campaign}-${info.project.name}.json`), JSON.stringify({ schemaVersion: 1, campaign: `F11 ${campaign} actual local backend fault/recovery`, status: passed ? "PASS" : "FAIL", testedSha, runId, screenshots,
          evidenceClass: "fault-injection-not-clean-primary", mechanism: "Exclusive local transaction relation lock; pg_cancel_backend restricted to reader queries whose blocker chain contains the fixture-owned lock PID; rollback before UI Retry; no schema/RLS/grant changes.",
          observedConsoleErrors: consoleErrors, observedPageErrors: pageErrors, observedHttpErrors: httpErrors, observedFailedRequests: failedRequests,
          screenshotReview: { status: "NOT RUN", details: "Exact screenshots require visual review; this record is not a clean browser harness success." } }, null, 2));
      } finally { await fixture.cleanup(); }
    }
  });
}
