import { z } from "zod";

// Reviewed narrow test-only lifecycle proof. No path-only or engine-independent exemption.
const n = z.number().finite();
const identitySchema = z.object({
  status: z.string().optional(), documentId: z.string().nullable().optional(), elementId: z.string().nullable().optional(),
  generation: n.nullable().optional(), sourceIndex: n.nullable().optional(), sampledAtEpochMs: n.nullable().optional(), timeOrigin: n.nullable().optional(),
});
type Identity = z.infer<typeof identitySchema>;
const requestSchema = z.object({
  requestId: n, method: z.string(), path: z.string(), resource: z.string(), navigation: z.boolean(), rsc: z.boolean(), prefetch: z.boolean(),
  urlSha256: z.string().regex(/^[a-f0-9]{64}$/), startedAtEpochMs: n, responseStatus: n.nullable(), contentRange: z.string().nullable(),
  allHeadersRange: z.string().nullable().optional(), identitySample: identitySchema.optional(),
});
type MediaRequest = z.infer<typeof requestSchema>;
const snapshotSchema = z.object({
  cdpStatus: z.string(), observerErrors: z.array(z.unknown()), consoleErrors: z.array(z.unknown()), pageErrors: z.array(z.unknown()),
  ownedMedia: z.object({apiPath: z.string(), storagePath: z.string()}),
  failed: z.array(requestSchema.extend({error: z.string().nullable(), expectedPause: z.boolean(), expectedFault: z.boolean(), pauseGateRequest: z.boolean(), pauseRequestedAtFailure: z.boolean(), failedAtEpochMs: n, redirectChain: z.array(requestSchema)})),
  mediaRequests: z.array(requestSchema),
  successfulMedia: z.array(requestSchema.extend({terminal: z.string(), finishedAtEpochMs: n, responseBodyBytes: n.optional()})),
  nativeTimeline: z.array(z.object({
    documentId: z.string(), elementId: z.string(), generation: n, timeOrigin: n, sourcePath: z.string(), event: z.string(), atEpochMs: n,
    trusted: z.boolean(), connected: z.boolean(), paused: z.boolean(), preload: z.string(), networkState: n, readyState: n,
    mediaErrorPresent: z.boolean(), errorCode: n, mediaTime: n, currentTime: n,
  })),
  lifecycleActions: z.array(z.object({action: z.string(), atEpochMs: n})),
  cdpMedia: z.array(z.object({
    event: z.string(), requestId: z.string(), urlSha256: z.string().regex(/^[a-f0-9]{64}$/), sourceIndex: n,
    receivedDataBytes: n, timestamp: n, wallTime: n.optional(), loaderId: z.string().optional(), frameId: z.string().nullable().optional(),
    range: z.string().nullable().optional(), redirectStatus: n.nullable().optional(), canceled: z.boolean().optional(), category: z.string().optional(),
    status: n.optional(), contentRange: z.string().nullable().optional(), fromServiceWorker: z.boolean().optional(), fromDiskCache: z.boolean().optional(),
    fromPrefetchCache: z.boolean().optional(), fromEarlyHints: z.boolean().optional(),
  })),
});

