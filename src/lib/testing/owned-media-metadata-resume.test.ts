import { describe, expect, it } from "vitest";
import { classifyOwnedMetadataResume } from "../../../tests/e2e/helpers/owned-media-metadata-resume";

// Controlled minimal proof, not a copy of private runtime artifacts or signed URLs.
function proof() {
  const api = "/api/media/controlled", storage = "/storage/v1/object/sign/public-videos/controlled.mp4";
  const a = "a".repeat(64), b = "b".repeat(64);
  const identity = { status: "sampled", documentId: "doc-11111111-1111-4111-8111-111111111111", elementId: "element-1", generation: 0, sourceIndex: 0, sampledAtEpochMs: 1150, timeOrigin: 900 };
  const request = (id: number, start: number, path = storage, hash = b) => ({ requestId: id, startedAtEpochMs: start, method: "GET", path, resource: "media", navigation: false, rsc: false, prefetch: false, urlSha256: hash, responseStatus: 206, contentRange: "bytes 0-999/1000", allHeadersRange: "bytes=0-", identitySample: { ...identity } });
  const parent = { ...request(1, 1050, api, a), responseStatus: 307, contentRange: null as string | null };
  const failed = { ...request(2, 1100), error: "net::ERR_ABORTED", failedAtEpochMs: 1200, expectedPause: false, expectedFault: false, pauseGateRequest: false, pauseRequestedAtFailure: false, redirectChain: [parent] };
  const tail = { ...request(3, 1280), allHeadersRange: "bytes=350-", contentRange: "bytes 350-999/1000", identitySample: { ...identity, sampledAtEpochMs: 1290 }, terminal: "finished", finishedAtEpochMs: 1320, responseBodyBytes: 650 };
  const event = (event: string, at: number) => ({ ...identity, event, atEpochMs: at, sourcePath: api, trusted: true, connected: true, paused: true, preload: "metadata", networkState: 1, readyState: 4, mediaErrorPresent: false, errorCode: 0, mediaTime: -1, currentTime: 0 });
  const cdp = (event: string, requestId = "cdp-1", hash = b) => ({ event, requestId, urlSha256: hash, sourceIndex: 1, receivedDataBytes: 0, timestamp: 11.1, wallTime: 1.1, loaderId: "loader-1", frameId: "frame-1", range: "bytes=0-", redirectStatus: 307, canceled: false, category: "", status: 206, contentRange: "bytes 0-999/1000", fromServiceWorker: false, fromDiskCache: false, fromPrefetchCache: false, fromEarlyHints: false });
  return {
    cdpStatus: "OBSERVING", observerErrors: [], consoleErrors: [], pageErrors: [], ownedMedia: { apiPath: api, storagePath: storage },
    failed: [failed], mediaRequests: [parent, request(2, 1100), tail], successfulMedia: [tail], lifecycleActions: [] as Array<{ action: string; atEpochMs: number }>,
    nativeTimeline: [event("loadstart", 1000), event("suspend", 1130), event("loadedmetadata", 1150), event("loadeddata", 1160), event("canplay", 1170), event("play-intent", 1250), { ...event("play", 1260), paused: false }, { ...event("playing", 1270), paused: false }, { ...event("frame", 1400), paused: false, trusted: false, mediaTime: 0.3, currentTime: 0.25 }],
    cdpMedia: [
      { ...cdp("cdp-request", "cdp-1", a), sourceIndex: 0, timestamp: 11.05, wallTime: 1.05 },
      cdp("cdp-request"), cdp("cdp-response"), { ...cdp("cdp-failed"), timestamp: 11.2, canceled: true, category: "net::ERR_ABORTED", receivedDataBytes: 400 },
      { ...cdp("cdp-request", "cdp-2"), range: "bytes=350-", timestamp: 11.28, wallTime: 1.28 },
      { ...cdp("cdp-response", "cdp-2"), contentRange: "bytes 350-999/1000" },
      { ...cdp("cdp-finished", "cdp-2"), timestamp: 11.32, receivedDataBytes: 650 },
    ],
  };
}

