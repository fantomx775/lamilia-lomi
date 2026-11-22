// Real isolated admin encoder recovery and multi-chunk transport regression.
// Fixture generation, test collection and executed browser outcomes are separate evidence.
import { expect, test, type Page, type Request as BrowserRequest, type Response as BrowserResponse } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { communityFixtures } from "./helpers/community-fixtures";
import { controlIssue127TusGate, readIssue127TusGateState } from "./helpers/issue-127-tus-gate";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });
const TUS_PATH = "/storage/v1/upload/resumable";
// Match the application's explicit loader and encoding abort contracts, then the
// existing 20s target-request allowance. This is a failure deadline, not a speed goal.
const VIDEO_PREPARATION_TARGET_DEADLINE_MS = 60_000 + 420_000 + 20_000;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Asset = { id: string; kind: string; bucket: string; storagePath: string; sizeBytes: number; contentType: string; filename: string };
type Fixtures = Awaited<ReturnType<typeof communityFixtures>>;

function observeTus(page: Page, gatedMethod: "POST" | "PATCH", objectPrefix: string) {
  const origin = new URL(page.url()).origin;
  let rejectFailure!: (error: Error) => void;
  const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  // Every rejection is observed here and explicitly raced by the test-owned waits.
  void failure.catch(() => undefined);
  let protocolError = "", stopping = false, resource = "";
  let auth: Record<string, string> = {};
  const digest = createHash("sha256");
  let postCount = 0;
  const records: Array<{ method: string; status: number; bytes: number }> = [];
  const transfers: Array<{ method: string; offset: number | null; bytes: number }> = [];
  let browserBodyHashComplete = true;
  const pending = new Set<BrowserRequest>();
  const fault = (message: string) => {
    if (!protocolError && !stopping) { protocolError = message; rejectFailure(new Error(message)); }
  };
  const assertProtocol = () => { if (protocolError) throw new Error(protocolError); };
  const owned = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === origin && !parsed.username && !parsed.password && !parsed.hash
        && (parsed.pathname === TUS_PATH || parsed.pathname.startsWith(TUS_PATH + "/"));
    } catch { return false; }
  };
  page.on("request", (request) => {
    if (!owned(request.url())) return;
    pending.add(request);
    const headers = request.headers();
    if (["POST", "PATCH"].includes(request.method())) {
      const bytes = request.postDataBuffer();
      const offset = request.method() === "POST" ? 0 : Number(headers["upload-offset"]);
      const declaredBytes = Number(headers["content-length"]);
      const observedBytes = bytes?.byteLength ?? null;
      const bodyBytes = observedBytes !== null && observedBytes > 0 ? observedBytes
        : Number.isSafeInteger(declaredBytes) && declaredBytes >= 0 ? declaredBytes : observedBytes;
      transfers.push({ method: request.method(), offset: Number.isSafeInteger(offset) ? offset : null, bytes: bodyBytes ?? 0 });
      if (request.method() === "POST") postCount += 1;
      if (bytes?.byteLength) digest.update(bytes); else browserBodyHashComplete = false;
    }
    if (request.method() === "POST") {
      for (const name of ["authorization", "apikey", "x-signature"]) if (headers[name]) auth[name] = headers[name];
    }
  });
  page.on("requestfinished", (request) => pending.delete(request));
  page.on("requestfailed", (request) => {
    if (owned(request.url())) { pending.delete(request); fault("A TUS request failed during the uninterrupted byte proof."); }
  });
  page.on("response", (response) => {
    if (!owned(response.url())) return;
    const request = response.request();
    const requestBytes = request.postDataBuffer()?.byteLength;
    const declaredBytes = Number(request.headers()["content-length"]);
    records.push({ method: request.method(), status: response.status(),
      bytes: requestBytes ?? (Number.isSafeInteger(declaredBytes) && declaredBytes >= 0 ? declaredBytes : 0) });
    if (response.status() >= 400) fault("Storage returned an unsuccessful TUS response.");
    if (request.method() === "POST" && response.status() === 201) {
      const location = response.headers().location;
      if (!location) { fault("TUS creation omitted its resource Location."); return; }
      try {
        const candidate = new URL(location, response.url());
        if (!owned(candidate.href) || !candidate.pathname.startsWith(TUS_PATH + "/")) {
          fault("TUS resource Location failed the exact owned-origin boundary."); return;
        }
        resource = candidate.href; // Opaque Location/auth stay in memory only.
      } catch { fault("TUS resource Location was invalid."); }
    }
  });
  const externalTus = /^https?:\/\/(?!localhost:3443(?:\/|$))[^/]+\/storage\/v1\/upload\/resumable(?:\/|$)/;
  const routing = page.route(externalTus, async (route) => {
    fault("A TUS request attempted to leave the owned loopback Storage gateway.");
    await route.abort("blockedbyclient");
  });
  return { routing,
    async release() { await controlIssue127TusGate("release", objectPrefix); },
    reached: async () => Promise.race([
      expect.poll(async () => {
        const state = await readIssue127TusGateState();
        return state.method === gatedMethod ? state.arrivals : 0;
      }, { timeout: 60_000 }).toBeGreaterThan(0),
      failure,
    ]),
    async snapshot() {
      assertProtocol();
      const gateway = await readIssue127TusGateState();
      return { records: [...records], transfers: [...transfers], postCount, browserBodyHashComplete,
        pendingRequests: pending.size, gateway: { transfers: gateway.transfers ?? [], aggregateSha256: gateway.aggregateSha256 ?? null } };
    },
    finishHash: () => { assertProtocol(); return browserBodyHashComplete ? digest.digest("hex") : null; },
    async head(expectedBytes: number, expectedSha256: string, requireChunkedPatch = true) {
      await Promise.race([expect.poll(() => Boolean(resource)).toBe(true), failure]);
      assertProtocol();
      await expect.poll(async () => {
        const state = await readIssue127TusGateState();
        const creates = (state.transfers ?? []).filter((item) => item.method === "POST");
        const patches = (state.transfers ?? []).filter((item) => item.method === "PATCH");
        return creates.length === 1 && creates[0].complete && creates[0].status === 201
          && (!requireChunkedPatch || patches.length > 0)
          && patches.every((item) => item.complete && item.status === 204 && item.acknowledgedOffset !== null);
      }, { timeout: 15_000 }).toBe(true);
      const gateway = await readIssue127TusGateState();
      const creates = (gateway.transfers ?? []).filter((item) => item.method === "POST");
      const patches = (gateway.transfers ?? []).filter((item) => item.method === "PATCH");
      expect(creates).toHaveLength(1);
      expect(creates[0]).toMatchObject({ offset: 0, status: 201, complete: true });
      expect(creates[0].acknowledgedOffset).toBe(creates[0].bytes);
      if (creates[0].declaredBytes !== null) expect(creates[0].bytes).toBe(creates[0].declaredBytes);
      if (requireChunkedPatch) expect(patches.length).toBeGreaterThan(0);
      let nextOffset = creates[0].acknowledgedOffset ?? 0;
      for (const patch of patches) {
        expect(patch.offset).toBe(nextOffset);
        expect(patch.bytes).toBeGreaterThan(0);
        expect(patch.complete).toBe(true);
        expect(patch.status).toBe(204);
        expect(patch.acknowledgedOffset).toBe(nextOffset + patch.bytes);
        if (patch.acknowledgedOffset === null) throw new Error("Storage omitted the accepted TUS upload offset.");
        nextOffset = patch.acknowledgedOffset;
      }
      expect(nextOffset).toBe(expectedBytes);
      expect(gateway.aggregateSha256).toBe(expectedSha256);
      expect(postCount).toBe(1);
      let result;
      try { result = await page.request.head(resource, { headers: { ...auth, "Tus-Resumable": "1.0.0" } }); }
      catch { throw new Error("Owned TUS HEAD failed; opaque resource and authorization details withheld."); }
      expect(result.status()).toBe(200);
      expect(Number(result.headers()["upload-offset"])).toBe(expectedBytes);
      expect(Number(result.headers()["upload-length"])).toBe(expectedBytes);
      records.push({ method: "HEAD", status: result.status(), bytes: 0 });
    },
    async stop() {
      stopping = true;
      await controlIssue127TusGate("release", objectPrefix).catch(() => undefined);
      await page.close(); // Terminate this test page's encoder/network before fixture cleanup.
      pending.clear(); // A closed WebKit page may omit requestfinished for its canceled requests.
      await controlIssue127TusGate("disarm", objectPrefix).catch(() => undefined);
      resource = ""; auth = {};
    },
  };
}

