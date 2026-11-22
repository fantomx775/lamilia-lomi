import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";

export type OwnedMediaSource = { origin: string; path: string };

/** Match the full origin and path without retaining or exposing request URLs. */
export function ownedMediaSourceIndex(requestUrl: string, ownedSources: OwnedMediaSource[]) {
  try {
    const url = new URL(requestUrl);
    return ownedSources.findIndex((source) => url.origin === source.origin && url.pathname === source.path);
  } catch {
    return -1;
  }
}

/** Chromium-only diagnostics. Adds no cancellation exemption or synthetic response. */
export async function observeOwnedMediaCdp(page: Page, ownedSources: OwnedMediaSource[], receive: (value: Record<string, unknown>) => void) {
  const session = await page.context().newCDPSession(page);
  const owned = new Map<string, { urlSha256: string; sourceIndex: number; receivedDataBytes: number; receivedEncodedBytes: number }>();
  const numericRange = (value: unknown, content = false) => typeof value === "string" && (content ? /^bytes \d{1,16}-\d{1,16}\/\d{1,16}$/ : /^bytes=\d{1,16}-\d{0,16}$/).test(value) ? value : value === undefined ? null : "unknown-range";
  const header = (headers: Record<string, unknown>, name: string) => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  session.on("Network.requestWillBeSent", (event) => {
    const sourceIndex = ownedMediaSourceIndex(event.request.url, ownedSources);
    if (sourceIndex < 0 || event.type !== "Media") return;
    const value = { urlSha256: createHash("sha256").update(event.request.url).digest("hex"), sourceIndex, receivedDataBytes: 0, receivedEncodedBytes: 0 };
    owned.set(event.requestId, value);
    receive({ event: "cdp-request", requestId: event.requestId, ...value, timestamp: event.timestamp, wallTime: event.wallTime,
      loaderId: event.loaderId, frameId: event.frameId ?? null, range: numericRange(header(event.request.headers, "range")),
      redirectStatus: event.redirectResponse?.status ?? null });
  });
  session.on("Network.responseReceived", (event) => {
    const value = owned.get(event.requestId);
    if (value) receive({ event: "cdp-response", requestId: event.requestId, ...value, timestamp: event.timestamp, status: event.response.status,
      contentRange: numericRange(header(event.response.headers, "content-range"), true), fromDiskCache: event.response.fromDiskCache,
      fromServiceWorker: event.response.fromServiceWorker, fromPrefetchCache: event.response.fromPrefetchCache,
      fromEarlyHints: event.response.fromEarlyHints });
  });
  session.on("Network.dataReceived", (event) => {
    const value = owned.get(event.requestId);
    if (value) { value.receivedDataBytes += event.dataLength; value.receivedEncodedBytes += event.encodedDataLength; }
  });
  session.on("Network.loadingFinished", (event) => {
    const value = owned.get(event.requestId);
    if (value) receive({ event: "cdp-finished", requestId: event.requestId, ...value, timestamp: event.timestamp, encodedDataLength: event.encodedDataLength });
  });
  session.on("Network.loadingFailed", (event) => {
    const value = owned.get(event.requestId);
    if (value) receive({ event: "cdp-failed", requestId: event.requestId, ...value, timestamp: event.timestamp, canceled: !!event.canceled,
      category: event.errorText === "net::ERR_ABORTED" ? "net::ERR_ABORTED" : "other-network-error" });
  });
  await session.send("Network.enable");
  return () => session.detach();
}