export function classifyOwnedMetadataResume(input: unknown, requestId: number, fixtureBytes: number) {
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success) return { disposition: "UNRESOLVED" as const, reason: "invalid-observation-shape" };
  const d = parsed.data;
  const no = (reason: string) => ({ disposition: 'UNRESOLVED' as const, reason });
  if (!Number.isSafeInteger(fixtureBytes) || fixtureBytes <= 0 || d.cdpStatus !== 'OBSERVING' || d.observerErrors.length || d.consoleErrors.length || d.pageErrors.length) return no('missing-or-invalid-observations');
  const failures = d.failed.filter(r => r.requestId === requestId);
  if (failures.length !== 1) return no('nonunique-failure');
  const r = failures[0], api = d.ownedMedia.apiPath, storage = d.ownedMedia.storagePath;
  const inventory = d.mediaRequests.filter(x => x.requestId === requestId);
  if (inventory.length !== 1) return no('missing-current-inventory');
  const current = inventory[0], identity = current.identitySample;
  if (current.path !== r.path || current.urlSha256 !== r.urlSha256 || current.responseStatus !== r.responseStatus) return no('inventory-mismatch');
  const same = (x: Identity | undefined) => x?.documentId === identity?.documentId && x?.elementId === identity?.elementId && x?.generation === identity?.generation && x?.timeOrigin === identity?.timeOrigin;
  const validSample = (x: Identity | undefined, start: number, end: number) => x?.status === 'sampled' && same(x) && x.sourceIndex === 0 && typeof x.sampledAtEpochMs === 'number' && x.sampledAtEpochMs >= start && x.sampledAtEpochMs < end;
  if (!identity || !/^doc-[a-f0-9-]{36}$/.test(identity.documentId ?? "") || !/^element-\d+$/.test(identity.elementId ?? "") || !Number.isSafeInteger(identity.generation) || (identity.generation ?? -1) < 0) return no('invalid-identity');
  const isGetMedia = (x: MediaRequest) => x.method === 'GET' && x.resource === 'media' && !x.navigation && !x.rsc && !x.prefetch;
  if (!isGetMedia(r) || r.path !== storage || r.error !== 'net::ERR_ABORTED' || r.responseStatus !== 206 || r.expectedPause || r.expectedFault || r.pauseGateRequest || r.pauseRequestedAtFailure || current.allHeadersRange !== 'bytes=0-' || r.contentRange !== `bytes 0-${fixtureBytes-1}/${fixtureBytes}`) return no('not-owned-partial-range-abort');
  if (r.redirectChain.length !== 1) return no('wrong-redirect-chain');
  const parent = r.redirectChain[0];
  if (!isGetMedia(parent) || parent.path !== api || parent.responseStatus !== 307 || parent.allHeadersRange !== 'bytes=0-' || !validSample(parent.identitySample,parent.startedAtEpochMs,r.failedAtEpochMs) || !validSample(identity,r.startedAtEpochMs,r.failedAtEpochMs)) return no('unbound-parent-or-generation');
  const uniqueCdpRequest = (hash: string,start: number) => d.cdpMedia.filter(e => e.event === 'cdp-request' && e.urlSha256 === hash && e.wallTime !== undefined && Math.abs(e.wallTime*1000-start) <= 20);
  const childCdp = uniqueCdpRequest(r.urlSha256,r.startedAtEpochMs), parentCdp = uniqueCdpRequest(parent.urlSha256,parent.startedAtEpochMs);
  if (childCdp.length !== 1 || parentCdp.length !== 1) return no('ambiguous-cdp-request');
  const c = childCdp[0], p = parentCdp[0];
  if (c.wallTime === undefined || !c.loaderId || !c.frameId) return no("missing-cdp-clock-or-loader");
  if (c.sourceIndex !== 1 || p.sourceIndex !== 0 || c.requestId !== p.requestId || c.redirectStatus !== 307 || p.range !== 'bytes=0-' || c.loaderId !== p.loaderId || c.frameId !== p.frameId) return no('cdp-chain-mismatch');
  const canceled = d.cdpMedia.filter(e => e.requestId === c.requestId && e.urlSha256 === r.urlSha256 && e.event === 'cdp-failed');
  const response = d.cdpMedia.filter(e => e.requestId === c.requestId && e.urlSha256 === r.urlSha256 && e.event === 'cdp-response');
  if (canceled.length !== 1 || response.length !== 1) return no('missing-cdp-terminal-or-response');
  const cancel = canceled[0];
  if (!cancel.canceled || cancel.category !== 'net::ERR_ABORTED' || response[0].status !== 206 || response[0].contentRange !== r.contentRange || response[0].fromServiceWorker !== false || response[0].fromDiskCache !== false || response[0].fromPrefetchCache !== false || !(cancel.receivedDataBytes > 0 && cancel.receivedDataBytes < fixtureBytes)) return no('not-observed-partial-browser-cancel');
  // CDP actual cancellation precedes the host requestfailed callback. Do not conflate the two clocks.
  const cancelEpoch = c.wallTime*1000+(cancel.timestamp-c.timestamp)*1000;
  const events = d.nativeTimeline.filter(e => same(e) && e.sourcePath === api);
  const first = events.find(e => e.event === 'loadstart' && e.atEpochMs <= parent.startedAtEpochMs);
  if (!first) return no('missing-generation-loadstart');
  const intent = events.filter(e => e.event === 'play-intent' && e.trusted && e.atEpochMs >= first.atEpochMs).sort((a,b)=>a.atEpochMs-b.atEpochMs)[0];
  if (!intent || intent.atEpochMs <= r.failedAtEpochMs || intent.atEpochMs <= cancelEpoch) return no('not-first-preplay-intent');
  if (events.some(e => e.atEpochMs >= first.atEpochMs && e.atEpochMs <= Math.max(r.failedAtEpochMs,cancelEpoch) && ['play','playing','play-intent'].includes(e.event))) return no('earlier-playback-in-generation');
  const suspended = events.find(e => e.event === 'suspend' && e.trusted && e.connected && e.paused && e.preload === 'metadata' && e.networkState === 1 && !e.mediaErrorPresent && e.errorCode === 0 && e.atEpochMs >= r.startedAtEpochMs && e.atEpochMs < intent.atEpochMs);
  if (!suspended) return no('no-owned-metadata-suspension');
  for (const name of ['loadedmetadata','loadeddata','canplay']) if (!events.some(e => e.event === name && e.trusted && e.paused && e.connected && e.readyState === 4 && !e.mediaErrorPresent && e.errorCode === 0 && e.atEpochMs >= suspended.atEpochMs && e.atEpochMs < intent.atEpochMs)) return no('readiness-not-before-intent');
  const play = events.find(e => e.event === 'play' && e.trusted && !e.paused && e.atEpochMs >= intent.atEpochMs);
  if (!play) return no('no-post-abort-same-generation-decoded-advance');
  const playing = events.find(e => e.event === 'playing' && e.trusted && !e.paused && e.connected && !e.mediaErrorPresent && e.atEpochMs >= play.atEpochMs);
  if (!playing) return no('no-post-abort-same-generation-decoded-advance');
  const frame = events.find(e => e.event === 'frame' && e.atEpochMs > playing.atEpochMs && e.atEpochMs > r.failedAtEpochMs && e.mediaTime > 0.2 && e.currentTime > 0 && !e.paused && e.connected && e.readyState >= 2 && !e.mediaErrorPresent);
  if (!play || !playing || !frame) return no('no-post-abort-same-generation-decoded-advance');
  const forbidden = ['src-change','load-call','video-detached','beforeunload','pagehide','emptied','abort','error','pause'];
  if (d.nativeTimeline.some(e => e.documentId === identity.documentId && e.atEpochMs >= parent.startedAtEpochMs && e.atEpochMs <= frame.atEpochMs && (!same(e) || e.sourcePath !== api || forbidden.includes(e.event) || e.mediaErrorPresent))) return no('reset-error-or-other-source-in-window');
  if (d.lifecycleActions.some(e => e.atEpochMs >= parent.startedAtEpochMs && e.atEpochMs <= frame.atEpochMs && ['goto-requested','drain-start'].includes(e.action))) return no('test-reset-in-window');
  // Prove actual whole-tail delivery after resume, not full delivery of the canceled initial response.
  const tails = d.successfulMedia.filter(x => isGetMedia(x) && x.path === storage && x.urlSha256 === r.urlSha256 && x.responseStatus === 206 && x.terminal === 'finished' && x.startedAtEpochMs > r.failedAtEpochMs && x.finishedAtEpochMs < frame.atEpochMs && validSample(x.identitySample,x.startedAtEpochMs,x.finishedAtEpochMs));
  const recovered = tails.find(tail => {
    const match = /^bytes=(\d+)-$/.exec(tail.allHeadersRange ?? ''); if (!match) return false;
    const offset = Number(match[1]);
    if (!(offset > 0 && offset <= cancel.receivedDataBytes) || tail.contentRange !== `bytes ${offset}-${fixtureBytes-1}/${fixtureBytes}` || tail.responseBodyBytes !== fixtureBytes-offset) return false;
    const resume = uniqueCdpRequest(tail.urlSha256,tail.startedAtEpochMs); if(resume.length !== 1) return false;
    const q=resume[0];
    const responses=d.cdpMedia.filter(e=>e.event==='cdp-response'&&e.requestId===q.requestId&&e.urlSha256===r.urlSha256);
    if(responses.length!==1||responses[0].status!==206||responses[0].contentRange!==tail.contentRange||responses[0].fromServiceWorker!==false||responses[0].fromDiskCache!==false||responses[0].fromPrefetchCache!==false)return false;
    return q.loaderId===c.loaderId && q.frameId===c.frameId && q.range===tail.allHeadersRange && d.cdpMedia.some(e=>e.event==='cdp-finished'&&e.requestId===q.requestId&&e.urlSha256===r.urlSha256&&e.receivedDataBytes===fixtureBytes-offset) && !d.cdpMedia.some(e=>e.event==='cdp-failed'&&e.requestId===q.requestId);
  });
  if (!recovered) return no('no-exact-successful-resume-tail');
  return { disposition:'EXPECTED_METADATA_SUSPEND_VERIFIED_RESUME' as const,requestId:r.requestId,parentRequestId:parent.requestId,resumedRequestId:recovered.requestId,
    documentId:identity.documentId,elementId:identity.elementId,generation:identity.generation,partialReceivedBytes:cancel.receivedDataBytes,
    resumedBytes:recovered.responseBodyBytes,canceledInitialResponseCompleted:false,readinessContract:'before-trusted-play-intent',requiresIndependentReview:true };
}
