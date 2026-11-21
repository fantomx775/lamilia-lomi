import { describe, expect, it } from "vitest";
import { classifyOwnedMediaRangeContinuation } from "../../../tests/e2e/helpers/owned-media-range-continuation";

function proof() {
  const api = "/api/media/controlled";
  const storage = "/storage/v1/object/sign/public-videos/controlled.mp4";
  const origin = "https://127.0.0.1:3443";
  const parentHash = "a".repeat(64);
  const mediaHash = "b".repeat(64);
  const identity = (sampledAtEpochMs: number) => ({
    status: "sampled", documentId: "doc-11111111-1111-4111-8111-111111111111", elementId: "element-1",
    generation: 0, sourceIndex: 0, sampledAtEpochMs, timeOrigin: 900,
  });
  const request = (requestId: number, startedAtEpochMs: number, path: string, urlSha256: string, range = "bytes=0-") => ({
    requestId, method: "GET", path, originKind: "test-origin", resource: "media", urlSha256,
    startedAtEpochMs, responseStatus: 206, contentRange: "bytes 0-999/1000", range, allHeadersRange: range,
    identitySample: identity(startedAtEpochMs + 5),
  });
  const parent = {
    ...request(1, 1050, api, parentHash), responseStatus: 307, contentRange: null,
    redirectTargetPath: storage, redirectTargetOrigin: origin,
  };
  const failure = {
    ...request(2, 1100, storage, mediaHash), requestId: 2, responseBodyBytes: 350,
    error: "net::ERR_ABORTED", failedAtEpochMs: 1200, expectedPause: false, expectedFault: false,
    redirectChain: [parent],
  };
  const tail = {
    ...request(3, 1280, storage, mediaHash, "bytes=350-"),
    contentRange: "bytes 350-999/1000", terminal: "finished", finishedAtEpochMs: 1320, responseBodyBytes: 650,
  };
  const event = (name: string, atEpochMs: number) => ({
    documentId: "doc-11111111-1111-4111-8111-111111111111", elementId: "element-1", generation: 0,
    timeOrigin: 900, sourcePath: api, event: name, atEpochMs, trusted: true, connected: true,
    paused: true, readyState: 4, mediaErrorPresent: false, mediaTime: -1, currentTime: 0,
  });
  const cdpEvent = (name: string, requestId: string, urlSha256: string, timestamp: number, wallTime?: number) => ({
    event: name, requestId, urlSha256, sourceIndex: 1, timestamp, ...(wallTime === undefined ? {} : { wallTime }), receivedDataBytes: 0,
    loaderId: "loader-1", frameId: "frame-1", range: "bytes=0-", status: 206, contentRange: "bytes 0-999/1000",
    fromDiskCache: false, fromServiceWorker: false, fromPrefetchCache: false,
  });
  return {
    cdpStatus: "OBSERVING",
    ownedMedia: { apiPath: api, storagePath: storage, origin },
    failed: [{ ...failure, redirectChain: [parent] }],
    successfulMedia: [tail],
    nativeTimeline: [
      event("loadstart", 1000), event("play-intent", 1250),
      { ...event("playing", 1270), paused: false },
      { ...event("frame", 1400), paused: false, readyState: 4, mediaTime: 0.3, currentTime: 0.25 },
    ],
    lifecycleActions: [],
    cdpMedia: [
      cdpEvent("cdp-request", "cdp-abort", mediaHash, 11.1, 1.1),
      cdpEvent("cdp-response", "cdp-abort", mediaHash, 11.11),
      { ...cdpEvent("cdp-failed", "cdp-abort", mediaHash, 11.2), canceled: true, category: "net::ERR_ABORTED", receivedDataBytes: 350 },
      { ...cdpEvent("cdp-request", "cdp-tail", mediaHash, 11.28, 1.28), range: "bytes=350-" },
      { ...cdpEvent("cdp-response", "cdp-tail", mediaHash, 11.29), contentRange: "bytes 350-999/1000" },
      { ...cdpEvent("cdp-finished", "cdp-tail", mediaHash, 11.32), receivedDataBytes: 650 },
    ],
  };
}

describe("owned media Range continuation", () => {
  it("requires a same-origin redirect, browser-confirmed partial abort, complete tail, and decoded frame", () => {
    expect(classifyOwnedMediaRangeContinuation(proof(), 2, 1000)).toMatchObject({
      disposition: "EXPECTED_OWNED_NATIVE_RANGE_CONTINUATION", partialReceivedBytes: 350, resumedOffset: 350, resumedBytes: 650,
    });
  });

  it.each([
    ["foreign source with identical path", (d: ReturnType<typeof proof>) => { d.failed[0].originKind = "other-origin"; }],
    ["foreign redirect origin with identical path", (d: ReturnType<typeof proof>) => { d.failed[0].redirectChain[0].redirectTargetOrigin = "https://attacker.example"; }],
    ["foreign resumed source with identical path", (d: ReturnType<typeof proof>) => { d.successfulMedia[0].originKind = "other-origin"; }],
    ["CDP event with no owned source index", (d: ReturnType<typeof proof>) => { d.cdpMedia.find((entry) => entry.event === "cdp-request")!.sourceIndex = -1; }],
    ["non-test loopback port", (d: ReturnType<typeof proof>) => { d.ownedMedia.origin = "https://127.0.0.1:4443"; }],
  ])("leaves %s unresolved", (_label, mutate) => {
    const d = proof();
    mutate(d);
    expect(classifyOwnedMediaRangeContinuation(d, 2, 1000).disposition).toBe("UNRESOLVED");
  });
});
