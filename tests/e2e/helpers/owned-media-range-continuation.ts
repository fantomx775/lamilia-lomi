import { z } from "zod";

const number = z.number().finite();
const identity = z.object({
  status: z.string().optional(), documentId: z.string().nullable().optional(),
  elementId: z.string().nullable().optional(), generation: number.nullable().optional(),
  sourceIndex: number.nullable().optional(), sampledAtEpochMs: number.nullable().optional(),
  timeOrigin: number.nullable().optional(),
});
const originKind = z.enum(["test-origin", "loopback", "other-origin", "invalid-origin"]);
const request = z.object({
  requestId: number, method: z.string(), path: z.string(), originKind, resource: z.string(), urlSha256: z.string().regex(/^[a-f0-9]{64}$/),
  startedAtEpochMs: number, responseStatus: number.nullable(), contentRange: z.string().nullable(),
  range: z.string().nullable(), allHeadersRange: z.string().nullable().optional(), identitySample: identity.optional(),
  redirectTargetPath: z.string().optional(), redirectTargetOrigin: z.string().optional(),
});
const failedRequest = request.extend({
  error: z.string().nullable(), failedAtEpochMs: number, redirectChain: z.array(request),
  responseBodyBytes: number.optional(),
  expectedPause: z.boolean(), expectedFault: z.boolean(),
});
const completedRequest = request.extend({ terminal: z.string(), finishedAtEpochMs: number, responseBodyBytes: number.optional() });
const timelineEvent = z.object({
  documentId: z.string(), elementId: z.string(), generation: number, timeOrigin: number,
  sourcePath: z.string(), event: z.string(), atEpochMs: number, trusted: z.boolean(), connected: z.boolean(),
  paused: z.boolean(), readyState: number, mediaErrorPresent: z.boolean(), mediaTime: number, currentTime: number,
});
const cdpEvent = z.object({
  event: z.string(), requestId: z.string(), urlSha256: z.string().regex(/^[a-f0-9]{64}$/), sourceIndex: number,
  timestamp: number, wallTime: number.optional(), receivedDataBytes: number, status: number.optional(),
  contentRange: z.string().nullable().optional(), range: z.string().nullable().optional(),
  fromDiskCache: z.boolean().optional(), fromServiceWorker: z.boolean().optional(),
  fromPrefetchCache: z.boolean().optional(), fromEarlyHints: z.boolean().optional(),
  canceled: z.boolean().optional(), category: z.string().optional(), loaderId: z.string().optional(), frameId: z.string().nullable().optional(),
});
const snapshot = z.object({
  cdpStatus: z.string(), ownedMedia: z.object({ apiPath: z.string(), storagePath: z.string(), origin: z.string().url() }),
  ownedVideoContent: z.object({ byteLength: z.number().int().positive(), fixtureSha256: z.string().regex(/^[a-f0-9]{64}$/),
    storageReadbackSha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  failed: z.array(failedRequest), successfulMedia: z.array(completedRequest), nativeTimeline: z.array(timelineEvent),
  lifecycleActions: z.array(z.object({ action: z.string(), atEpochMs: number })), cdpMedia: z.array(cdpEvent),
});

/**
 * Accept only an owned media range abort that is followed by an exact,
 * complete range tail and a decoded frame from the same element generation.
 * The initial response must be either demonstrably partial or demonstrably
 * complete in both browser observers before the tail reissue. This does not
 * accept path-only aborts or generic net::ERR_ABORTED results.
 */
export function classifyOwnedMediaRangeContinuation(input: unknown, requestId: number, fixtureBytes: number) {
  const parsed = snapshot.safeParse(input);
  if (!parsed.success || !Number.isSafeInteger(fixtureBytes) || fixtureBytes <= 0) {
    return { disposition: "UNRESOLVED" as const, reason: "invalid-observation-shape" };
  }
  const data = parsed.data;
  const unresolved = (reason: string) => ({ disposition: "UNRESOLVED" as const, reason });
  if (data.ownedVideoContent.byteLength !== fixtureBytes ||
      data.ownedVideoContent.fixtureSha256 !== data.ownedVideoContent.storageReadbackSha256) {
    return unresolved("fixture-storage-readback-mismatch");
  }
  let parsedExpectedOrigin: URL;
  try { parsedExpectedOrigin = new URL(data.ownedMedia.origin); } catch { return unresolved("invalid-owned-origin"); }
  if (parsedExpectedOrigin.origin !== data.ownedMedia.origin || parsedExpectedOrigin.protocol !== "https:" ||
      !["localhost", "127.0.0.1"].includes(parsedExpectedOrigin.hostname) || parsedExpectedOrigin.port !== "3443") {
    return unresolved("invalid-owned-origin");
  }
  const failures = data.failed.filter((entry) => entry.requestId === requestId);
  if (failures.length !== 1) return unresolved("nonunique-failure");
  const failure = failures[0];
  const { apiPath, storagePath } = data.ownedMedia;
  const [parent] = failure.redirectChain;
  const fullRange = `bytes 0-${fixtureBytes - 1}/${fixtureBytes}`;
  if (failure.method !== "GET" || failure.originKind !== "test-origin" || failure.resource !== "media" || failure.path !== storagePath ||
      failure.error !== "net::ERR_ABORTED" || failure.responseStatus !== 206 || failure.contentRange !== fullRange ||
      failure.expectedPause || failure.expectedFault || failure.redirectChain.length !== 1 ||
      parent.method !== "GET" || parent.originKind !== "test-origin" || parent.resource !== "media" || parent.path !== apiPath || parent.responseStatus !== 307 ||
      parent.allHeadersRange !== "bytes=0-" || parent.redirectTargetOrigin !== parsedExpectedOrigin.origin ||
      parent.redirectTargetPath !== storagePath || parent.urlSha256.length !== 64) {
    return unresolved("not-an-owned-full-range-redirect-abort");
  }

  const owner = parent.identitySample;
  if (owner?.status !== "sampled" || !/^doc-[a-f0-9-]{36}$/.test(owner.documentId ?? "") ||
      !/^element-\d+$/.test(owner.elementId ?? "") || !Number.isSafeInteger(owner.generation) ||
      (owner.generation ?? -1) < 0 || owner.sourceIndex !== 0 || typeof owner.timeOrigin !== "number") {
    return unresolved("missing-owned-element-generation");
  }
  const sameOwner = (sample: z.infer<typeof identity> | undefined) => sample?.status === "sampled" &&
    sample.documentId === owner.documentId && sample.elementId === owner.elementId &&
    sample.generation === owner.generation && sample.sourceIndex === 0 && sample.timeOrigin === owner.timeOrigin;
  if (failure.identitySample && !sameOwner(failure.identitySample)) return unresolved("failed-request-owner-mismatch");

  let abortEpochMs = failure.failedAtEpochMs;
  let completeBodyBeforeAbort = false;
  if (data.cdpStatus === "OBSERVING") {
    const closeInTime = (event: z.infer<typeof cdpEvent>, epochMs: number) => event.wallTime !== undefined &&
      Math.abs(event.wallTime * 1000 - epochMs) <= 20;
    const requests = data.cdpMedia.filter((event) => event.event === "cdp-request" &&
      event.sourceIndex === 1 && event.urlSha256 === failure.urlSha256 && closeInTime(event, failure.startedAtEpochMs));
    if (requests.length !== 1 || requests[0].wallTime === undefined) return unresolved("ambiguous-cdp-aborted-request");
    const terminals = data.cdpMedia.filter((event) => event.event === "cdp-failed" &&
      event.sourceIndex === 1 && event.requestId === requests[0].requestId && event.urlSha256 === failure.urlSha256);
    if (terminals.length !== 1 || !terminals[0].canceled || terminals[0].category !== "net::ERR_ABORTED") {
      return unresolved("cdp-does-not-prove-owned-range-abort");
    }
    const bytesReceived = terminals[0].receivedDataBytes;
    const partialBody = bytesReceived > 0 && bytesReceived < fixtureBytes &&
      (typeof failure.responseBodyBytes !== "number" || failure.responseBodyBytes > 0);
    completeBodyBeforeAbort = bytesReceived === fixtureBytes && failure.responseBodyBytes === fixtureBytes;
    if (!partialBody && !completeBodyBeforeAbort) return unresolved("cdp-does-not-prove-owned-range-abort");
    abortEpochMs = requests[0].wallTime * 1000 + (terminals[0].timestamp - requests[0].timestamp) * 1000;
  }

  const events = data.nativeTimeline.filter((event) => event.documentId === owner.documentId &&
    event.elementId === owner.elementId && event.generation === owner.generation &&
    event.timeOrigin === owner.timeOrigin && event.sourcePath === apiPath);
  const loadStart = events.find((event) => event.event === "loadstart" && event.atEpochMs <= parent.startedAtEpochMs);
  if (!loadStart) return unresolved("missing-owned-loadstart");
  const intent = events.find((event) => event.event === "play-intent" && event.trusted && event.connected &&
    event.atEpochMs > abortEpochMs);
  if (!intent) return unresolved("missing-post-abort-play-intent");
  const playing = events.find((event) => event.event === "playing" && event.trusted && event.connected &&
    !event.paused && !event.mediaErrorPresent && event.atEpochMs >= intent.atEpochMs);
  if (!playing) return unresolved("missing-post-abort-playing");
  const frame = events.find((event) => event.event === "frame" && event.connected && !event.paused &&
    !event.mediaErrorPresent && event.readyState >= 2 && event.currentTime > 0 && event.mediaTime > 0 &&
    event.atEpochMs > playing.atEpochMs);
  if (!frame) return unresolved("missing-post-abort-decoded-frame");

  const tails = data.successfulMedia.filter((entry) => {
    if (entry.method !== "GET" || entry.originKind !== "test-origin" || entry.resource !== "media" || entry.path !== storagePath ||
        entry.urlSha256 !== failure.urlSha256 || entry.responseStatus !== 206 || entry.terminal !== "finished" ||
        entry.startedAtEpochMs <= failure.failedAtEpochMs || entry.finishedAtEpochMs >= frame.atEpochMs ||
        (entry.identitySample ? !sameOwner(entry.identitySample) : data.cdpStatus !== "OBSERVING") ||
        typeof entry.responseBodyBytes !== "number") return false;
    const header = entry.allHeadersRange ?? entry.range ?? "";
    const match = /^bytes=(\d+)-$/.exec(header);
    if (!match) return false;
    const offset = Number(match[1]);
    return Number.isSafeInteger(offset) && offset > 0 && offset < fixtureBytes &&
      entry.contentRange === `bytes ${offset}-${fixtureBytes - 1}/${fixtureBytes}` &&
      entry.responseBodyBytes === fixtureBytes - offset;
  });
  if (tails.length !== 1) return unresolved("missing-unique-complete-range-tail");
  const tail = tails[0];
  let partialReceivedBytes = failure.responseBodyBytes;
  if (tail.finishedAtEpochMs >= frame.atEpochMs || intent.atEpochMs <= failure.failedAtEpochMs ||
      events.some((event) => event.atEpochMs >= parent.startedAtEpochMs && event.atEpochMs <= frame.atEpochMs &&
        ["src-change", "load-call", "video-detached", "beforeunload", "pagehide", "emptied", "abort", "error"].includes(event.event)) ||
      data.lifecycleActions.some((event) => event.atEpochMs >= parent.startedAtEpochMs && event.atEpochMs <= frame.atEpochMs &&
        ["goto-requested", "drain-start"].includes(event.action))) {
    return unresolved("source-or-document-changed-before-recovery");
  }

  if (data.cdpStatus === "OBSERVING") {
    const closeInTime = (event: z.infer<typeof cdpEvent>, epochMs: number) => event.wallTime !== undefined &&
      Math.abs(event.wallTime * 1000 - epochMs) <= 20;
    const canceledRequests = data.cdpMedia.filter((event) => event.event === "cdp-request" &&
      event.sourceIndex === 1 && event.urlSha256 === failure.urlSha256 && closeInTime(event, failure.startedAtEpochMs));
    if (canceledRequests.length !== 1) return unresolved("ambiguous-cdp-aborted-request");
    const canceledRequest = canceledRequests[0];
    const canceledResponse = data.cdpMedia.filter((event) => event.event === "cdp-response" &&
      event.sourceIndex === 1 && event.requestId === canceledRequest.requestId && event.urlSha256 === failure.urlSha256);
    const canceledTerminal = data.cdpMedia.filter((event) => event.event === "cdp-failed" &&
      event.sourceIndex === 1 && event.requestId === canceledRequest.requestId && event.urlSha256 === failure.urlSha256);
    if (canceledResponse.length !== 1 || canceledResponse[0].status !== 206 ||
        canceledResponse[0].contentRange !== fullRange || canceledTerminal.length !== 1 ||
        !canceledTerminal[0].canceled || canceledTerminal[0].category !== "net::ERR_ABORTED" ||
        (!completeBodyBeforeAbort && (canceledTerminal[0].receivedDataBytes <= 0 || canceledTerminal[0].receivedDataBytes >= fixtureBytes)) ||
        (completeBodyBeforeAbort && (canceledTerminal[0].receivedDataBytes !== fixtureBytes || failure.responseBodyBytes !== fixtureBytes)) ||
        canceledResponse[0].fromDiskCache !== false || canceledResponse[0].fromServiceWorker !== false ||
        canceledResponse[0].fromPrefetchCache !== false) {
      return unresolved("cdp-does-not-prove-owned-range-abort");
    }
    partialReceivedBytes = typeof partialReceivedBytes === "number"
      ? Math.min(partialReceivedBytes, canceledTerminal[0].receivedDataBytes)
      : canceledTerminal[0].receivedDataBytes;
    const tailHeaders = tail.allHeadersRange ?? tail.range ?? "";
    const tailRequests = data.cdpMedia.filter((event) => event.event === "cdp-request" &&
      event.sourceIndex === 1 && event.urlSha256 === tail.urlSha256 && event.range === tailHeaders && closeInTime(event, tail.startedAtEpochMs));
    if (tailRequests.length !== 1) return unresolved("ambiguous-cdp-range-tail");
    const tailRequest = tailRequests[0];
    const tailResponse = data.cdpMedia.filter((event) => event.event === "cdp-response" &&
      event.sourceIndex === 1 && event.requestId === tailRequest.requestId && event.urlSha256 === tail.urlSha256);
    const tailFinished = data.cdpMedia.filter((event) => event.event === "cdp-finished" &&
      event.sourceIndex === 1 && event.requestId === tailRequest.requestId && event.urlSha256 === tail.urlSha256);
    if (tailRequest.loaderId !== canceledRequest.loaderId || tailRequest.frameId !== canceledRequest.frameId ||
        tailResponse.length !== 1 || tailResponse[0].status !== 206 || tailResponse[0].contentRange !== tail.contentRange ||
        tailResponse[0].fromDiskCache !== false || tailResponse[0].fromServiceWorker !== false ||
        tailResponse[0].fromPrefetchCache !== false ||
        tailFinished.length !== 1 || tailFinished[0].receivedDataBytes !== tail.responseBodyBytes) {
      return unresolved("cdp-range-tail-not-same-document-or-complete");
    }
  } else {
    return unresolved(data.cdpStatus === "NOT_APPLICABLE" ? "cdp-cache-provenance-unavailable" : "invalid-cdp-observer-status");
  }

  const range = /^bytes=(\d+)-$/.exec(tail.allHeadersRange ?? tail.range ?? "")!;
  const partialOffset = Number(range[1]);
  if (typeof partialReceivedBytes !== "number" || !Number.isSafeInteger(partialReceivedBytes) ||
      partialReceivedBytes <= 0 || partialReceivedBytes > fixtureBytes ||
      (completeBodyBeforeAbort ? partialReceivedBytes !== fixtureBytes : partialReceivedBytes >= fixtureBytes) ||
      partialOffset > partialReceivedBytes) {
    return unresolved("resumed-offset-exceeds-bytes-received-before-abort");
  }
  return {
    disposition: completeBodyBeforeAbort
      ? "EXPECTED_OWNED_NATIVE_FULL_RESPONSE_RANGE_REISSUE" as const
      : "EXPECTED_OWNED_NATIVE_RANGE_CONTINUATION" as const,
    requestId: failure.requestId,
    parentRequestId: parent.requestId,
    resumedRequestId: tail.requestId,
    documentId: owner.documentId,
    elementId: owner.elementId,
    generation: owner.generation,
    canceledContentRange: failure.contentRange,
    ...(completeBodyBeforeAbort ? { receivedBytesBeforeAbort: partialReceivedBytes } : { partialReceivedBytes }),
    resumedOffset: partialOffset,
    resumedBytes: tail.responseBodyBytes,
    decodedFrameAtEpochMs: frame.atEpochMs,
    requiresIndependentReview: true,
  };
}