/** Resolve an Error value rather than reject before the test reaches its await. */
function observePreparedVideoTarget(page: Page) {
  const origin = new URL(page.url()).origin;
  const result = Promise.withResolvers<BrowserResponse | Error>();
  let settled = false;
  const finish = (outcome: BrowserResponse | Error) => {
    if (settled) return;
    settled = true; clearTimeout(timer);
    page.off("response", onResponse); page.off("close", onClose);
    result.resolve(outcome);
  };
  const onResponse = (response: BrowserResponse) => {
    const url = new URL(response.url());
    if (url.origin === origin && url.pathname === "/api/admin/assets" && response.request().method() === "POST") finish(response);
  };
  const onClose = () => finish(new Error("Video preparation observation ended because its owned page closed."));
  const timer = setTimeout(() => finish(new Error("Video preparation exceeded the application's loader/encoding contract plus target-request deadline.")), VIDEO_PREPARATION_TARGET_DEADLINE_MS);
  page.on("response", onResponse); page.on("close", onClose);
  return { result: result.promise, dispose: () => finish(new Error("Video preparation observation disposed by test cleanup.")) };
}

async function targetResponse(page: Page, operation: () => Promise<unknown>) {
  const response = page.waitForResponse((item) => new URL(item.url()).pathname === "/api/admin/assets" && item.request().method() === "POST");
  await operation();
  const prepared = await response;
  expect(prepared.status()).toBe(200);
  return (await prepared.json()).asset as Asset;
}
async function storageBytes(fixture: Fixtures, asset: Asset) {
  const downloaded = await fixture.service.storage.from(asset.bucket).download(asset.storagePath);
  expect(downloaded.error === null && Boolean(downloaded.data)).toBe(true);
  return Buffer.from(await downloaded.data!.arrayBuffer());
}
async function cleanupOwned(fixture: Fixtures, productId: string, assets: Asset[]) {
  expect(fixture.products.includes(productId)).toBe(true);
  for (const asset of assets) {
    expect(asset.storagePath.startsWith(`products/${productId}/${asset.kind}/`)).toBe(true);
    expect((await fixture.service.storage.from(asset.bucket).remove([asset.storagePath])).error === null).toBe(true);
  }
  await fixture.cleanup();
}
async function saveAndRead(page: Page, fixture: Fixtures, productId: string, ids: string[], retainedDraft = false) {
  const destination = new URL(page.url());
  const completed = page.waitForResponse((response) => {
    const request = response.request(); const url = new URL(response.url());
    return request.method() === "POST" && Boolean(request.headers()["next-action"])
      && url.origin === destination.origin && url.pathname === destination.pathname;
  });
  await page.getByRole("button", { name: /^Zapisz/ }).click();
  expect((await completed).status()).toBe(200);
  await expect(page.getByRole("button", { name: /^Zapisz/ })).toBeEnabled();
  if (retainedDraft) {
    await expect(page.getByText("Pola produktu zapisano. Pozosta\u0142y nieprzes\u0142ane pliki do ponowienia lub usuni\u0119cia.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("product-save-bar")).toContainText("Niezapisane zmiany");
  } else {
    await expect(page.getByTestId("product-save-bar")).toContainText("Zapisano. Zmiany s\u0105 aktualne.");
  }
  const rows = await fixture.service.from("product_assets").select("id").eq("product_id", productId);
  expect(rows.error === null).toBe(true);
  expect((rows.data ?? []).map((item) => item.id).sort()).toEqual([...ids].sort());
}
async function manifest(name: string, page: Page, result: Record<string, unknown>) {
  const directory = path.resolve(".task/ux127/runtime-manifests");
  await mkdir(directory, { recursive: true });
  const runId = `${name}-${randomUUID().slice(0, 8)}`;
  const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const screenshots = Array.isArray(result.screenshotPaths)
    ? result.screenshotPaths.filter((value): value is string => typeof value === "string").map((value) => ({ path: value, testedSha, runId })) : [];
  await writeFile(path.join(directory, `${runId}.json`), JSON.stringify({ runId, testedSha,
    viewport: page.viewportSize(), screenshots, ...result,
  }, null, 2));
}

async function capturePhase(page: Page, section: string, name: string, productId: string) {
  await page.locator(section).scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    const visible = Array.from(document.images).filter((image) => {
      const box = image.getBoundingClientRect(); return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight;
    });
    await Promise.all(visible.map((image) => image.decode()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const filename = `docs/verification/issue-127/${name}.png`;
  await mkdir(path.dirname(path.resolve(filename)), { recursive: true });
  await page.screenshot({ path: filename, fullPage: false, animations: "disabled", caret: "hide",
    mask: [page.getByText(`ID: ${productId}`, { exact: true }), page.getByLabel("Adres produktu")] });
  return filename;
}

async function genuineLargePdf() {
  const width = 1536, height = 1536;
  const raw = Buffer.alloc(width * height * 3);
  let state = 0x527193ab;
  for (let index = 0; index < raw.length; index += 1) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    raw[index] = state & 255;
  }
  const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const document = await PDFDocument.create();
  document.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  document.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const image = await document.embedPng(png);
  document.addPage([600, 600]).drawImage(image, { x: 0, y: 0, width: 600, height: 600 });
  const bytes = await document.save();
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  expect(bytes.byteLength).toBeGreaterThan(6 * 1024 * 1024);
  expect(bytes.byteLength).toBeLessThan(20 * 1024 * 1024);
  return Buffer.from(bytes); // A valid document with a real embedded image, never padding.
}

test("F30 genuine multi-chunk public PDF transfers, HEAD readback, hash and persistence", async ({ page }, info) => {
  test.skip(process.env.RUN_ISSUE_127_ADMIN_VIDEO_E2E !== "1", "Requires guarded isolated Supabase and pinned HTTPS TUS gateway.");
  test.setTimeout(240_000);
  const fixture = await communityFixtures(info);
  const assets: Asset[] = [];
  let productId = "";
  let transport: ReturnType<typeof observeTus> | undefined;
  try {
    const actor = await fixture.actor("chunked-pdf", { admin: true });
    const book = await fixture.product("UX127 chunked PDF", "draft"); productId = book.id;
    await fixture.login(page, actor, `/admin/products/${book.id}`);
    const pdf = await genuineLargePdf();
    const uploadPrefix = `products/${productId}/public_download/`;
    transport = observeTus(page, "PATCH", uploadPrefix); await transport.routing;
    await controlIssue127TusGate("arm", uploadPrefix, "PATCH");
    const asset = await targetResponse(page, () => page.locator("#media-upload-public_download").setInputFiles({ name: "ux127-valid-large.pdf", mimeType: "application/pdf", buffer: pdf }));
    assets.push(asset);
    await transport.reached();
    const section = page.locator("#media-section-public_download");
    await expect(section.getByRole("progressbar")).toBeVisible();
    const creationEvidence = await transport.snapshot();
    expect(creationEvidence.records.some((item) => item.method === "POST" && item.status === 201)).toBe(true);
    await expect(page.getByRole("button", { name: /^Zapisz/ })).toBeDisabled();
    await transport.release();
    await expect(section.getByText("Przes\u0142ano", { exact: true })).toBeVisible();
    await transport.head(pdf.byteLength, sha256(pdf));
    const stored = await storageBytes(fixture, asset);
    expect(stored.byteLength).toBe(pdf.byteLength);
    expect(sha256(stored)).toBe(sha256(pdf));
    const browserRequestBodyHash = transport.finishHash();
    if (browserRequestBodyHash !== null) expect(browserRequestBodyHash).toBe(sha256(pdf));
    const evidence = await transport.snapshot();
    expect(evidence.pendingRequests).toBe(0);
    expect(evidence.gateway.transfers.some((item) => item.method === "PATCH" && item.status === 204 && item.bytes > 0)).toBe(true);
    await saveAndRead(page, fixture, productId, [asset.id]);
    await page.reload();
    await expect(section.locator('input[name="assetId"]')).toHaveValue(asset.id);
    await expect(section.locator('input[name="assetPath"]')).toHaveValue(asset.storagePath);
    const reloadedScreenshot = await capturePhase(page, "#media-section-public_download", `ux127-chunked-pdf-${info.project.name}-reloaded`, productId);
    await manifest(`ux127-chunked-pdf-${info.project.name}`, page, { browser: info.project.name, screenshotPaths: [reloadedScreenshot], status: "PASS", kind: "valid PDF actual chunked TUS", inputBytes: pdf.byteLength, sha256: sha256(pdf), browserRequestBodyHash, transport: evidence, storageBytesMatched: true, dbAndReloadMatched: true });
  } finally {
    try {
      if (transport) await transport.stop(); else await page.close();
    } finally {
      if (productId) await cleanupOwned(fixture, productId, assets); else await fixture.cleanup();
    }
  }
});

async function installActualEncoderObservation(page: Page) {
  await page.addInitScript(() => {
    const scope = window as Window & { __ux127Encoding?: { started: number; finished: number; messages: string[]; workerErrors: number }; __ux127Input?: File };
    scope.__ux127Encoding = { started: 0, finished: 0, messages: [], workerErrors: 0 };
    const record = (kind: string, type: unknown) => {
      const known = ["LOAD", "EXEC", "FFPROBE", "WRITE_FILE", "READ_FILE", "ERROR", "LOG", "PROGRESS"];
      scope.__ux127Encoding!.messages.push(`${kind}:${typeof type === "string" && known.includes(type) ? type : "other"}`);
      if (scope.__ux127Encoding!.messages.length > 30) scope.__ux127Encoding!.messages.shift();
    };
    const original = Worker.prototype.postMessage;
    const observed = new WeakSet<Worker>();
    Worker.prototype.postMessage = function (message: unknown, ...args: unknown[]) {
      if (!observed.has(this)) {
        observed.add(this);
        this.addEventListener("message", (event) => {
          record("receive", event.data?.type);
          if (event.data?.type === "EXEC") scope.__ux127Encoding!.finished += 1;
        });
        this.addEventListener("error", () => { scope.__ux127Encoding!.workerErrors += 1; });
        this.addEventListener("messageerror", () => { scope.__ux127Encoding!.workerErrors += 1; });
      }
      const type = message && typeof message === "object" && "type" in message ? message.type : null;
      record("send", type);
      const result = Reflect.apply(original, this, [message, ...args]);
      if (type === "EXEC") scope.__ux127Encoding!.started += 1;
      return result; // Transparent instrumentation: exact original worker/messages/arguments/results.
    };
    document.addEventListener("change", (event) => {
      if (event.target instanceof HTMLInputElement && event.target.id === "media-upload-video" && event.target.files?.[0]) scope.__ux127Input = event.target.files[0];
    }, true);
  });
}
async function inputMetadata(page: Page) {
  return page.evaluate(async () => {
    const scope = window as Window & { __ux127Input?: File };
    const file = scope.__ux127Input;
    if (!file) throw new Error("The real browser video input was not captured.");
    const video = document.createElement("video");
    const source = URL.createObjectURL(file);
    const playable = video.canPlayType(file.type);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Real input metadata unavailable in this browser codec build.")), 15_000);
        video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error("Real input metadata codec failure."));
        video.preload = "metadata"; video.src = source;
      });
      return { bytes: file.size, duration: video.duration, width: video.videoWidth, height: video.videoHeight, playable };
    } finally { clearTimeout(timer); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(source); }
  });
}

