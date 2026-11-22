import { expect, test, type Request, type Page, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { communityFixtures, COMMUNITY_TEST_ORIGIN } from "./helpers/community-fixtures";
import { classifyOwnedMetadataResume } from "./helpers/owned-media-metadata-resume";
import { classifyOwnedMediaRangeContinuation } from "./helpers/owned-media-range-continuation";
import { observeOwnedMediaCdp, type OwnedMediaSource } from "./helpers/owned-media-diagnostics";
import { NextCancellationObserver } from "./helpers/next-navigation-cancellations";
import { controlIssue127MediaGate, readIssue127MediaGateState, type MediaGateState } from "./helpers/issue-127-media-gate";

test.use({ ignoreHTTPSErrors: true, trace: "off", screenshot: "off", video: "off" });

/** Real Storage/Auth/DB transport. Supabase fallback images intentionally stay
 * unoptimized; optimized srcset selection is a separate local-demo campaign. */
test("F15-F17 real isolated product media has Range, decoded previews and recoverable pending playback", async ({ page }, testInfo) => {
  test.skip(process.env.RUN_ISSUE_127_PRODUCT_MEDIA_E2E !== "1", "Requires guarded exclusive local Supabase and its owned HTTPS gateway.");
  test.setTimeout(180_000);
  const isWebKit = testInfo.project.use.browserName === "webkit";
  // WebKit's media element stalls when the page-injected event/RAF observer is
  // attached. Keep its observations passive; Chromium retains the richer trace.
  const useNativeMediaObserver = !isWebKit;
  const useClickFrameMeasurement = !isWebKit;
  const fixtures = await communityFixtures(testInfo); // Pins the existing strict local Docker/API/DB identity before writes.
  const testedSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const runId = process.env.UX127_MEDIA_RUN_ID ?? `supabase-media-${randomUUID()}`;
  const runArtifactId = createHash("sha256").update(runId).digest("hex").slice(0, 16);
  const nextObserver = new NextCancellationObserver({ testedSha, runId, origin: COMMUNITY_TEST_ORIGIN });
  await nextObserver.observe(page);
  let nextSnapshot: Awaited<ReturnType<NextCancellationObserver["finish"]>> | null = null;
  let nextFinalizationFailed = false;
  const screenshots: Array<Record<string, unknown>> = [];
  let completed = false;
  let phase = "fixture-setup";
  const phaseHistory: Array<{ phase: string; atEpochMs: number }> = [{ phase, atEpochMs: Date.now() }];
  function setPhase(next: string) {
    phase = next;
    phaseHistory.push({ phase: next, atEpochMs: Date.now() });
  }
  async function bounded<T>(operation: Promise<T>, label: string, timeoutMs = 10_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} exceeded its ${timeoutMs}ms test bound.`)), timeoutMs);
        }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async function capture(target: Page, screenshotPhase: string) {
    setPhase(`capture:${screenshotPhase}`);
    await settleVisibleMedia(target);
    const filename = `supabase-media-${testInfo.project.name}-${runArtifactId}-${screenshotPhase}.png`;
    const artifactRoot = process.env.COMMUNITY_ARTIFACT_DIR;
    if (artifactRoot && !path.isAbsolute(artifactRoot)) throw new Error("Evidence directory must be absolute.");
    const artifact = artifactRoot
      ? path.join(artifactRoot, "issue-127", filename)
      : path.resolve("docs", "verification", "issue-127", filename);
    await mkdir(path.dirname(artifact), { recursive: true });
    const screenshotBytes = await target.screenshot({ path: artifact, animations: "disabled" });
    screenshots.push({ path: artifactRoot ? path.relative(artifactRoot, artifact) : path.relative(process.cwd(), artifact), testedSha, runId,
      screenshotSha256: createHash("sha256").update(screenshotBytes).digest("hex"), phase: screenshotPhase,
      viewport: target.viewportSize(), dpr: await target.evaluate(() => devicePixelRatio) });
  }
  const objects: Array<{ bucket: string; path: string }> = [];
  const consoleErrors: Array<{ category: "unexpected-console-error"; path: string }> = [];
  const pageErrors: Array<{ category: "unexpected-page-error"; path: string }> = [];
  type RequestMetadata = { requestId: number; method: string; path: string; originKind: "test-origin" | "loopback" | "other-origin" | "invalid-origin";
    resource: string; phaseAtStart: string; navigation: boolean; rsc: boolean; prefetch: boolean;
    urlSha256: string; startedAtEpochMs: number; range: string | null; responseStatus: number | null; contentRange: string | null;
    safeMediaResponseHeaders?: { contentType: string | null; contentLength: number | null; acceptRanges: "bytes" | "none" | null;
      contentDisposition: "inline" | "attachment" | "other" | null; cacheControl: "no-store" | "private" | "public" | "other" | null };
    responseAtEpochMs?: number; finishedAtEpochMs?: number;
    redirectTargetPath?: string; redirectTargetOrigin?: string; redirectTargetOriginKind?: "test-origin" | "loopback" | "other-origin";
    identitySample?: Record<string, unknown>; allHeadersRange?: string | null };
  type FailedRequest = RequestMetadata & { error: string | null; phaseAtFailure: string; failedAtEpochMs: number; expectedPause: boolean; expectedFault: boolean;
    responseBodyBytes?: number; redirectChain: RequestMetadata[]; pauseGateRequest: boolean; pauseRequestedAtFailure: boolean; validatedNextPrefetchId?: string;
    pauseWitness?: { atEpochMs: number; sourcePath: string; trusted: true; paused: true };
    pauseActionWitness?: { clickStartedAtEpochMs: number; pauseConfirmedAtEpochMs: number; gateArrivalSequence: number; gateArrivalAtEpochMs: number; clientClosed: true };
    controlledFaultArrivalSequences?: number[] };
  const failed: FailedRequest[] = [];
  const mediaRequests: RequestMetadata[] = [];
  const ownedMediaTransportRequests: RequestMetadata[] = [];
  const storageTransportRequests: RequestMetadata[] = [];
  const successfulMedia: Array<Record<string, unknown>> = [];
  const controlledFaultResponses: RequestMetadata[] = [];
  const mediaGateSnapshots: Array<Record<string, unknown>> = [];
  const cdpMedia: Array<Record<string, unknown>> = [];
  const metadataResumeProofs = new Map<number, ReturnType<typeof classifyOwnedMetadataResume>>();
  const rangeContinuationProofs = new Map<number, ReturnType<typeof classifyOwnedMediaRangeContinuation>>();
  let ownedVideoBytes = 0;
  let ownedVideoStorageReadbackSha256: string | null = null;
  let ownedVideoContent: { byteLength: number; fixtureSha256: string; storageReadbackSha256: string } | null = null;
  const diagnosticWork: Promise<void>[] = [];
  let stopCdp: (() => Promise<void>) | null = null;
  let cdpStatus = "NOT_APPLICABLE";
  const inFlight = new Map<Request, RequestMetadata>();
  const requestIdentity = new WeakMap<Request, RequestMetadata>();
  const nativeTimeline: Array<Record<string, unknown>> = [];
  const videoDomLifecycleByCache: Record<string, Array<Record<string, unknown>>> = {};
  const observerErrors: Array<{ category: "invalid-native-observation" }> = [];
  const lifecycleActions: Array<{ action: string; phase: string; atEpochMs: number }> = [];
  const networkDiagnostics: string[] = [];
  let requestSequence = 0;
  function requestMetadata(request: Request): RequestMetadata {
    const existing = requestIdentity.get(request);
    if (existing) return existing;
    const headers = request.headers();
    const metadata: RequestMetadata = { requestId: ++requestSequence, method: request.method(), path: locationPath(request.url(), COMMUNITY_TEST_ORIGIN),
      originKind: locationOriginKind(request.url(), COMMUNITY_TEST_ORIGIN),
      resource: request.resourceType(), phaseAtStart: phase, navigation: request.isNavigationRequest(),
      rsc: headers.rsc === "1", prefetch: headers["next-router-prefetch"] === "1" || Boolean(headers["next-router-segment-prefetch"]),
      urlSha256: createHash("sha256").update(request.url()).digest("hex"), startedAtEpochMs: Date.now(),
      range: headers.range ? /^bytes=\d{1,16}-\d{0,16}$/.test(headers.range) ? headers.range : "unknown-range" : null,
      responseStatus: null as number | null, contentRange: null as string | null };
    requestIdentity.set(request, metadata);
    const isOwnedVideoRequest = ownedVideoPath !== "" && metadata.originKind === "test-origin" && metadata.path === ownedVideoPath;
    const isOwnedStorageRequest = isOwnedStorageMediaPath(metadata);
    if (request.resourceType() === "media") mediaRequests.push(metadata);
    if (isOwnedVideoRequest || isOwnedStorageRequest) ownedMediaTransportRequests.push(metadata);
    if (metadata.originKind === "test-origin" && metadata.path.startsWith("/storage/v1/")) storageTransportRequests.push(metadata);
    if (request.resourceType() === "media" || isOwnedVideoRequest || isOwnedStorageRequest) {
      diagnosticWork.push((async () => {
        const headers = await request.allHeaders();
        metadata.allHeadersRange = headers.range ? /^bytes=\d{1,16}-\d{0,16}$/.test(headers.range) ? headers.range : "unknown-range" : null;
        // This is an explicitly timed sample, not inferred proof that no generation changed.
        const sample = request.frame().evaluate(() => {
          const read = (window as unknown as { __ux127ReadMediaIdentity?: () => Record<string, unknown> }).__ux127ReadMediaIdentity;
          return read ? read() : { status: "identity-not-installed", sampledAtEpochMs: Date.now() };
        }).catch(() => ({ status: "identity-sample-unavailable" }));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          sample,
          new Promise<Record<string, unknown>>((resolve) => {
            timer = setTimeout(() => resolve({ status: "identity-sample-timeout" }), 1_000);
          }),
        ]);
        if (timer) clearTimeout(timer);
        metadata.identitySample = projectIdentitySample(result);
      })().catch(() => { metadata.identitySample = { status: "identity-sample-unavailable" }; }));
    }
    return metadata;
  }
  async function drainBeforeReset(reason: string) {
    setPhase(`drain:${reason}`);
    lifecycleActions.push({ action: "drain-start", phase, atEpochMs: Date.now() });
    // Wait for genuine document/prefetch/script/image work; do not abort it or
    // count this wait as part of click-to-frame latency. Media is observed separately.
    await expect.poll(() => [...inFlight.values()].filter((request) => request.resource !== "media" &&
      !(request.originKind === "test-origin" && request.path === ownedVideoPath) && !isOwnedStorageMediaPath(request)).length,
      { timeout: 20_000, message: "Started non-media document requests must settle before a test-driven reset." }).toBe(0);
    lifecycleActions.push({ action: "drain-complete", phase, atEpochMs: Date.now() });
  }
  async function resetDocument(url: string, label: string) {
    await drainBeforeReset(label);
    setPhase(label);
    lifecycleActions.push({ action: "goto-requested", phase, atEpochMs: Date.now() });
    await page.goto(url);
    lifecycleActions.push({ action: "goto-committed", phase, atEpochMs: Date.now() });
  }
  async function finalizeNextRequests() {
    if (nextSnapshot || nextFinalizationFailed) return;
    setPhase("network:typed-finalization");
    try { nextSnapshot = await nextObserver.finish(); }
    catch { nextFinalizationFailed = true; return; }
    const byHash = new Map<string, string[]>();
    for (const outcome of nextSnapshot.expectedNextCancellations) {
      if (outcome.kind !== "next-prefetch" || typeof outcome.requestUrl !== "string" || typeof outcome.id !== "string") continue;
      const hash = createHash("sha256").update(outcome.requestUrl).digest("hex");
      byHash.set(hash, [...(byHash.get(hash) ?? []), outcome.id]);
    }
    for (const request of failed) {
      if (request.error === "net::ERR_ABORTED" && request.method === "GET" && request.resource === "fetch" && request.rsc && request.prefetch) {
        request.validatedNextPrefetchId = byHash.get(request.urlSha256)?.shift();
      }
    }
    if ([...byHash.values()].some((outcomes) => outcomes.length)) nextFinalizationFailed = true;
    for (const request of failed) {
      if (!request.pauseGateRequest || !request.pauseRequestedAtFailure || request.method !== "GET" ||
          request.originKind !== "test-origin" || request.path !== ownedVideoPath) continue;
      const witness = nativeTimeline.find((event) => event.event === "pause" && event.trusted === true && event.paused === true && event.connected === true &&
        (event.sourcePath === ownedVideoPath || event.sourcePath === ownedStoragePath) && typeof event.atEpochMs === "number" &&
        event.atEpochMs >= request.startedAtEpochMs && event.atEpochMs < request.failedAtEpochMs);
      if (witness) {
        request.expectedPause = true;
        request.pauseWitness = { atEpochMs: witness.atEpochMs as number, sourcePath: witness.sourcePath as string, trusted: true, paused: true };
      }
    }
    if (isWebKit && pauseActionStartedAtEpochMs !== null && pauseActionConfirmedAtEpochMs !== null) {
      const gate = mediaGateSnapshots.find((snapshot) => snapshot.checkpoint === "pending-playback-after-pause");
      const arrivals = gate?.requestArrivals as MediaGateState["requestArrivals"];
      const candidates = failed.filter((request) => request.pauseGateRequest && request.phaseAtStart.startsWith("pending-playback:") &&
        request.method === "GET" && request.originKind === "test-origin" && request.path === ownedVideoPath &&
        request.responseStatus === null && ["net::ERR_ABORTED", "Load request cancelled", "NS_BINDING_ABORTED"].includes(request.error ?? "") &&
        request.failedAtEpochMs >= pauseActionStartedAtEpochMs! && request.failedAtEpochMs <= pauseActionConfirmedAtEpochMs! + 1_500);
      if (gate?.mode === "hold" && gate.arrivals === 1 && gate.clientClosed === 1 && gate.released === 0 &&
          arrivals?.length === 1 && candidates.length === 1) {
        const arrival = arrivals[0];
        const request = candidates[0];
        if (arrival.sequence === 1 && arrival.method === "GET" && arrival.outcome === "pending" && arrival.responseStatus === null &&
            arrival.arrivedAtEpochMs <= pauseActionStartedAtEpochMs + 250 && request.startedAtEpochMs <= arrival.arrivedAtEpochMs + 100 &&
            (request.allHeadersRange ?? request.range) === arrival.range) {
          request.expectedPause = true;
          request.pauseRequestedAtFailure = true;
          request.pauseActionWitness = { clickStartedAtEpochMs: pauseActionStartedAtEpochMs,
            pauseConfirmedAtEpochMs: pauseActionConfirmedAtEpochMs, gateArrivalSequence: arrival.sequence,
            gateArrivalAtEpochMs: arrival.arrivedAtEpochMs, clientClosed: true };
        }
      }
    }
    await Promise.all(diagnosticWork);
    for (const request of failed.filter((entry) => entry.resource === "media")) {
      const evidence = { cdpStatus, observerErrors, consoleErrors, pageErrors, failed, mediaRequests,
        ownedMediaTransportRequests, successfulMedia, cdpMedia, nativeTimeline, lifecycleActions,
        ownedMedia: { apiPath: ownedVideoPath, storagePath: ownedStoragePath, origin: COMMUNITY_TEST_ORIGIN },
        ownedVideoContent,
      };
      metadataResumeProofs.set(request.requestId, classifyOwnedMetadataResume(evidence, request.requestId, ownedVideoBytes));
      rangeContinuationProofs.set(request.requestId, classifyOwnedMediaRangeContinuation(evidence, request.requestId, ownedVideoBytes));
    }
  }
  async function networkSnapshot(checkpoint: string) {
    // Paths omit all query/fragment data, including signed Storage tokens. Only
    // two routing-header booleans are retained; never cookies/headers/bodies.
    await Promise.all(diagnosticWork);
    const gate = await readIssue127MediaGateState().catch(() => null);
    if (gate) mediaGateSnapshots.push({ checkpoint, armed: gate.armed, mode: gate.mode ?? null, arrivals: gate.arrivals,
      clientClosed: gate.clientClosed, released: gate.released, aborted: gate.aborted, requestArrivals: gate.requestArrivals ?? [] });
    const nativePlayer = await page.locator("video").evaluate((element) => {
      const video = element as HTMLVideoElement;
      return { paused: video.paused, readyState: video.readyState, networkState: video.networkState,
        currentTime: video.currentTime, errorCode: video.error?.code ?? null,
        buffered: Array.from({ length: video.buffered.length }, (_, index) => ({ start: video.buffered.start(index), end: video.buffered.end(index) })) };
    }).catch(() => null);
    const body = JSON.stringify({ testedSha, runId, checkpoint, phase, phaseHistory, consoleErrors, pageErrors, failed, controlledFaultResponses,
      metadataResumeProofs: [...metadataResumeProofs.entries()].map(([requestId, proof]) => ({ requestId, ...proof })),
      rangeContinuationProofs: [...rangeContinuationProofs.entries()].map(([requestId, proof]) => ({ requestId, ...proof })),
      mediaRequests, ownedMediaTransportRequests, storageTransportRequests, successfulMedia, mediaGateSnapshots, nativePlayer, cdpStatus, cdpMedia, nativeTimeline, lifecycleActions, observerErrors,
      ownedMedia: { apiPath: ownedVideoPath, storagePath: ownedStoragePath, origin: COMMUNITY_TEST_ORIGIN }, ownedVideoContent, nextFinalizationFailed,
      expectedNextCancellations: nextSnapshot?.expectedNextCancellations.filter((outcome) => outcome.kind === "next-prefetch") ?? [],
      closedPrefetches: nextSnapshot?.closedPrefetches ?? [], pending: [...inFlight.values()], videoDomLifecycleByCache }, null, 2);
    const filename = `supabase-media-network-${checkpoint}.json`;
    await writeFile(testInfo.outputPath(filename), body);
    networkDiagnostics.push(filename);
    await testInfo.attach(`supabase-media-network-${checkpoint}`, { body, contentType: "application/json" });
  }
  const delayedRequests = new WeakSet<Request>();
  const expectedFaultConsole: Array<{ category: "controlled-media-resource-error"; path: string }> = [];
  let faultActive = false;
  let pauseGateActive = false;
  let ownedVideoPath = "";
  let ownedStoragePath = "";
  function isOwnedStorageMediaPath(request: Pick<RequestMetadata, "originKind" | "path">) {
    if (!ownedStoragePath) return false;
    if (request.originKind !== "test-origin") return false;
    let decoded = request.path;
    try { decoded = decodeURIComponent(request.path); } catch { return false; }
    return decoded === ownedStoragePath;
  }
  let pauseConfirmed = false;
  let pauseActionStartedAtEpochMs: number | null = null;
  let pauseActionConfirmedAtEpochMs: number | null = null;
  let waitEvents = { waiting: 0, stalled: 0 };
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const consolePath = locationPath(message.location().url, COMMUNITY_TEST_ORIGIN);
    if (faultActive && locationOriginKind(message.location().url, COMMUNITY_TEST_ORIGIN) === "test-origin" &&
        consolePath === ownedVideoPath && /^Failed to load resource:/.test(message.text())) expectedFaultConsole.push({ category: "controlled-media-resource-error", path: consolePath });
    else consoleErrors.push({ category: "unexpected-console-error", path: consolePath });
  });
  page.on("pageerror", () => pageErrors.push({ category: "unexpected-page-error", path: locationPath(page.url(), COMMUNITY_TEST_ORIGIN) }));
  page.on("request", (request) => {
    const metadata = requestMetadata(request);
    inFlight.set(request, metadata);
    if (request.method() === "GET" && metadata.originKind === "test-origin" && metadata.path === ownedVideoPath) {
      if (pauseGateActive) delayedRequests.add(request);
    }
  });
  page.on("response", (response) => {
    const metadata = requestMetadata(response.request());
    metadata.responseStatus = response.status();
    metadata.responseAtEpochMs = Date.now();
    if (metadata.resource === "media" || (metadata.originKind === "test-origin" &&
        (metadata.path === ownedVideoPath || isOwnedStorageMediaPath(metadata)))) {
      const headers = response.headers();
      const contentLength = Number(headers["content-length"]);
      const rawRanges = headers["accept-ranges"]?.toLowerCase();
      const rawDisposition = headers["content-disposition"]?.toLowerCase();
      const rawCacheControl = headers["cache-control"]?.toLowerCase() ?? "";
      metadata.safeMediaResponseHeaders = {
        contentType: headers["content-type"]?.split(";")[0]?.trim().toLowerCase().match(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/)?.[0] ?? null,
        contentLength: Number.isSafeInteger(contentLength) && contentLength >= 0 ? contentLength : null,
        acceptRanges: rawRanges === "bytes" ? "bytes" : rawRanges === "none" ? "none" : null,
        contentDisposition: rawDisposition?.startsWith("inline") ? "inline" : rawDisposition?.startsWith("attachment") ? "attachment" : rawDisposition ? "other" : null,
        cacheControl: rawCacheControl.includes("no-store") ? "no-store" : rawCacheControl.includes("private") ? "private"
          : rawCacheControl.includes("public") ? "public" : rawCacheControl ? "other" : null,
      };
    }
    if (faultActive && metadata.originKind === "test-origin" && metadata.path === ownedVideoPath && response.status() === 503 &&
        !controlledFaultResponses.some((entry) => entry.requestId === metadata.requestId)) controlledFaultResponses.push(metadata);
    const contentRange = response.headers()["content-range"];
    metadata.contentRange = contentRange ? /^bytes \d{1,16}-\d{1,16}\/(?:\d{1,16}|\*)$/.test(contentRange) ? contentRange : "unknown-content-range" : null;
    if (metadata.originKind === "test-origin" && metadata.path === ownedVideoPath && response.status() >= 300 && response.status() < 400) {
      const location = response.headers()["location"];
      if (location) {
        try {
          const target = new URL(location, response.url());
          metadata.redirectTargetPath = target.pathname;
          metadata.redirectTargetOrigin = target.origin;
          metadata.redirectTargetOriginKind = target.origin === COMMUNITY_TEST_ORIGIN ? "test-origin"
            : ["localhost", "127.0.0.1", "::1"].includes(target.hostname) ? "loopback" : "other-origin";
        } catch { metadata.redirectTargetOriginKind = "other-origin"; }
      }
    }
  });
  page.on("requestfinished", (request) => {
    const metadata = requestMetadata(request);
    metadata.finishedAtEpochMs = Date.now();
    if (metadata.resource === "media" ||
        (metadata.originKind === "test-origin" && metadata.path === ownedVideoPath) || isOwnedStorageMediaPath(metadata)) {
      const terminal = { ...metadata, terminal: "finished", finishedAtEpochMs: Date.now(), redirectChain: [] as RequestMetadata[] };
      for (let previous = request.redirectedFrom(); previous; previous = previous.redirectedFrom()) terminal.redirectChain.unshift(requestMetadata(previous));
      diagnosticWork.push((async () => {
        const sizes = await request.sizes();
        successfulMedia.push({ ...terminal, ...requestMetadata(request), responseBodyBytes: sizes.responseBodySize });
      })().catch(() => { successfulMedia.push({ ...terminal, sizesStatus: "unavailable" }); }));
    }
    inFlight.delete(request);
  });
  page.on("requestfailed", (request) => {
    const redirectChain: RequestMetadata[] = [];
    for (let previous = request.redirectedFrom(); previous; previous = previous.redirectedFrom()) redirectChain.unshift({ ...requestMetadata(previous) });
    const failureRecord: FailedRequest = { ...(inFlight.get(request) ?? requestMetadata(request)),
      error: networkErrorCategory(request), phaseAtFailure: phase, failedAtEpochMs: Date.now(), redirectChain,
      expectedPause: false, pauseGateRequest: delayedRequests.has(request), pauseRequestedAtFailure: pauseConfirmed, expectedFault: false };
    failed.push(failureRecord);
    diagnosticWork.push(request.sizes().then((sizes) => { failureRecord.responseBodyBytes = sizes.responseBodySize; }).catch(() => undefined));
    inFlight.delete(request);
  });
  function correlateControlledFaultArrivals(gate: MediaGateState) {
    const arrivals = gate.requestArrivals ?? [];
    if (gate.armed !== true || gate.path !== ownedVideoPath || gate.mode !== "http-503" || gate.arrivals < 1 ||
        gate.arrivals !== gate.http503 || arrivals.length !== gate.arrivals ||
        arrivals.some((arrival) => arrival.outcome !== "http-503" || arrival.responseStatus !== 503 ||
          typeof arrival.responseAtEpochMs !== "number" || arrival.responseAtEpochMs < arrival.arrivedAtEpochMs)) return [];
    const webkit = testInfo.project.use.browserName === "webkit";
    const expectedResource = webkit ? "other" : "media";
    const responseCandidates = controlledFaultResponses.filter((request) => request.phaseAtStart === "controlled-fault:navigation" &&
      request.originKind === "test-origin" && request.path === gate.path && request.method === "GET" && request.resource === expectedResource && request.responseStatus === 503 &&
      typeof request.responseAtEpochMs === "number" && typeof request.finishedAtEpochMs === "number");
    const failureCandidates = failed.filter((request) => request.phaseAtStart === "controlled-fault:navigation" &&
      request.originKind === "test-origin" && request.path === gate.path && request.method === "GET" && request.resource === expectedResource &&
      ((request.responseStatus === 503 && request.error === "net::ERR_ABORTED") ||
        (webkit && request.responseStatus === null && ["Load request cancelled", "NS_BINDING_ABORTED"].includes(request.error ?? ""))));
    if (responseCandidates.length + failureCandidates.length !== arrivals.length ||
        new Set([...responseCandidates, ...failureCandidates].map((request) => request.requestId)).size !== arrivals.length) return [];
    const assignments = arrivals.map((arrival) => {
      const responseMatches = responseCandidates.filter((request) => request.method === arrival.method &&
        request.startedAtEpochMs <= arrival.arrivedAtEpochMs + 100 && request.responseAtEpochMs! >= arrival.responseAtEpochMs! - 100 &&
        request.finishedAtEpochMs! >= request.responseAtEpochMs! && (request.allHeadersRange ?? request.range) === arrival.range)
        .map((request) => ({ arrival, request, terminalAtEpochMs: arrival.responseAtEpochMs!, terminal: "response" as const }));
      const failureMatches = failureCandidates.filter((request) => request.method === arrival.method &&
        request.startedAtEpochMs <= arrival.arrivedAtEpochMs + 100 && request.failedAtEpochMs >= arrival.responseAtEpochMs! - 100 &&
        (request.allHeadersRange ?? request.range) === arrival.range)
        .map((request) => ({ arrival, request, terminalAtEpochMs: arrival.responseAtEpochMs!, terminal: "requestfailed" as const }));
      const matches = [...responseMatches, ...failureMatches];
      return matches.length === 1 ? matches[0] : null;
    });
    if (assignments.some((entry) => entry === null)) return [];
    const matched = assignments as Array<{ arrival: NonNullable<MediaGateState["requestArrivals"]>[number]; request: RequestMetadata;
      terminalAtEpochMs: number; terminal: "response" | "requestfailed" }>;
    if (new Set(matched.map(({ request }) => request.requestId)).size !== matched.length ||
        new Set(matched.map(({ arrival }) => arrival.sequence)).size !== matched.length) return [];
    for (const match of matched) {
      if (match.terminal !== "requestfailed") continue;
      const failure = failed.find((request) => request.requestId === match.request.requestId);
      const received503ThenAborted = failure?.responseStatus === 503 && failure.error === "net::ERR_ABORTED";
      const webkitCancelledWithoutResponse = webkit && failure?.responseStatus === null &&
        ["Load request cancelled", "NS_BINDING_ABORTED"].includes(failure.error ?? "");
      if (!failure || (!received503ThenAborted && !webkitCancelledWithoutResponse)) return [];
      failure.expectedFault = true;
      failure.controlledFaultArrivalSequences = [match.arrival.sequence];
    }
    return matched;
  }
  try {
    const book = await fixtures.product("Controlled product media preview");
    const rows: Array<Record<string, unknown>> = [];
    async function asset(kind: "cover" | "gallery" | "video", bytes: Buffer, filename: string, index = 0) {
      const id = randomUUID();
      const bucket = kind === "video" ? "public-videos" : "public-media";
      const storagePath = `products/${book.id}/${kind}/${id}-${filename}`;
      const contentType = kind === "video" ? "video/mp4" : "image/png";
      expect(fixtures.products).toContain(book.id);
      expect((await fixtures.service.storage.from(bucket).upload(storagePath, bytes, { contentType, upsert: false })).error).toBeNull();
      objects.push({ bucket, path: storagePath });
      const stored = await fixtures.service.storage.from(bucket).download(storagePath);
      expect(stored.error).toBeNull();
      const storedBytes = Buffer.from(await stored.data!.arrayBuffer());
      expect(storedBytes).toEqual(bytes);
      if (kind === "video") {
        ownedVideoStorageReadbackSha256 = createHash("sha256").update(storedBytes).digest("hex");
      }
      rows.push({ id, product_id: book.id, kind, bucket, path: storagePath, filename, content_type: contentType,
        size_bytes: bytes.length, title: filename, locale: "en", sort_order: index, is_public: true, is_active: true, storage_provider: "supabase" });
      return id;
    }
    const cover = await asset("cover", await sharp({ create: { width: 850, height: 1100, channels: 3, background: "#c4d1ba" } }).png().toBuffer(), "fixture-cover.png");
    for (const [index, [width, height]] of [[2000, 2000], [1200, 1800], [1700, 2200]].entries()) {
      await asset("gallery", await sharp({ create: { width, height, channels: 3, background: ["#a5b7c6", "#c6b7a5", "#b7c6a5"][index] } }).png().toBuffer(), `fixture-page-${index}.png`, index + 1);
    }
    const videoBytes = await readFile(path.resolve("tests/e2e/fixtures/issue-127/flower.mp4"));
    ownedVideoBytes = videoBytes.length;
    const videoFixtureSha256 = createHash("sha256").update(videoBytes).digest("hex");
    const video = await asset("video", videoBytes, "fixture-film.mp4");
    if (ownedVideoStorageReadbackSha256 !== videoFixtureSha256) throw new Error("The owned video fixture hash and Storage readback hash do not match.");
    ownedVideoContent = { byteLength: videoBytes.length, fixtureSha256: videoFixtureSha256,
      storageReadbackSha256: ownedVideoStorageReadbackSha256 };
    expect((await fixtures.service.from("product_assets").insert(rows)).error).toBeNull();
    expect((await fixtures.service.from("products").update({ cover_asset_id: cover, video_asset_id: video }).eq("id", book.id)).error).toBeNull();
    expect((await fixtures.service.from("product_assets").select("id").eq("product_id", book.id)).data).toHaveLength(5);
    await page.addInitScript(() => localStorage.setItem("ll_cookie_consent", JSON.stringify({ essential: true, analytics: false })));
    const videoPath = `/api/media/${video}`;
    ownedVideoPath = videoPath;
    ownedStoragePath = `/storage/v1/object/sign/public-videos/${objects.find((object) => object.bucket === "public-videos")!.path}`;
    const ownedSources: OwnedMediaSource[] = [ownedVideoPath, ownedStoragePath].map((ownedPath) => ({ origin: COMMUNITY_TEST_ORIGIN, path: ownedPath }));
    async function diagnosePlainVideoAfterStall(stage: string) {
      const posterSrc = await page.locator("video").getAttribute("poster");
      const uiState = { playButtonVisible: await page.getByTestId("product-video-play").isVisible().catch(() => false),
        posterImagePresent: await page.locator("video[data-flipthrough]").locator("xpath=../img").count() > 0 };
      const componentState = await page.locator("video").evaluate((element) => {
        const video = element as HTMLVideoElement;
        const box = video.getBoundingClientRect();
        const style = getComputedStyle(video);
        return { currentTime: video.currentTime, readyState: video.readyState, networkState: video.networkState,
          paused: video.paused, errorCode: video.error?.code ?? null, playbackRate: video.playbackRate,
          width: box.width, height: box.height, objectFit: style.objectFit, position: style.position,
          buffered: Array.from({ length: video.buffered.length }, (_, index) => ({ start: video.buffered.start(index), end: video.buffered.end(index) })) };
      });
      await page.evaluate((source) => {
        document.body.replaceChildren();
        const video = document.createElement("video");
        video.id = "ux127-plain-retry-diagnostic";
        video.controls = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.src = source;
        const button = document.createElement("button");
        button.textContent = "Play plain retry diagnostic";
        button.addEventListener("click", () => { void video.play().catch(() => undefined); });
        document.body.append(video, button);
      }, videoPath);
      await page.getByRole("button", { name: "Play plain retry diagnostic" }).click();
      const plainProgressed = await expect.poll(() => page.locator("#ux127-plain-retry-diagnostic")
        .evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 5_000 })
        .toBeGreaterThan(0.2).then(() => true).catch(() => false);
      const plainState = await page.locator("#ux127-plain-retry-diagnostic").evaluate((element) => {
        const video = element as HTMLVideoElement;
        return { currentTime: video.currentTime, readyState: video.readyState, networkState: video.networkState,
          paused: video.paused, errorCode: video.error?.code ?? null, playbackRate: video.playbackRate,
          buffered: Array.from({ length: video.buffered.length }, (_, index) => ({ start: video.buffered.start(index), end: video.buffered.end(index) })) };
      });
      await page.locator("#ux127-plain-retry-diagnostic").evaluate((element) => (element as HTMLVideoElement).pause());
      await Promise.all(diagnosticWork);
      await page.evaluate(({ source, poster }) => {
        document.body.replaceChildren();
        const figure = document.createElement("figure");
        figure.className = "group";
        const frame = document.createElement("div");
        frame.className = "relative aspect-video overflow-hidden rounded-[1.25rem] border border-[var(--color-border)] bg-[var(--color-bg-alt)] shadow-[0_16px_40px_rgba(62,52,47,0.08)]";
        const video = document.createElement("video");
        video.id = "ux127-styled-diagnostic-video";
        video.dataset.flipthrough = "";
        video.controls = true; video.playsInline = true; video.preload = "metadata"; video.src = source;
        video.className = "absolute inset-0 size-full object-contain";
        video.setAttribute("aria-label", "Inside the book: flip-through preview");
        if (poster) video.poster = poster;
        const cover = document.createElement("img");
        cover.alt = ""; cover.setAttribute("aria-hidden", "true"); cover.className = "pointer-events-none absolute inset-0 size-full object-contain";
        if (poster) cover.src = poster;
        const button = document.createElement("button");
        button.textContent = "Play styled diagnostic video";
        button.className = "absolute left-1/2 top-1/2 min-h-11 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white px-6 py-3 font-semibold text-[var(--color-ink)] shadow-lg";
        button.addEventListener("click", () => { button.remove(); void video.play().catch(() => undefined); });
        video.addEventListener("playing", () => cover.remove());
        frame.append(video, cover, button); figure.append(frame); document.body.append(figure);
      }, { source: videoPath, poster: posterSrc });
      await page.getByRole("button", { name: "Play styled diagnostic video" }).click();
      const styledProgressed = await expect.poll(() => page.locator("#ux127-styled-diagnostic-video")
        .evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 5_000 })
        .toBeGreaterThan(0.2).then(() => true).catch(() => false);
      const styledState = await page.locator("#ux127-styled-diagnostic-video").evaluate((element) => {
        const video = element as HTMLVideoElement; const box = video.getBoundingClientRect(); const style = getComputedStyle(video);
        return { currentTime: video.currentTime, readyState: video.readyState, networkState: video.networkState,
          paused: video.paused, errorCode: video.error?.code ?? null, playbackRate: video.playbackRate,
          width: box.width, height: box.height, objectFit: style.objectFit, position: style.position,
          buffered: Array.from({ length: video.buffered.length }, (_, index) => ({ start: video.buffered.start(index), end: video.buffered.end(index) })) };
      });
      await page.locator("#ux127-styled-diagnostic-video").evaluate((element) => (element as HTMLVideoElement).pause());
      await Promise.all(diagnosticWork);
      const body = JSON.stringify({ testedSha, runId, project: testInfo.project.name, stage,
        acceptanceEvidence: false, uiState, componentState, plainProgressed, plainState, styledProgressed, styledState,
        stageRequests: ownedMediaTransportRequests.filter((entry) => entry.phaseAtStart === stage),
        completedMedia: successfulMedia.filter((entry) => (entry as { phaseAtStart?: string }).phaseAtStart === stage) }, null, 2);
      await writeFile(testInfo.outputPath("plain-video-playback-diagnostic-only.json"), body);
      await testInfo.attach("plain-video-playback-diagnostic-only", { body, contentType: "application/json" });
    }
    if (testInfo.project.use.browserName !== "webkit" && page.context().browser()?.browserType().name() === "chromium") {
      stopCdp = await observeOwnedMediaCdp(page, ownedSources, (value) => cdpMedia.push({ ...value, phaseAtReceipt: phase, receivedAtEpochMs: Date.now() }));
      cdpStatus = "OBSERVING";
    }
    if (useNativeMediaObserver) {
      await observeNativeMedia(page, ownedSources, (observation) => {
        if (!observation) observerErrors.push({ category: "invalid-native-observation" });
        else nativeTimeline.push({ ...observation, phaseAtReceipt: phase, receivedAtEpochMs: Date.now() });
      });
    }
    setPhase("range-probe");
    const range = await page.request.get(`${COMMUNITY_TEST_ORIGIN}${videoPath}`, { headers: { Range: "bytes=0-127" } });
    expect(range.status()).toBe(206); expect(range.headers()["content-type"]).toContain("video/mp4");
    expect(range.headers()["content-range"]).toMatch(/^bytes 0-127\//); expect((await range.body()).length).toBe(128);
    const timings: Array<{ cache: string; clickToFrameMs: number | null }> = [];
    for (const cache of ["cold-media", "warm-media"]) {
      await resetDocument(`${COMMUNITY_TEST_ORIGIN}/en/products/${book.slug}`, `${cache}:navigation`);
      setPhase(`${cache}:video-intent`);
      const player = page.locator("video[data-flipthrough]");
      if (!isWebKit) {
        await expect(player).toBeAttached();
        await page.evaluate(() => {
          type LifecycleWindow = Window & { __ux127VideoDomTransitions?: Array<Record<string, unknown>> };
          const target = window as LifecycleWindow;
          const transitions: Array<Record<string, unknown>> = [];
          target.__ux127VideoDomTransitions = transitions;
          const nodeIds = new WeakMap<Node, number>();
          const videoIds = new WeakMap<HTMLVideoElement, number>();
          let nextNodeId = 0;
          let nextVideoId = 0;
          const nodeId = (node: Node | null) => {
            if (!node) return null;
            let id = nodeIds.get(node);
            if (!id) { id = ++nextNodeId; nodeIds.set(node, id); }
            return id;
          };
          const videoId = (video: HTMLVideoElement) => {
            let id = videoIds.get(video);
            if (!id) { id = ++nextVideoId; videoIds.set(video, id); }
            return id;
          };
          const candidates = (node: Node) => node instanceof HTMLVideoElement && node.matches("video[data-flipthrough]")
            ? [node] : node instanceof Element ? Array.from(node.querySelectorAll<HTMLVideoElement>("video[data-flipthrough]")) : [];
          const sourcePath = (video: HTMLVideoElement) => {
            try { return new URL(video.currentSrc || video.src, location.href).pathname; } catch { return "[invalid-source]"; }
          };
          const record = (action: string, video: HTMLVideoElement, mutationNode: Node, mutationTarget: Node) => ({
            action, atEpochMs: Date.now(), atPerformanceMs: performance.now(), videoId: videoId(video),
            mutationNodeId: nodeId(mutationNode), mutationNodeTag: mutationNode instanceof Element ? mutationNode.tagName : mutationNode.nodeName,
            mutationTargetId: nodeId(mutationTarget), mutationTargetTag: mutationTarget instanceof Element ? mutationTarget.tagName : mutationTarget.nodeName,
            currentParentId: nodeId(video.parentNode), currentParentTag: video.parentElement?.tagName ?? null,
            connected: video.isConnected, sourcePath: sourcePath(video), paused: video.paused,
            readyState: video.readyState, networkState: video.networkState, errorCode: video.error?.code ?? null,
          });
          const initial = document.querySelector<HTMLVideoElement>("video[data-flipthrough]");
          if (initial) transitions.push({ action: "initial", atEpochMs: Date.now(), atPerformanceMs: performance.now(), videoId: videoId(initial),
            currentParentId: nodeId(initial.parentNode), currentParentTag: initial.parentElement?.tagName ?? null,
            connected: initial.isConnected, sourcePath: sourcePath(initial), paused: initial.paused,
            readyState: initial.readyState, networkState: initial.networkState, errorCode: initial.error?.code ?? null });
          new MutationObserver((records) => {
            for (const mutation of records) {
              for (const node of mutation.removedNodes) for (const video of candidates(node)) transitions.push(record("containing-subtree-removed", video, node, mutation.target));
              for (const node of mutation.addedNodes) for (const video of candidates(node)) transitions.push(record("containing-subtree-added", video, node, mutation.target));
            }
          }).observe(document, { childList: true, subtree: true });
        });
      }
      await player.scrollIntoViewIfNeeded();
      await expect(player).toHaveAttribute("controls", ""); await expect(player).toHaveAttribute("playsinline", "");
      await expect(page.getByText("fixture-film.mp4", { exact: true })).toHaveCount(0);
      if (useClickFrameMeasurement) {
        await player.evaluate((element) => {
          const video = element as HTMLVideoElement;
          const target = window as unknown as { mediaTiming: { click: number; frame: number | null } };
          target.mediaTiming = { click: 0, frame: null };
          document.querySelector('[data-testid="product-video-play"]')!.addEventListener("click", () => {
            target.mediaTiming.click = performance.now();
            const requestFrame = video.requestVideoFrameCallback;
            if (typeof requestFrame === "function") requestFrame.call(video, () => { target.mediaTiming.frame = performance.now(); });
            else video.addEventListener("timeupdate", () => { target.mediaTiming.frame ??= performance.now(); }, { once: true });
          }, { capture: true, once: true });
        });
      }
      setPhase(`${cache}:video-play`);
      await page.getByTestId("product-video-play").click();
      const coldProgressed = await expect.poll(() => player.evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 20_000 })
        .toBeGreaterThan(0.2).then(() => true).catch(async () => {
          if (isWebKit) await diagnosePlainVideoAfterStall(`${cache}:video-play`);
          return false;
        });
      expect(coldProgressed, `The real product video must advance during ${cache} playback.`).toBe(true);
      if (!isWebKit) {
        videoDomLifecycleByCache[cache] = await page.evaluate(() =>
          ((window as Window & { __ux127VideoDomTransitions?: Array<Record<string, unknown>> }).__ux127VideoDomTransitions ?? []).map((entry) => ({ ...entry })));
        const domLifecycle = videoDomLifecycleByCache[cache];
        const initialDomState = domLifecycle.find((entry) => entry.action === "initial");
        expect(initialDomState).toBeDefined();
        expect(domLifecycle.every((entry) => entry.videoId === initialDomState!.videoId && entry.connected === true &&
          entry.sourcePath === videoPath && entry.currentParentId === initialDomState!.currentParentId)).toBe(true);
        expect(domLifecycle.filter((entry) => entry.mutationNodeTag === "VIDEO")).toHaveLength(0);
      }
      if (useClickFrameMeasurement) {
        await expect.poll(() => page.evaluate(() => (window as unknown as { mediaTiming: { frame: number | null } }).mediaTiming.frame)).not.toBeNull();
        const timing = await page.evaluate(() => (window as unknown as { mediaTiming: { click: number; frame: number } }).mediaTiming);
        expect(timing.click).toBeGreaterThan(0); expect(timing.frame).toBeGreaterThanOrEqual(timing.click);
        timings.push({ cache, clickToFrameMs: timing.frame - timing.click });
      } else timings.push({ cache, clickToFrameMs: null });
      setPhase(`${cache}:pause-and-seek`);
      const postSeekFrame = await seekAndPaint(player);
      await testInfo.attach(`${cache}-post-seek-frame`, { body: JSON.stringify({ testedSha, runId, ...postSeekFrame }), contentType: "application/json" });
      expect(await player.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
      await capture(page, cache);
    }
    // Delay the actual application media request, then deliberately pause native
    // pending playback. No synthetic response replaces the stored MP4 bytes.
    pauseGateActive = true;
    await controlIssue127MediaGate("arm", videoPath, "hold");
    try {
      await resetDocument(`${COMMUNITY_TEST_ORIGIN}/en/products/${book.slug}`, "pending-playback:navigation");
      await page.locator("video").scrollIntoViewIfNeeded();
      await expect.poll(async () => {
        const state = await readIssue127MediaGateState();
        return state.armed && state.path === videoPath ? state.arrivals : 0;
      }, { timeout: 8_000 }).toBeGreaterThan(0);
      await page.evaluate(() => {
        const events = { waiting: 0, stalled: 0 };
        (window as unknown as { mediaWaitEvents: typeof events }).mediaWaitEvents = events;
        const observe = (event: Event) => {
          if (event.target instanceof HTMLVideoElement && event.target.matches("video[data-flipthrough]")) {
            events[event.type as keyof typeof events] += 1;
          }
        };
        // Capture at document level instead of retaining one video node, so the
        // probe stays valid if a future recovery path replaces the native player.
        document.addEventListener("waiting", observe, true);
        document.addEventListener("stalled", observe, true);
      });
      setPhase("pending-playback:play");
      await page.getByTestId("product-video-play").click();
      await expect(page.getByRole("status").filter({ hasText: "Preparing video" })).toBeVisible();
      await expect.poll(() => page.evaluate(() => (window as unknown as { mediaWaitEvents: { waiting: number } }).mediaWaitEvents.waiting)).toBeGreaterThan(0);
      setPhase("pending-playback:deliberate-pause");
      pauseActionStartedAtEpochMs = Date.now();
      await page.getByTestId("product-video-pause").click();
      await expect(page.getByTestId("product-video-play")).toBeVisible();
      waitEvents = await page.evaluate(() => (window as unknown as { mediaWaitEvents: typeof waitEvents }).mediaWaitEvents);
      expect(await page.locator("video").evaluate((element) => (element as HTMLVideoElement).paused)).toBe(true);
      expect(await page.locator("video").evaluate((element) => (element as HTMLVideoElement).error?.code ?? null)).toBeNull();
      pauseActionConfirmedAtEpochMs = Date.now();
      pauseConfirmed = true;
      const pauseRequestFailed = await expect.poll(() => failed.some((request) => request.pauseGateRequest &&
        request.method === "GET" && request.path === videoPath), { timeout: 1_000 }).toBe(true).then(() => true).catch(() => false);
      const heldAfterPause = await readIssue127MediaGateState();
      expect(heldAfterPause).toMatchObject({ armed: true, path: videoPath, mode: "hold", arrivals: 1, released: 0, aborted: 0 });
      expect(heldAfterPause.clientClosed).toBe(pauseRequestFailed ? 1 : 0);
      expect(heldAfterPause.requestArrivals).toHaveLength(1);
      mediaGateSnapshots.push({ checkpoint: "pending-playback-after-pause", armed: heldAfterPause.armed,
        mode: heldAfterPause.mode ?? null, arrivals: heldAfterPause.arrivals, clientClosed: heldAfterPause.clientClosed,
        released: heldAfterPause.released, aborted: heldAfterPause.aborted, requestArrivals: heldAfterPause.requestArrivals ?? [] });
      setPhase("pending-playback:resume");
      await controlIssue127MediaGate("release", videoPath);
      const releasedGate = await readIssue127MediaGateState();
      mediaGateSnapshots.push({ checkpoint: "pending-playback-after-release", armed: releasedGate.armed,
        mode: releasedGate.mode ?? null, arrivals: releasedGate.arrivals, clientClosed: releasedGate.clientClosed,
        released: releasedGate.released, aborted: releasedGate.aborted, requestArrivals: releasedGate.requestArrivals ?? [] });
      await expect(page.getByRole("alert").filter({ hasText: "video could not" })).toHaveCount(0);
      // Wait for the exact real Storage response to expose the whole object
      // range (or finish a full 200) and for native canplay. Chromium may keep
      // its media response open while paused, so requestfinished is not a
      // portable readiness signal across browser engines.
      await expect.poll(() => ownedMediaTransportRequests.some((request) =>
        request.originKind === "test-origin" && request.path === ownedStoragePath && request.phaseAtStart === "pending-playback:resume" &&
        ((request.responseStatus === 200 && successfulMedia.some((finished) => finished.requestId === request.requestId &&
          finished.originKind === "test-origin" && finished.path === ownedStoragePath &&
          finished.phaseAtStart === "pending-playback:resume" && finished.responseBodyBytes === ownedVideoBytes)) ||
          (request.responseStatus === 206 && request.contentRange === `bytes 0-${ownedVideoBytes - 1}/${ownedVideoBytes}`)))).toBe(true);
      await expect.poll(() => page.locator("video").evaluate((element) => (element as HTMLVideoElement).readyState))
        .toBeGreaterThanOrEqual(3);
      await page.getByTestId("product-video-play").click();
      await expect.poll(() => page.locator("video").evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 20_000 }).toBeGreaterThan(0.2);
      setPhase("pending-playback:completed-pause");
      await page.locator("video").evaluate((element) => (element as HTMLVideoElement).pause());
    } finally {
      pauseGateActive = false;
      await controlIssue127MediaGate("release", videoPath).catch(() => undefined);
      await controlIssue127MediaGate("disarm", videoPath);
    }
    // Controlled empty HTTP failure, then real stored-byte recovery. The local
    // gate returns no media bytes; Retry reads the actual owned Storage object.
    faultActive = true;
    await controlIssue127MediaGate("arm", videoPath, "http-503");
    try {
      await resetDocument(`${COMMUNITY_TEST_ORIGIN}/en/products/${book.slug}`, "controlled-fault:navigation");
      await page.locator("video").scrollIntoViewIfNeeded();
      // Viewport preparation performs the actual metadata fetch. Wait for its
      // exact injected failure; native onError can remove Play before a click.
      await expect(page.locator("video")).toHaveAttribute("preload", "metadata");
      await expect(page.getByRole("alert").filter({ hasText: "video could not be played" })).toBeVisible();
      await page.waitForTimeout(100);
      await Promise.all(diagnosticWork);
      const faultGate = await readIssue127MediaGateState();
      expect(faultGate).toMatchObject({ armed: true, path: videoPath, mode: "http-503" });
      expect(faultGate.http503).toBeGreaterThan(0);
      const injectedFaults = correlateControlledFaultArrivals(faultGate);
      const correlationDebug = JSON.stringify({
        gate: { armed: faultGate.armed, mode: faultGate.mode, arrivals: faultGate.arrivals, http503: faultGate.http503,
          requestArrivals: faultGate.requestArrivals ?? [] },
        browserResponses: controlledFaultResponses.map((request) => ({ requestId: request.requestId,
          method: request.method, resource: request.resource, startedAtEpochMs: request.startedAtEpochMs,
          responseAtEpochMs: request.responseAtEpochMs, finishedAtEpochMs: request.finishedAtEpochMs,
          range: request.range, allHeadersRange: request.allHeadersRange, responseStatus: request.responseStatus })),
        browserFailures: failed.filter((request) => request.path === videoPath && request.phaseAtStart === "controlled-fault:navigation")
          .map((request) => ({ requestId: request.requestId, method: request.method, resource: request.resource,
            startedAtEpochMs: request.startedAtEpochMs, failedAtEpochMs: request.failedAtEpochMs, range: request.range,
            allHeadersRange: request.allHeadersRange, responseStatus: request.responseStatus, error: request.error })),
        correlations: injectedFaults.map(({ arrival, request, terminal, terminalAtEpochMs }) => ({ arrivalSequence: arrival.sequence,
          requestId: request.requestId, terminal, terminalAtEpochMs, method: request.method, resource: request.resource,
          path: request.path, startedAtEpochMs: request.startedAtEpochMs, responseStatus: request.responseStatus,
          error: failed.find((entry) => entry.requestId === request.requestId)?.error ?? null })),
      }, null, 2);
      await writeFile(testInfo.outputPath("controlled-fault-correlation.json"), correlationDebug);
      await testInfo.attach("controlled-fault-correlation", { body: correlationDebug, contentType: "application/json" });
      expect(injectedFaults).toHaveLength(faultGate.arrivals);
      expect(new Set(injectedFaults.map(({ arrival }) => arrival.sequence)).size).toBe(faultGate.arrivals);
      const injectedFaultIds = new Set(injectedFaults.map(({ request }) => request.requestId));
      const injectedFaultTimes = new Map(injectedFaults.map(({ request, terminalAtEpochMs }) => [request.requestId, terminalAtEpochMs]));
      mediaGateSnapshots.push({ checkpoint: "controlled-fault-before-disarm", armed: faultGate.armed,
        mode: faultGate.mode ?? null, arrivals: faultGate.arrivals, clientClosed: faultGate.clientClosed,
        released: faultGate.released, aborted: faultGate.aborted, http503: faultGate.http503, requestArrivals: faultGate.requestArrivals ?? [],
        correlatedRequestIds: [...injectedFaultIds] });
      await Promise.all(diagnosticWork);
      if (useNativeMediaObserver) await expect.poll(() => nativeTimeline.some((event) => {
        if (event.event !== "error" || event.trusted !== true || event.mediaErrorPresent !== true || event.sourcePath !== videoPath) return false;
        return ownedMediaTransportRequests.some((request) => injectedFaultIds.has(request.requestId) &&
          request.identitySample?.status === "sampled" && typeof request.identitySample.timeOrigin === "number" &&
          event.documentId === request.identitySample?.documentId && event.elementId === request.identitySample?.elementId &&
          event.generation === request.identitySample?.generation && event.timeOrigin === request.identitySample.timeOrigin &&
          typeof event.atEpochMs === "number" &&
          event.atEpochMs >= (injectedFaultTimes.get(request.requestId) ?? request.startedAtEpochMs));
      })).toBe(true);
      await expect(page.getByRole("alert").filter({ hasText: "video could not be played" })).toBeVisible();
      if (!useNativeMediaObserver) {
        await expect.poll(() => page.locator("video").evaluate((element) => (element as HTMLVideoElement).error?.code ?? 0)).toBe(4);
      }
      await capture(page, "controlled-video-error");
    } finally {
      await controlIssue127MediaGate("disarm", videoPath);
      faultActive = false;
    }
    setPhase("controlled-fault:retry");
    await page.getByRole("button", { name: "Retry video", exact: true }).click();
    const retryProgressed = await expect.poll(() => page.locator("video").evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 20_000 })
      .toBeGreaterThan(0.2).then(() => true).catch(async () => {
        if (isWebKit) await diagnosePlainVideoAfterStall("controlled-fault:retry");
        return false;
      });
    expect(retryProgressed, "The recovered product video must advance after the real Storage retry.").toBe(true);
    await expect(page.getByRole("alert").filter({ hasText: "video could not be played" })).toHaveCount(0);
    faultActive = false;
    await seekAndPaint(page.locator("video"));
    await capture(page, "video-recovered-real-storage");
    // Observe a genuine tab switch rather than dispatching a fake visibility
    // event. Headless engines that keep it visible are recorded as such.
    const other = await page.context().newPage();
    let backgroundVisibility = "not-observed";
    let pausedOnReturn = false;
    let backgroundStartTime = 0;
    const backgroundSnapshots: Array<Record<string, unknown>> = [];
    const readBackgroundState = async (phase: string) => {
      const state = await page.locator("video").evaluate((element) => {
        const video = element as HTMLVideoElement;
        return { visibilityState: document.visibilityState, currentTime: video.currentTime, paused: video.paused,
          readyState: video.readyState, networkState: video.networkState, errorCode: video.error?.code ?? null,
          buffered: Array.from({ length: video.buffered.length }, (_, index) => ({ start: video.buffered.start(index), end: video.buffered.end(index) })) };
      });
      const snapshot = { phase, ...state };
      backgroundSnapshots.push(snapshot);
      return snapshot;
    };
    try {
      await bounded(other.bringToFront(), "Opening the secondary browser tab");
      setPhase("tab-switch:starting-video");
      await bounded(page.bringToFront(), "Returning to the media page before playback");
      // The real fixture is five seconds long. Rewind, confirm actual playback
      // progress, and foreground another page before the clip can finish.
      await page.locator("video").evaluate(async (element) => {
        const video = element as HTMLVideoElement;
        if (video.currentTime > 0) {
          const seeked = new Promise<void>((resolve) => video.addEventListener("seeked", () => resolve(), { once: true }));
          video.currentTime = 0;
          await seeked;
        }
      });
      await page.locator("video").evaluate((element) => {
        // Do not await play(): WebKit can leave its promise pending until the
        // short fixture has buffered or ended. Playback state and progress are
        // asserted against the actual media element below.
        void (element as HTMLVideoElement).play().catch(() => undefined);
      });
      await expect.poll(() => page.locator("video").evaluate((element) => (element as HTMLVideoElement).paused), { timeout: 2_000 }).toBe(false);
      await expect.poll(() => page.locator("video").evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 8_000 })
        .toBeGreaterThan(0.1);
      backgroundStartTime = await page.locator("video").evaluate((element) => (element as HTMLVideoElement).currentTime);
      await readBackgroundState("playback-confirmed-before-background");
      setPhase("tab-switch:background");
      await bounded(other.bringToFront(), "Bringing the secondary browser tab to the foreground");
      backgroundVisibility = await page.evaluate(() => document.visibilityState);
      // Local Chromium/WebKit Playwright targets can report every page visible
      // while another target is foregrounded. Record the browser's actual signal
      // without treating page.bringToFront() as proof of a hidden native tab.
      await readBackgroundState("secondary-tab-foreground");
      setPhase("tab-switch:return");
      await bounded(page.bringToFront(), "Returning to the media page");
      await expect.poll(() => page.evaluate(() => document.visibilityState), { timeout: 2_000 }).toBe("visible");
      expect(await page.locator("video").evaluate((element) => Boolean((element as HTMLVideoElement).error))).toBe(false);
      await readBackgroundState("media-tab-restored");
      pausedOnReturn = await page.locator("video").evaluate((element) => (element as HTMLVideoElement).paused);
      if (pausedOnReturn) {
        // A trusted native-control gesture; keyboard activation avoids browser-specific
        // control-bar geometry while preserving the real visibility transition.
        setPhase("tab-switch:trusted-key-resume");
        await bounded(page.locator("video").focus(), "Focusing the native video control");
        await bounded(page.keyboard.press("Space"), "Resuming native video playback");
        await expect.poll(() => page.locator("video").evaluate((element) => (element as HTMLVideoElement).paused)).toBe(false);
      }
      const returnStartTime = await page.locator("video").evaluate((element) => (element as HTMLVideoElement).currentTime);
      setPhase("tab-switch:wait-for-progress");
      try {
        await expect.poll(() => page.locator("video").evaluate((element) => (element as HTMLVideoElement).currentTime), { timeout: 8_000 })
          .toBeGreaterThan(returnStartTime + 0.2);
      } catch (error) {
        await readBackgroundState("progress-timeout");
        const diagnostic = JSON.stringify({ testedSha, runId, backgroundVisibility, pausedOnReturn, backgroundStartTime, backgroundSnapshots }, null, 2);
        await testInfo.attach("background-tab-return-diagnostics", { body: diagnostic, contentType: "application/json" });
        throw error;
      }
      await readBackgroundState("progress-confirmed-after-return");
      await seekAndPaint(page.locator("video"));
      await capture(page, "video-after-tab-return");
    } finally { setPhase("tab-switch:close-secondary"); await other.close(); }
    const opener = page.getByRole("button", { name: "Open image 1", exact: true });
    setPhase("gallery:thumbnail-intent");
    await opener.scrollIntoViewIfNeeded();
    setPhase("gallery:open");
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Image preview" });
    await expect(dialog.getByRole("status")).toHaveCount(0);
    const image = dialog.locator("[data-gallery-display]").first();
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(2000);
    await capture(page, "decoded-gallery");
    await drainBeforeReset("gallery-close");
    setPhase("gallery:close");
    await page.keyboard.press("Escape"); await expect(opener).toBeFocused();
    await drainBeforeReset("final-document-teardown");
    await finalizeNextRequests();
    await testInfo.attach("real-storage-media-evidence", { body: JSON.stringify({ testedSha, runId, project: testInfo.project.name, timings, consoleErrors, expectedFaultConsole, pageErrors, failed, controlledFaultResponses,
      metadataResumeProofs: [...metadataResumeProofs.entries()].map(([requestId, proof]) => ({ requestId, ...proof })),
      rangeContinuationProofs: [...rangeContinuationProofs.entries()].map(([requestId, proof]) => ({ requestId, ...proof })),
      backgroundVisibility, pausedOnReturn, backgroundStartTime, backgroundSnapshots, waitEvents,
      ownedMedia: { apiPath: ownedVideoPath, storagePath: ownedStoragePath, origin: COMMUNITY_TEST_ORIGIN }, ownedVideoContent,
      videoDomLifecycleByCache,
      optimizerSelection: "NOT APPLICABLE to unoptimized authenticated Supabase fallback; tested separately in local-demo optimized image campaign" }), contentType: "application/json" });
    setPhase("network:assertions");
    await networkSnapshot("before-assertions");
    expect(pageErrors).toEqual([]); expect(consoleErrors).toEqual([]); expect(observerErrors).toEqual([]); expect(nextFinalizationFailed).toBe(false);
    for (const request of failed) {
      const metadataResume = metadataResumeProofs.get(request.requestId);
      if (metadataResume?.disposition === "EXPECTED_METADATA_SUSPEND_VERIFIED_RESUME") {
        expect(request.method).toBe("GET"); expect(request.resource).toBe("media"); expect(request.error).toBe("net::ERR_ABORTED");
        expect(metadataResume.canceledInitialResponseCompleted).toBe(false);
        continue;
      }
      if (request.validatedNextPrefetchId) {
        expect(request.method).toBe("GET"); expect(request.resource).toBe("fetch"); expect(request.rsc && request.prefetch).toBe(true);
        expect(request.error).toBe("net::ERR_ABORTED");
        continue;
      }
      const rangeContinuation = rangeContinuationProofs.get(request.requestId);
      if (rangeContinuation?.disposition === "EXPECTED_OWNED_NATIVE_FULL_RESPONSE_RANGE_REISSUE") {
        expect(isWebKit).toBe(false);
        // Metadata preload can start the native request before the Play click.
        // The classifier independently requires a later trusted Play intent,
        // a complete same-object range tail, and a decoded frame on this element.
        expect(["cold-media:video-intent", "cold-media:video-play", "warm-media:video-intent", "warm-media:video-play"])
          .toContain(request.phaseAtStart);
        expect(request.allHeadersRange ?? request.range).toBe("bytes=0-");
        expect(request.contentRange).toBe(`bytes 0-${ownedVideoBytes - 1}/${ownedVideoBytes}`);
        expect(request.responseBodyBytes).toBe(ownedVideoBytes);
        expect(rangeContinuation).toMatchObject({ receivedBytesBeforeAbort: ownedVideoBytes, requiresIndependentReview: true });
        expect(ownedVideoContent?.byteLength).toBe(ownedVideoBytes);
        expect(ownedVideoContent?.storageReadbackSha256).toBe(ownedVideoContent?.fixtureSha256);
        const cache = request.phaseAtStart.startsWith("warm-") ? "warm-media" : "cold-media";
        const cacheLifecycle = videoDomLifecycleByCache[cache] ?? [];
        const initial = cacheLifecycle.find((entry) => entry.action === "initial");
        expect(initial).toBeDefined();
        expect(cacheLifecycle.every((entry) => entry.videoId === initial!.videoId && entry.connected === true &&
          entry.sourcePath === videoPath && entry.currentParentId === initial!.currentParentId)).toBe(true);
        expect(cacheLifecycle.filter((entry) => entry.mutationNodeTag === "VIDEO")).toHaveLength(0);
      }
      if (rangeContinuation?.disposition === "EXPECTED_OWNED_NATIVE_RANGE_CONTINUATION" ||
          rangeContinuation?.disposition === "EXPECTED_OWNED_NATIVE_FULL_RESPONSE_RANGE_REISSUE") {
        expect(request.method).toBe("GET"); expect(request.resource).toBe("media");
        expect(request.originKind).toBe("test-origin"); expect(request.path).toBe(ownedStoragePath); expect(request.error).toBe("net::ERR_ABORTED");
        expect(request.responseStatus).toBe(206);
        continue;
      }
      expect(request.expectedPause || request.expectedFault).toBe(true); expect(request.method).toBe("GET"); expect(request.path).toBe(videoPath);
      if (request.expectedPause) {
        if (isWebKit) {
          expect(request.pauseActionWitness).toMatchObject({ gateArrivalSequence: 1, clientClosed: true });
          expect(request.failedAtEpochMs).toBeGreaterThanOrEqual(request.pauseActionWitness!.clickStartedAtEpochMs);
          expect(request.failedAtEpochMs).toBeLessThanOrEqual(request.pauseActionWitness!.pauseConfirmedAtEpochMs + 1_500);
        } else {
          expect(request.pauseWitness?.trusted && request.pauseWitness.paused).toBe(true);
          expect(request.pauseWitness!.atEpochMs).toBeLessThan(request.failedAtEpochMs);
        }
      }
      if (request.expectedFault) {
        expect(request.phaseAtStart).toBe("controlled-fault:navigation");
        expect(request.controlledFaultArrivalSequences).toHaveLength(1);
        if (request.responseStatus === 503) expect(request.error).toBe("net::ERR_ABORTED");
        else {
          expect(request.responseStatus).toBeNull();
          expect(isWebKit).toBe(true);
          expect(["Load request cancelled", "NS_BINDING_ABORTED"]).toContain(request.error);
        }
      }
      else expect(["net::ERR_ABORTED", "Load request cancelled", "NS_BINDING_ABORTED"]).toContain(request.error);
    }
    expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(testedSha);
    completed = true;
  } finally {
    let cleanupVerified = false;
    try {
      try { await finalizeNextRequests(); await networkSnapshot("finally-before-cleanup"); }
      finally {
      if (stopCdp) { try { await stopCdp(); } catch { observerErrors.push({ category: "invalid-native-observation" }); } stopCdp = null; }
      setPhase("fixture-cleanup");
      try {
    for (const bucket of new Set(objects.map((object) => object.bucket))) {
      const owned = objects.filter((object) => object.bucket === bucket).map((object) => object.path);
      if (owned.length) expect((await fixtures.service.storage.from(bucket).remove(owned)).error).toBeNull();
    }
      } finally { await fixtures.cleanup(); }
      cleanupVerified = true;
      }
    } finally {
    const sourceMatchesHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() === testedSha &&
      !execFileSync("git", ["status", "--porcelain", "--", "src", "tests", "scripts", "public", "messages", "package.json", "package-lock.json", "next.config.*", "playwright*.ts"], { encoding: "utf8" }).trim();
    const provenance = { testedSha, runId, cleanupVerified,
      status: completed && cleanupVerified ? sourceMatchesHead ? "PASS" : "WORKING_TREE" : "FAIL",
      observationMode: useNativeMediaObserver ? "native-event-trace-and-passive-network" : "passive-playwright-network-and-video-state",
      sourceMatchesHead, project: testInfo.project.name, tool: "Playwright", screenshots, networkDiagnostics };
    const body = JSON.stringify(provenance, null, 2);
    await writeFile(testInfo.outputPath("supabase-media-provenance.json"), body);
    await testInfo.attach("supabase-media-provenance", { body, contentType: "application/json" });
    }
  }
});

async function observeNativeMedia(page: Page, ownedSources: OwnedMediaSource[], receive: (value: Record<string, unknown> | null) => void) {
  const binding = `__ux127Media_${randomUUID().replaceAll("-", "")}`;
  const events = ["play", "playing", "pause", "waiting", "stalled", "abort", "emptied", "loadstart", "loadedmetadata", "loadeddata", "suspend", "canplay", "seeking", "seeked", "error", "ended", "pagehide", "beforeunload", "visibilitychange", "video-detached", "src-change", "load-call", "play-intent", "frame"];
  await page.exposeBinding(binding, (_source, input: unknown) => {
    if (!input || typeof input !== "object") { receive(null); return; }
    const value = input as Record<string, unknown>;
    const numbers = ["atEpochMs", "performanceMs", "timeOrigin", "currentTime", "readyState", "networkState", "errorCode", "generation", "mediaTime"];
    if (!/^doc-[a-f0-9-]{36}$/.test(String(value.documentId)) || !/^element-\d+$/.test(String(value.elementId)) || typeof value.event !== "string" || !events.includes(value.event) ||
      !numbers.every((key) => typeof value[key] === "number" && Number.isFinite(value[key])) ||
      ![0, 1, -1].includes(value.sourceIndex as number) ||
      !["none", "metadata", "auto", "empty", "unknown"].includes(value.preload as string) ||
      !["paused", "connected", "trusted", "documentHidden", "mediaErrorPresent"].every((key) => typeof value[key] === "boolean")) { receive(null); return; }
    // Reconstruct a bounded record; never spread arbitrary browser payloads.
    receive({ event: value.event, documentId: value.documentId, elementId: value.elementId, generation: value.generation, mediaTime: value.mediaTime, atEpochMs: value.atEpochMs, performanceMs: value.performanceMs, timeOrigin: value.timeOrigin,
      currentTime: value.currentTime, readyState: value.readyState, networkState: value.networkState, errorCode: value.errorCode, preload: value.preload, mediaErrorPresent: value.mediaErrorPresent,
      paused: value.paused, connected: value.connected, trusted: value.trusted, documentHidden: value.documentHidden,
      sourcePath: value.sourceIndex === 0 || value.sourceIndex === 1 ? ownedSources[value.sourceIndex].path : "[no-owned-media-source]" });
  });
  await page.addInitScript(({ binding, ownedSources }) => {
    let lastVideo: HTMLVideoElement | null = null;
    const documentId = `doc-${crypto.randomUUID()}`;
    let sequence = 0;
    const identities = new WeakMap<HTMLVideoElement, { elementId: string; generation: number }>();
    const identity = (video: HTMLVideoElement) => {
      let value = identities.get(video);
      if (!value) { value = { elementId: `element-${++sequence}`, generation: 0 }; identities.set(video, value); }
      return value;
    };
    (window as unknown as { __ux127ReadMediaIdentity: () => Record<string, unknown> }).__ux127ReadMediaIdentity = () => {
      const video = document.querySelector<HTMLVideoElement>("video[data-flipthrough]");
      if (!video) return { status: "no-video", documentId, sampledAtEpochMs: Date.now() };
      let sourceIndex = -1;
      try {
        const source = new URL(video.currentSrc || video.src, location.href);
        sourceIndex = ownedSources.findIndex((owned) => source.origin === owned.origin && source.pathname === owned.path);
      } catch { /* No raw source. */ }
      return { status: "sampled", documentId, ...identity(video), sourceIndex, sampledAtEpochMs: Date.now(), timeOrigin: performance.timeOrigin };
    };
    const emit = (video: HTMLVideoElement, event: string, trusted: boolean, mediaTime = -1) => {
      let sourceIndex = -1;
      try {
        const source = new URL(video.currentSrc || video.src, location.href);
        sourceIndex = ownedSources.findIndex((owned) => source.origin === owned.origin && source.pathname === owned.path);
      } catch { /* No raw URL is sent. */ }
      const payload = { event, documentId, ...identity(video), mediaTime, atEpochMs: Date.now(), performanceMs: performance.now(), timeOrigin: performance.timeOrigin,
        currentTime: video.currentTime, readyState: video.readyState, networkState: video.networkState, errorCode: video.error?.code ?? 0,
        preload: ["none", "metadata", "auto"].includes(video.preload) ? video.preload : video.preload === "" ? "empty" : "unknown",
        mediaErrorPresent: video.error !== null, paused: video.paused, connected: video.isConnected, trusted, documentHidden: document.hidden, sourceIndex };
      const report = (window as unknown as Record<string, (value: unknown) => Promise<void>>)[binding];
      void report(payload).catch(() => { /* A document may be disposed before its binding promise returns. */ });
    };
    const nativeLoad = HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.load = function () {
      if (this instanceof HTMLVideoElement && this.matches("[data-flipthrough]")) {
        identity(this).generation++; emit(this, "load-call", false);
      }
      return nativeLoad.call(this);
    };
    document.addEventListener("click", (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-testid="product-video-play"]')) return;
      const video = document.querySelector<HTMLVideoElement>("video[data-flipthrough]");
      if (video) emit(video, "play-intent", event.isTrusted);
    }, true);
    for (const name of ["play", "playing", "pause", "waiting", "stalled", "abort", "emptied", "loadstart", "loadedmetadata", "loadeddata", "suspend", "canplay", "seeking", "seeked", "error", "ended"]) {
      document.addEventListener(name, (event) => {
        if (event.target instanceof HTMLVideoElement && event.target.matches("[data-flipthrough]")) {
          lastVideo = event.target; emit(lastVideo, name, event.isTrusted);
          const video = lastVideo;
          if (name === "playing" && typeof video.requestVideoFrameCallback === "function") {
            const generation = identity(video).generation;
            const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
              if (identity(video).generation !== generation || !video.isConnected || video.paused) return;
              if (metadata.mediaTime > 0.2) emit(video, "frame", false, metadata.mediaTime);
              else video.requestVideoFrameCallback(onFrame);
            };
            video.requestVideoFrameCallback(onFrame);
          }
        }
      }, true);
    }
    for (const name of ["pagehide", "beforeunload", "visibilitychange"]) {
      (name === "visibilitychange" ? document : window).addEventListener(name, (event: Event) => {
        const video = document.querySelector<HTMLVideoElement>("video[data-flipthrough]") ?? lastVideo;
        if (video) emit(video, name, event.isTrusted);
      });
    }
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLVideoElement && record.target.matches("[data-flipthrough]")) {
          identity(record.target).generation++; emit(record.target, "src-change", false);
        }
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue;
          const removed = node instanceof HTMLVideoElement ? [node] : Array.from(node.querySelectorAll<HTMLVideoElement>("video[data-flipthrough]"));
          for (const candidate of removed) {
            // Mutation records may report an ancestor wrapper that was moved
            // while the native video remained connected. Only label a genuine
            // element detach after the batch has settled.
            if (identities.has(candidate) && !candidate.isConnected) emit(candidate, "video-detached", false);
          }
        }
      }
      const video = document.querySelector<HTMLVideoElement>("video[data-flipthrough]");
      lastVideo = video;
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  }, { binding, ownedSources });
}

function projectIdentitySample(input: Record<string, unknown>) {
  const number = (key: string) => typeof input[key] === "number" && Number.isFinite(input[key]) ? input[key] : null;
  return {
    status: ["sampled", "no-video", "identity-not-installed"].includes(String(input.status)) ? input.status : "invalid-identity-sample",
    documentId: /^doc-[a-f0-9-]{36}$/.test(String(input.documentId)) ? input.documentId : null,
    elementId: /^element-\d+$/.test(String(input.elementId)) ? input.elementId : null,
    generation: number("generation"), sourceIndex: [-1, 0, 1].includes(input.sourceIndex as number) ? input.sourceIndex : null,
    sampledAtEpochMs: number("sampledAtEpochMs"), timeOrigin: number("timeOrigin"),
  };
}

function locationPath(value: string, base: string) {
  try {
    const location = new URL(value || base, base);
    return location.protocol === "http:" || location.protocol === "https:" ? location.pathname : "[non-http-location]";
  } catch { return "[invalid-location]"; }
}

function locationOriginKind(value: string, expectedOrigin: string): "test-origin" | "loopback" | "other-origin" | "invalid-origin" {
  try {
    const location = new URL(value);
    if (location.protocol !== "http:" && location.protocol !== "https:") return "invalid-origin";
    if (location.origin === expectedOrigin) return "test-origin";
    return ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) ? "loopback" : "other-origin";
  } catch { return "invalid-origin"; }
}

function networkErrorCategory(request: Request) {
  const value = request.failure()?.errorText;
  const known = ["net::ERR_FAILED", "Load failed", "Unknown error", "Failed", "net::ERR_ABORTED", "Load request cancelled", "NS_BINDING_ABORTED"];
  return value && known.includes(value) ? value : "unknown-network-error";
}

async function settleVisibleMedia(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const visible = Array.from(document.images).filter((image) => {
      const box = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth && style.visibility !== "hidden" && style.display !== "none";
    });
    await Promise.all(visible.map((image) => image.decode()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function seekAndPaint(locator: Locator) {
  return locator.evaluate(async (element) => {
    const video = element as HTMLVideoElement;
    video.pause();
    const target = Math.min(1, video.duration / 2);
    let frameId: number | undefined;
    let timeoutId = 0;
    let onSeeked!: () => void;
    const seeked = new Promise<void>((resolve) => { onSeeked = resolve; video.addEventListener("seeked", onSeeked, { once: true }); });
    const requestFrame = video.requestVideoFrameCallback;
    const hasFrameCallback = typeof requestFrame === "function";
    const painted = hasFrameCallback ? new Promise<void>((resolve) => {
      const frame = (_time: number, metadata: VideoFrameCallbackMetadata) => {
        if (Math.abs(metadata.mediaTime - target) < 0.12) resolve();
        else frameId = requestFrame.call(video, frame);
      };
      frameId = requestFrame.call(video, frame);
    }) : seeked.then(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const timeout = new Promise<never>((_, reject) => { timeoutId = window.setTimeout(() => reject(new Error("A decoded post-seek frame did not arrive.")), 20000); });
    try {
      video.currentTime = target;
      await Promise.race([Promise.all([seeked, painted]), timeout]);
      if (video.readyState < 2) throw new Error("The post-seek video frame is not decoded.");
      return { method: hasFrameCallback ? "requestVideoFrameCallback" : "seeked-readyState-two-animation-frames", targetTime: target, observedTime: video.currentTime, readyState: video.readyState };
    } finally {
      window.clearTimeout(timeoutId); video.removeEventListener("seeked", onSeeked);
      if (frameId !== undefined) video.cancelVideoFrameCallback?.(frameId);
    }
  });
}