type Proof = ReturnType<typeof proof>;
const negative: Array<[string, (d: Proof) => void]> = [
  ...[401, 403, 500].map((status): [string, (d: Proof) => void] => [`HTTP ${status}`, d => { d.failed[0].responseStatus = status; d.mediaRequests[1].responseStatus = status; }]),
  ["ERR_FAILED", d => { d.failed[0].error = "net::ERR_FAILED"; }],
  ["wrong source", d => { d.failed[0].path = "/wrong"; d.mediaRequests[1].path = "/wrong"; }],
  ["wrong hash", d => { d.failed[0].urlSha256 = "c".repeat(64); }],
  ["wrong redirect parent", d => { d.failed[0].redirectChain[0].path = "/wrong"; }],
  ["remount", d => { d.nativeTimeline.at(-1)!.elementId = "element-2"; }],
  ["generation reset", d => { d.nativeTimeline.at(-1)!.generation = 1; }],
  ["missing trusted intent", d => { d.nativeTimeline.find(e => e.event === "play-intent")!.trusted = false; }],
  ...["play-intent", "play", "playing"].map((event): [string, (d: Proof) => void] => [`earlier ${event} retains valid later intent`, d => { d.nativeTimeline.push({ ...d.nativeTimeline[0], event, atEpochMs: 1040 }); }]),
  ["load() reset", d => { d.nativeTimeline.push({ ...d.nativeTimeline[0], event: "load-call", atEpochMs: 1300 }); }],
  ["detach", d => { d.nativeTimeline.push({ ...d.nativeTimeline[0], event: "video-detached", atEpochMs: 1300 }); }],
  ["error", d => { d.nativeTimeline.push({ ...d.nativeTimeline[0], event: "error", atEpochMs: 1300 }); }],
  ["navigation reset", d => { d.lifecycleActions.push({ action: "goto-requested", atEpochMs: 1300 }); }],
  ["not browser-canceled", d => { d.cdpMedia.find(e => e.event === "cdp-failed")!.canceled = false; }],
  ["header-only bytes", d => { d.cdpMedia.find(e => e.event === "cdp-failed")!.receivedDataBytes = 0; }],
  ["missing completed tail", d => { d.successfulMedia = []; }],
  ["incomplete tail", d => { d.successfulMedia[0].responseBodyBytes--; }],
  ["no CDP finished tail", d => { d.cdpMedia = d.cdpMedia.filter(e => e.event !== "cdp-finished"); }],
  ["different loader", d => { d.cdpMedia.find(e => e.event === "cdp-request" && e.requestId === "cdp-2")!.loaderId = "other"; }],
  ["prefetch cache source", d => { d.cdpMedia.find(e => e.event === "cdp-response" && e.requestId === "cdp-1")!.fromPrefetchCache = true; }],
  ["unknown prefetch-cache source", d => { Reflect.deleteProperty(d.cdpMedia.find(e => e.event === "cdp-response" && e.requestId === "cdp-1")!, "fromPrefetchCache"); }],
  ["no decoded advance", d => { d.nativeTimeline.at(-1)!.currentTime = 0; }],
  ["WebKit without CDP", d => { d.cdpStatus = "NOT_APPLICABLE"; d.cdpMedia = []; }],
];

describe("owned metadata suspension with verified resume", () => {
  it("requires actual partial bytes and exact same-generation completed tail before decoded advancement", () => {
    expect(classifyOwnedMetadataResume(proof(), 2, 1000)).toMatchObject({ disposition: "EXPECTED_METADATA_SUSPEND_VERIFIED_RESUME", canceledInitialResponseCompleted: false, readinessContract: "before-trusted-play-intent" });
  });
  it.each(negative)("rejects %s", (_name, mutate) => {
    const d = proof(); mutate(d);
    expect(classifyOwnedMetadataResume(d, 2, 1000).disposition).toBe("UNRESOLVED");
  });
  it("rejects unknown and incomplete observations", () => {
    expect(classifyOwnedMetadataResume({}, 2, 1000).disposition).toBe("UNRESOLVED");
    expect(classifyOwnedMetadataResume(null, 2, 1000).disposition).toBe("UNRESOLVED");
  });
});