test("F30 actual 45-second video encoder cancel, preserved draft and genuine retry", async ({ page }, info) => {
  test.skip(process.env.RUN_ISSUE_127_ADMIN_VIDEO_E2E !== "1", "Requires guarded local backend, real generated 45s WebM and pinned browser FFmpeg WASM.");
  test.setTimeout(600_000);
  const fixture = await communityFixtures(info);
  const assets: Asset[] = [];
  let productId = "";
  let transport: ReturnType<typeof observeTus> | undefined;
  let retryTargetObservation: ReturnType<typeof observePreparedVideoTarget> | undefined;
  try {
    const configured = process.env.UX127_ADMIN_VIDEO_FIXTURE_PATH;
    if (!configured || !path.isAbsolute(configured)) throw new Error("Set an absolute private generated video fixture path.");
    const fixtureRoot = await realpath(path.resolve(".task/ux127/fixtures"));
    const fixturePath = await realpath(configured);
    if (!fixturePath.startsWith(fixtureRoot + path.sep)) throw new Error("Video fixture must remain inside this task's private fixture directory.");
    const bytes = await readFile(fixturePath);
    expect(bytes.byteLength).toBeGreaterThan(6 * 1024 * 1024);
    expect(bytes.byteLength).toBeLessThan(50 * 1024 * 1024);
    expect(bytes.subarray(0, 4).toString("hex")).toBe("1a45dfa3"); // Genuine EBML container; duration is checked in browser below.
    await installActualEncoderObservation(page);
    const pinnedWasm: number[] = [];
    const ffmpegNetwork: Array<{ path: string; status: number | null; outcome: "response" | "request-failed" }> = [];
    const safeEncoderPath = (value: string) => {
      try {
        const url = new URL(value);
        if (url.origin === "https://cdn.jsdelivr.net" && url.pathname.startsWith("/npm/@ffmpeg/core@0.12.10/dist/esm/")) return url.pathname;
        if (url.origin === new URL(info.project.use.baseURL as string).origin && url.pathname.startsWith("/admin-video-encoder/")) return url.pathname;
      } catch { /* Ignore non-owned and malformed URLs. */ }
      return null;
    };
    page.on("response", (response) => {
      const safePath = safeEncoderPath(response.url());
      if (safePath) ffmpegNetwork.push({ path: safePath, status: response.status(), outcome: "response" });
      if (response.url() === "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm") pinnedWasm.push(response.status());
    });
    page.on("requestfailed", (request) => {
      const safePath = safeEncoderPath(request.url());
      if (safePath) ffmpegNetwork.push({ path: safePath, status: null, outcome: "request-failed" });
    });
    const actor = await fixture.actor("video-retry", { admin: true });
    const book = await fixture.product("UX127 real encoder recovery", "draft"); productId = book.id;
    await fixture.login(page, actor, `/admin/products/${book.id}`);
    const notes = "Keep this draft through real video preparation and cancellation.";
    await page.getByLabel("Kr\u00f3tki opis").fill(notes);
    const image = await sharp({ create: { width: 850, height: 1100, channels: 3, background: "#bac9ad" } }).png().toBuffer();
    const gallery = await targetResponse(page, () => page.locator("#media-upload-gallery").setInputFiles({ name: "ux127-preserved-gallery.png", mimeType: "image/png", buffer: image }));
    assets.push(gallery);
    await expect(page.locator('#media-section-gallery input[name="assetId"]')).toHaveValue(gallery.id);
    const video = page.locator("#media-section-video");
    await page.locator("#media-upload-video").setInputFiles({ name: "ux127-motion-45s.webm", mimeType: "video/webm", buffer: bytes });
    const input = await inputMetadata(page);
    expect(input.duration).toBeGreaterThan(44); expect(input.duration).toBeLessThan(46);
    expect(input.bytes).toBe(bytes.byteLength);
    try {
      await expect.poll(() => page.evaluate(() => (window as Window & { __ux127Encoding?: { started: number } }).__ux127Encoding?.started ?? 0), { timeout: 90_000 }).toBe(1);
    } catch (error) {
      const state = await page.evaluate(() => {
        const encoding = (window as Window & { __ux127Encoding?: { started: number; finished: number; messages: string[]; workerErrors: number } }).__ux127Encoding;
        const section = document.querySelector("#media-section-video");
        const text = section?.textContent ?? "";
        return { encoding: encoding ? { started: encoding.started, finished: encoding.finished, messages: [...encoding.messages], workerErrors: encoding.workerErrors } : null,
          preparingVisible: text.includes("Przygotowywanie filmu"), optimizationFailureVisible: text.includes("Optymalizacja pliku nie powiodła się"),
          uploadProgressVisible: Boolean(section?.querySelector('[role="progressbar"]')) };
      });
      await testInfo.attach("f30-encoder-startup-diagnostic", { body: JSON.stringify({ testedSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), network: ffmpegNetwork, pinnedWasmStatuses: pinnedWasm, state }, null, 2), contentType: "application/json" });
      throw error;
    }
    expect(pinnedWasm.includes(200)).toBe(true); // Original browser fetch also enforces the pinned SRI from application code.
    await expect(video.getByText("Przygotowywanie filmu\u2026", { exact: true })).toBeVisible();
    await expect(video.getByRole("progressbar")).toHaveCount(0);
    const preparingScreenshot = await capturePhase(page, "#media-section-video", `ux127-large-video-${info.project.name}-preparing`, productId);
    await expect(video.getByText("Przygotowywanie filmu\u2026", { exact: true })).toBeVisible();
    await video.getByRole("button", { name: "Przerwij", exact: true }).click();
    await expect(video.getByText("Przerwano przygotowanie lub przesy\u0142anie. Mo\u017cesz ponowi\u0107 albo usun\u0105\u0107 plik.")).toBeVisible();
    await expect(page.getByLabel("Kr\u00f3tki opis")).toHaveValue(notes);
    await expect(page.locator('#media-section-gallery input[name="assetId"]')).toHaveValue(gallery.id);
    await expect(video.locator('input[name="assetId"]')).toHaveCount(0);
    const cancelledScreenshot = await capturePhase(page, "#media-section-video", `ux127-large-video-${info.project.name}-cancelled`, productId);
    await saveAndRead(page, fixture, productId, [gallery.id], true);
    const savedText = await fixture.service.from("product_translations").select("short_description").eq("product_id", productId).eq("locale", "en").single();
    expect(savedText.error === null).toBe(true); expect(savedText.data?.short_description).toBe(notes);
    const uploadPrefix = `products/${productId}/video/`;
    transport = observeTus(page, "POST", uploadPrefix); await transport.routing;
    await controlIssue127TusGate("arm", uploadPrefix, "POST");
    retryTargetObservation = observePreparedVideoTarget(page);
    const retryPreparationStartedAt = performance.now();
    await video.getByRole("button", { name: "Pon\u00f3w", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as Window & { __ux127Encoding?: { started: number } }).__ux127Encoding?.started ?? 0), { timeout: 90_000 }).toBe(2);
    const targetOutcome = await retryTargetObservation.result;
    const retryPreparationElapsedMs = performance.now() - retryPreparationStartedAt;
    await manifest(`ux127-video-preparation-phase-${info.project.name}`, page, {
      status: "PHASE_TIMING_ONLY", browser: info.project.name,
      retryPreparationElapsedMs, deadlineMs: VIDEO_PREPARATION_TARGET_DEADLINE_MS,
      targetObserved: !(targetOutcome instanceof Error),
      limitation: "Retry click to upload-target response includes actual preparation and signing; this is not an encoder benchmark or a full-case PASS.",
    });
    if (targetOutcome instanceof Error) throw targetOutcome;
    const prepared = targetOutcome;
    expect(prepared.status()).toBe(200);
    const encoded = (await prepared.json()).asset as Asset; assets.push(encoded);
    expect(encoded.contentType).toBe("video/mp4"); expect(encoded.filename.endsWith(".mp4")).toBe(true);
    await transport.reached();
    await expect(video.getByRole("progressbar")).toBeVisible();
    await expect(video.getByText("Przygotowywanie filmu\u2026", { exact: true })).toHaveCount(0);
    await transport.release();
    await expect(video.getByText("Przes\u0142ano", { exact: true })).toBeVisible({ timeout: 120_000 });
    const output = await storageBytes(fixture, encoded);
    await transport.head(encoded.sizeBytes, sha256(output), false);
    expect(output.byteLength).toBe(encoded.sizeBytes);
    expect(output.subarray(4, 8).toString("ascii")).toBe("ftyp");
    const browserRequestBodyHash = transport.finishHash();
    if (browserRequestBodyHash !== null) expect(browserRequestBodyHash).toBe(sha256(output));
    const evidence = await transport.snapshot();
    expect(evidence.pendingRequests).toBe(0);
    await saveAndRead(page, fixture, productId, [gallery.id, encoded.id]);
    await page.reload();
    await expect(page.getByLabel("Kr\u00f3tki opis")).toHaveValue(notes);
    await expect(video.locator('input[name="assetId"]')).toHaveValue(encoded.id);
    await expect(page.locator('#media-section-gallery input[name="assetId"]')).toHaveValue(gallery.id);
    const outputMetadata = await video.locator("video").evaluate(async (element) => {
      const media = element as HTMLVideoElement;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Actual stored MP4 first frame did not decode.")), 15_000);
          media.onloadeddata = () => resolve(); media.onerror = () => reject(new Error("Actual stored MP4 codec failure."));
          media.preload = "auto"; media.load();
        });
        media.pause();
        return { duration: media.duration, width: media.videoWidth, height: media.videoHeight, paused: media.paused };
      } finally { clearTimeout(timer); media.onloadeddata = null; media.onerror = null; }
    });
    expect(outputMetadata.duration).toBeGreaterThan(44); expect(outputMetadata.duration).toBeLessThan(46);
    expect(outputMetadata.width).toBeGreaterThan(0); expect(outputMetadata.width).toBeLessThanOrEqual(1280);
    expect(outputMetadata.height).toBeGreaterThan(0); expect(outputMetadata.height).toBeLessThanOrEqual(720);
    expect(outputMetadata.paused).toBe(true);
    const reloadedScreenshot = await capturePhase(page, "#media-section-video", `ux127-large-video-${info.project.name}-reloaded`, productId);
    await manifest(`ux127-large-video-${info.project.name}`, page, { browser: info.project.name, outputMetadata, screenshotPaths: [preparingScreenshot, cancelledScreenshot, reloadedScreenshot], status: "PASS", input, inputSha256: sha256(bytes),
      retryPreparationElapsedMs, preparationTargetDeadlineMs: VIDEO_PREPARATION_TARGET_DEADLINE_MS,
      preparedBytes: output.byteLength, preparedSha256: sha256(output), browserRequestBodyHash, transport: evidence,
      checks: ["real 45s input metadata", "actual pinned WASM worker EXEC before cancel", "no fake transfer percentage during encoding", "draft text and gallery preserved", "remaining draft saved without canceled video", "actual same-file retry conversion", "actual TUS and Storage hash", "DB and reload persistence"] });
  } finally {
    retryTargetObservation?.dispose();
    try {
      if (transport) await transport.stop(); else await page.close();
    } finally {
      if (productId) await cleanupOwned(fixture, productId, assets); else await fixture.cleanup();
    }
  }
});
