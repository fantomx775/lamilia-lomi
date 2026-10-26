import { randomUUID } from "node:crypto";
import type { Page, Request } from "@playwright/test";

type Assertion = { name: string; status: "PASS"; details: string };
type TrackedRequest = {
  id: string;
  pageId: string;
  sourceUrl: string;
  sameOrigin: boolean;
  startedAt: number;
  terminal: Promise<void>;
  resolveTerminal: () => void;
  isTerminal: boolean;
  url: string;
  path: string;
  method: string;
  resource: string;
  rsc?: string;
  prefetchHeader?: string;
  segmentPrefetch?: string;
  nextActionHeader: boolean;
  responseStatus: number | null;
  error?: string;
  request: Request;
  disposition?: string;
  outcomeId?: string;
  cancellationKind?: string;
  cancellationPhase?: "navigation" | "teardown";
  reason?: string;
  outcome?: Record<string, unknown>;
};
type ClickIntent = { id: string; pageId: string; sourceUrl: string; href: string; trusted: boolean; at: number };
type DestinationProof = { pageId: string; intent: ClickIntent; target: string; expectedUrl: string; observedUrl: string; assertions: Assertion[] };
type LoginProof = {
  tracked: TrackedRequest;
  expectedUrl: string;
  observedUrl: string;
  assertions: Assertion[];
  accountStatus: number;
};
type ObserverSnapshot = {
  origin: string;
  failedNetworkRequests: Array<Record<string, unknown>>;
  expectedNextCancellations: Array<Record<string, unknown>>;
  closedPrefetches: Array<Record<string, unknown>>;
  expectedNavigationCancellations: Array<Record<string, unknown>>;
  expectedLoginRedirects: Array<Record<string, unknown>>;
  unresolved: Array<Record<string, unknown>>;
};

function absoluteHttpUrl(value: string, origin: string) {
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function withoutNextRsc(url: URL) {
  const copy = new URL(url.href);
  copy.searchParams.delete("_rsc");
  return copy.pathname + copy.search;
}

function assertionsAreValid(assertions: Assertion[]) {
  return assertions.length > 0 && assertions.length <= 20 && assertions.every((item) =>
    item.status === "PASS" && item.name.trim() && item.details.trim() &&
    item.name.length <= 200 && item.details.length <= 1000,
  );
}

/** Correlates only narrowly verified Next RSC cancellations to their real navigation intent. */
export class NextCancellationObserver {
  readonly origin: string;
  private readonly testedSha: string;
  private readonly runId: string;
  private readonly requestIds = new WeakMap<Request, TrackedRequest>();
  private readonly tracked: TrackedRequest[] = [];
  private readonly pageIds = new WeakMap<Page, string>();
  private readonly pagesById = new Map<string, Page>();
  private readonly pages = new Set<Page>();
  private readonly observedPages = new WeakSet<Page>();
  private readonly intents: ClickIntent[] = [];
  private readonly destinationProofs: DestinationProof[] = [];
  private readonly loginProofs: LoginProof[] = [];
  private readonly usedIntentIds = new Set<string>();
  private readonly usedRequestIds = new Set<string>();
  private readonly closedByObserver = new Set<string>();
  private readonly outcomes: Record<string, unknown>[] = [];
  private readonly loginRedirects: Record<string, unknown>[] = [];
  private readonly productRedirects: Record<string, unknown>[] = [];
  private finalClosedPrefetches: Array<Record<string, unknown>> = [];
  private readonly intentional = new Set<TrackedRequest>();
  private readonly detachHandlers: Array<() => void> = [];
  private readonly stopRequestHandlers: Array<() => void> = [];
  private teardownStartedAt?: number;
  private finishing?: Promise<ObserverSnapshot>;
  private prefetchCount = 0;
  private readonly bindingName = `__codexNextNav_${randomUUID().replaceAll("-", "")}`;
  private finished?: ObserverSnapshot;

  constructor(input: { testedSha: string; runId: string; origin: string }) {
    const parsed = new URL(input.origin);
    if (parsed.protocol !== "https:" || parsed.origin !== input.origin || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("Next cancellation observer requires a canonical HTTPS origin.");
    }
    if (!/^[0-9a-f]{40}$/i.test(input.testedSha) || !input.runId.trim() || input.runId.length > 200) {
      throw new Error("Next cancellation observer requires a current SHA and run ID.");
    }
    this.origin = parsed.origin;
    this.testedSha = input.testedSha.toLowerCase();
    this.runId = input.runId;
  }

  async observe(page: Page) {
    if (this.finished || this.finishing) throw new Error("Cannot observe a page after evidence finalization has started.");
    if (this.observedPages.has(page)) return;
    this.observedPages.add(page);
    this.pages.add(page);
    const pageId = `page-${randomUUID()}`;
    this.pageIds.set(page, pageId);
    this.pagesById.set(pageId, page);
    await page.exposeBinding(this.bindingName, (source, raw: unknown) => {
      if (!raw || typeof raw !== "object") return;
      const intent = raw as { href?: unknown; sourceUrl?: unknown; trusted?: unknown; at?: unknown };
      if (intent.trusted !== true || typeof intent.href !== "string" || typeof intent.sourceUrl !== "string") return;
      const href = absoluteHttpUrl(intent.href, this.origin);
      const sourceUrl = absoluteHttpUrl(intent.sourceUrl, this.origin);
      if (!href || !sourceUrl) return;
      const sourcePageId = this.pageIds.get(source.page);
      if (sourcePageId !== pageId || this.intents.length >= 500) return;
      this.intents.push({
        id: `intent-${randomUUID()}`,
        pageId,
        sourceUrl: sourceUrl.href,
        href: href.href,
        trusted: true,
        at: typeof intent.at === "number" && Number.isFinite(intent.at) ? intent.at : Date.now(),
      });
    });
    const bindingName = this.bindingName;
    await page.addInitScript(({ bindingName, origin }) => {
      const handler = (event: MouseEvent) => {
        if (!event.isTrusted || !(event.target instanceof Element)) return;
        const anchor = event.target.closest("a[href]") as HTMLAnchorElement | null;
        if (!anchor) return;
        const href = new URL(anchor.href, location.href);
        if (href.origin !== origin || href.protocol !== "https:" || href.username || href.password) return;
        const source = new URL(location.href);
        source.hash = "";
        const payload = { href: href.href, sourceUrl: source.href, trusted: event.isTrusted, at: Date.now() };
        void (window as unknown as Record<string, (value: unknown) => Promise<void>>)[bindingName]?.(payload);
      };
      document.addEventListener("click", handler, true);
    }, { bindingName, origin: this.origin });
    await page.evaluate(({ bindingName, origin }) => {
      const key = `__codexNextClickInstalled_${bindingName}`;
      if ((window as unknown as Record<string, unknown>)[key]) return;
      (window as unknown as Record<string, unknown>)[key] = true;
      const handler = (event: MouseEvent) => {
        if (!event.isTrusted || !(event.target instanceof Element)) return;
        const anchor = event.target.closest("a[href]") as HTMLAnchorElement | null;
        if (!anchor) return;
        const href = new URL(anchor.href, location.href);
        if (href.origin !== origin || href.protocol !== "https:" || href.username || href.password) return;
        const source = new URL(location.href);
        source.hash = "";
        const payload = { href: href.href, sourceUrl: source.href, trusted: event.isTrusted, at: Date.now() };
        void (window as unknown as Record<string, (value: unknown) => Promise<void>>)[bindingName]?.(payload);
      };
      document.addEventListener("click", handler, true);
    }, { bindingName, origin: this.origin });

    const onRequest = (request: Request) => {
      let parsed: URL;
      try { parsed = new URL(request.url()); } catch { return; }
      const sameOrigin = parsed.protocol === "https:" && parsed.origin === this.origin && !parsed.username && !parsed.password;
      let sourceUrl = page.url();
      if (!absoluteHttpUrl(sourceUrl, this.origin)) sourceUrl = this.origin + "/";
      const canonicalSource = new URL(sourceUrl);
      canonicalSource.hash = "";
      sourceUrl = canonicalSource.href;
      let resolveTerminal!: () => void;
      const terminal = new Promise<void>((resolve) => { resolveTerminal = resolve; });
      const tracked: TrackedRequest = {
        id: `request-${randomUUID()}`,
        pageId,
        sourceUrl,
        sameOrigin,
        startedAt: Date.now(),
        terminal,
        resolveTerminal,
        isTerminal: false,
        url: sameOrigin ? parsed.href : `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
        path: parsed.pathname,
        method: request.method(),
        resource: request.resourceType(),
        nextActionHeader: false,
        responseStatus: null,
        request,
      };
      this.requestIds.set(request, tracked);
      this.tracked.push(tracked);
      if (sameOrigin) {
        try {
          // Read synchronously and retain only the safe routing markers. Never store cookie,
          // authorization, request-body, or opaque Server Action header values.
          const headers = request.headers();
          tracked.rsc = headers.rsc;
          tracked.prefetchHeader = headers["next-router-prefetch"];
          const segment = headers["next-router-segment-prefetch"];
          tracked.segmentPrefetch = typeof segment === "string" && segment.length <= 512 ? segment : undefined;
          tracked.nextActionHeader = typeof headers["next-action"] === "string" && headers["next-action"].length > 0;
        } catch {
          tracked.nextActionHeader = false;
        }
      }
    };
    const onResponse = (response: import("@playwright/test").Response) => {
      const tracked = this.requestIds.get(response.request());
      if (tracked) tracked.responseStatus = response.status();
    };
    const onRequestFailed = (request: Request) => {
      const tracked = this.requestIds.get(request);
      if (tracked) {
        tracked.error = request.failure()?.errorText ?? "request failed";
        if (this.teardownStartedAt !== undefined) tracked.cancellationPhase = "teardown";
        if (!tracked.isTerminal) {
          tracked.isTerminal = true;
          tracked.resolveTerminal();
        }
      }
    };
    const onRequestFinished = (request: Request) => {
      const tracked = this.requestIds.get(request);
      if (tracked && !tracked.isTerminal) {
        tracked.isTerminal = true;
        tracked.resolveTerminal();
      }
    };
    page.on("request", onRequest);
    page.on("response", onResponse);
    page.on("requestfailed", onRequestFailed);
    page.on("requestfinished", onRequestFinished);
    this.stopRequestHandlers.push(() => page.off("request", onRequest));
    this.detachHandlers.push(() => {
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);
      page.off("requestfinished", onRequestFinished);
    });
  }

  private requireTracked(request: Request) {
    const tracked = this.requestIds.get(request);
    if (!tracked) throw new Error("The request was not captured by this observer on an observed page.");
    return tracked;
  }

  private matchingLinkRequests(proof: DestinationProof) {
    const nextIntentAt = this.intents
      .filter((intent) => intent.pageId === proof.pageId && intent.at > proof.intent.at)
      .map((intent) => intent.at)
      .sort((left, right) => left - right)[0];
    const windowEnd = Math.min(proof.intent.at + 30_000, nextIntentAt === undefined ? Infinity : nextIntentAt - 25);
    return this.tracked.filter((tracked) => tracked.sameOrigin && !tracked.disposition &&
      tracked.pageId === proof.pageId && tracked.startedAt >= proof.intent.at - 250 &&
      tracked.startedAt <= windowEnd && tracked.method === "GET" &&
      tracked.resource === "fetch" && tracked.rsc === "1" && !tracked.prefetchHeader && !tracked.segmentPrefetch &&
      tracked.sourceUrl === proof.intent.sourceUrl &&
      tracked.path !== "/api" && !tracked.path.startsWith("/api/") && !tracked.path.startsWith("/_next/image") &&
      !/\.(?:png|jpe?g|webp|gif|svg|woff2?|css|js|mp4|webm)$/i.test(tracked.path) &&
      withoutNextRsc(new URL(tracked.url)) === proof.target);
  }

  private pendingDiagnostics(requests: TrackedRequest[]) {
    return requests.slice(0, 8).map((tracked) => {
      const page = this.pagesById.get(tracked.pageId);
      const safeRsc = tracked.rsc === "1" ? "1" : tracked.rsc ? "present-other" : "absent";
      const safePrefetch = tracked.prefetchHeader === "1" ? "1" : tracked.prefetchHeader ? "present-other" : "absent";
      const segmentPrefetch = tracked.segmentPrefetch ? "present" : "absent";
      const status = tracked.responseStatus === null ? "none" : String(tracked.responseStatus);
      return `${tracked.method} ${tracked.path} resource=${tracked.resource} sameOrigin=${tracked.sameOrigin} rsc=${safeRsc} nextRouterPrefetch=${safePrefetch} segmentPrefetch=${segmentPrefetch} responseStatus=${status} pageClosed=${page?.isClosed() ?? true}`;
    }).join(", ");
  }

  private isClosedPrefetch(tracked: TrackedRequest) {
    const recognizedPrefetch = tracked.prefetchHeader === "1" ||
      (typeof tracked.segmentPrefetch === "string" && tracked.segmentPrefetch.length > 0 && tracked.segmentPrefetch.length <= 512);
    return this.closedByObserver.has(tracked.pageId) && tracked.sameOrigin && !tracked.error && !tracked.isTerminal &&
      tracked.method === "GET" && tracked.resource === "fetch" && tracked.rsc === "1" && recognizedPrefetch &&
      !tracked.path.startsWith("/api/") && tracked.path !== "/api" && !tracked.path.startsWith("/_next/image") &&
      !/\.(?:png|jpe?g|webp|gif|svg|woff2?|css|js|mp4|webm)$/i.test(tracked.path) &&
      (tracked.responseStatus === null || (tracked.responseStatus >= 200 && tracked.responseStatus < 300));
  }

  private recordClosedPrefetch(tracked: TrackedRequest) {
    if (this.usedRequestIds.has(tracked.id)) throw new Error("A request cannot be recorded more than once in Next evidence.");
    this.usedRequestIds.add(tracked.id);
    return {
      id: `closed-prefetch-${randomUUID()}`,
      testedSha: this.testedSha,
      runId: this.runId,
      origin: this.origin,
      pageId: tracked.pageId,
      requestId: tracked.id,
      requestUrl: tracked.url,
      requestPath: tracked.path,
      requestMethod: tracked.method,
      resource: tracked.resource,
      rsc: tracked.rsc,
      prefetchHeader: tracked.prefetchHeader,
      segmentPrefetch: tracked.segmentPrefetch,
      responseStatus: tracked.responseStatus,
      phase: "teardown",
      pageClosed: true,
      closedByObserver: true,
      completionObserved: false,
      terminalObservation: "page-closed-without-request-terminal-event",
    };
  }

  private recordLinkCancellation(proof: DestinationProof, tracked: TrackedRequest) {
    if (this.usedIntentIds.has(proof.intent.id) || this.usedRequestIds.has(tracked.id)) {
      throw new Error("A trusted click intent or request has already been used to classify a cancellation.");
    }
    if (this.outcomes.filter((outcome) => outcome.kind === "next-link-navigation").length >= 100) {
      throw new Error("Next link cancellation evidence exceeded its per-run bound.");
    }
    const observed = absoluteHttpUrl(proof.observedUrl, this.origin);
    const expected = absoluteHttpUrl(proof.expectedUrl, this.origin);
    if (!expected || !observed || observed.pathname !== expected.pathname || observed.search !== expected.search) {
      throw new Error("A canceled Next request did not land on the asserted page destination.");
    }
    const id = `next-link-${randomUUID()}`;
    const details = proof.assertions.map((item) => `${item.name}: ${item.details}`).join(" ").slice(0, 1000);
    const outcome = {
      id, kind: "next-link-navigation", testedSha: this.testedSha, runId: this.runId, origin: this.origin,
      pageId: proof.pageId, requestId: tracked.id, requestUrl: tracked.url, requestPath: tracked.path,
      requestMethod: tracked.method, resource: tracked.resource, sourceUrl: tracked.sourceUrl,
      rsc: tracked.rsc, prefetchHeader: tracked.prefetchHeader, segmentPrefetch: tracked.segmentPrefetch,
      observedFailure: tracked.error, responseStatus: tracked.responseStatus,
      phase: tracked.cancellationPhase ?? "navigation",
      intentId: proof.intent.id, trustedClick: proof.intent.trusted, intentHref: proof.intent.href,
      intentPageId: proof.intent.pageId, intentSourceUrl: proof.intent.sourceUrl,
      intentAt: proof.intent.at, requestStartedAt: tracked.startedAt,
      expectedUrl: expected.href, observedDestinationUrl: observed.href,
      assertions: proof.assertions, assertionStatus: "PASS", details,
    };
    tracked.disposition = "next-canceled";
    tracked.cancellationKind = outcome.kind;
    tracked.outcomeId = id;
    tracked.reason = details;
    tracked.outcome = outcome;
    this.outcomes.push(outcome);
    this.usedIntentIds.add(proof.intent.id);
    this.usedRequestIds.add(tracked.id);
  }

  classifyProductRefusal(request: Request, existingOutcome: Record<string, unknown>) {
    if (this.finished || this.finishing) throw new Error("Cannot classify a request after evidence finalization has started.");
    const tracked = this.requireTracked(request);
    if (!tracked.sameOrigin || tracked.error !== "net::ERR_ABORTED" || tracked.method !== "POST" || tracked.path !== existingOutcome.requestPath ||
      tracked.url !== existingOutcome.requestUrl || existingOutcome.kind !== "product-deletion-refusal") {
      throw new Error("The observed request does not match the existing product refusal proof.");
    }
    if (this.intentional.has(tracked)) throw new Error("A request cancellation may only be classified once.");
    this.intentional.add(tracked);
    tracked.disposition = "navigation-canceled";
    tracked.outcomeId = String(existingOutcome.id);
    tracked.reason = String(existingOutcome.details);
    tracked.cancellationKind = "product-deletion-refusal";
    tracked.outcome = existingOutcome;
    this.productRedirects.push(existingOutcome);
  }

  async assertDestination(page: Page, input: { expectedUrl: string; assertions: Assertion[] }) {
    if (this.finished || this.finishing) throw new Error("Cannot add navigation proof after evidence finalization has started.");
    const pageId = this.pageIds.get(page);
    const expected = absoluteHttpUrl(input.expectedUrl, this.origin);
    if (!pageId || !expected || !assertionsAreValid(input.assertions)) throw new Error("Invalid Next link destination assertion.");
    const observed = absoluteHttpUrl(page.url(), this.origin);
    if (!observed || observed.pathname !== expected.pathname || observed.search !== expected.search) {
      throw new Error("The page did not reach the expected same-origin navigation destination.");
    }
    const target = expected.pathname + expected.search;
    const intent = [...this.intents].reverse().find((candidate) => candidate.pageId === pageId && candidate.trusted &&
      candidate.href && (() => { const u = new URL(candidate.href); return u.pathname + u.search === target; })());
    if (!intent) throw new Error("A trusted same-page anchor click for the destination was not captured.");
    const proof: DestinationProof = { pageId, intent, target, expectedUrl: expected.href, observedUrl: observed.href, assertions: input.assertions };
    const previousProof = this.destinationProofs.find((candidate) => candidate.intent.id === intent.id);
    if (previousProof) {
      if (previousProof.target !== proof.target || previousProof.expectedUrl !== proof.expectedUrl ||
        previousProof.observedUrl !== proof.observedUrl) throw new Error("A click intent cannot be reused for another destination proof.");
      return;
    }
    this.destinationProofs.push(proof);
    const candidate = this.matchingLinkRequests(proof).filter((tracked) => tracked.error === "net::ERR_ABORTED");
    if (candidate.length > 1) throw new Error("The trusted click matched more than one canceled Next link request.");
    if (candidate.length === 1) this.recordLinkCancellation(proof, candidate[0]);
  }

  async assertLoginRedirect(request: Request, page: Page, input: {
    expectedUrl: string; freshFixtureIdentity: true; authenticatedServerAccount: true;
    accountStatus: number; assertions: Assertion[];
  }) {
    if (this.finished || this.finishing) throw new Error("Cannot add login proof after evidence finalization has started.");
    const tracked = this.requireTracked(request);
    const expected = absoluteHttpUrl(input.expectedUrl, this.origin);
    const observed = absoluteHttpUrl(page.url(), this.origin);
    const requestUrl = absoluteHttpUrl(tracked.url, this.origin);
    const responseStatus = tracked.responseStatus;
    if (!tracked.sameOrigin || !expected || !observed || !requestUrl || request.method() !== "POST" ||
      tracked.resource !== "fetch" || requestUrl.pathname !== "/en/login" ||
      (tracked.error !== undefined && tracked.error !== "net::ERR_ABORTED") || !tracked.nextActionHeader ||
      ![200, 303].includes(responseStatus ?? -1) ||
      observed.pathname !== expected.pathname || observed.search !== expected.search ||
      input.freshFixtureIdentity !== true || input.authenticatedServerAccount !== true || input.accountStatus !== 200 ||
      !assertionsAreValid(input.assertions)) {
      throw new Error("The observed login request lacks a completed, identity-verified same-origin redirect.");
    }
    const returnTo = requestUrl.searchParams.getAll("returnTo");
    if (returnTo.length !== 1 || [...requestUrl.searchParams.keys()].some((key) => key !== "returnTo") ||
      !returnTo[0].startsWith("/") || returnTo[0].startsWith("//") || returnTo[0].includes("\\")) {
      throw new Error("The login action must use one safe internal returnTo value.");
    }
    const returnToUrl = absoluteHttpUrl(new URL(returnTo[0], this.origin).href, this.origin);
    if (!returnToUrl || returnToUrl.pathname !== expected.pathname || returnToUrl.search !== expected.search) {
      throw new Error("The observed login returnTo does not match the asserted destination.");
    }
    const proof: LoginProof = {
      tracked, expectedUrl: expected.href, observedUrl: observed.href,
      assertions: input.assertions, accountStatus: input.accountStatus,
    };
    const previous = this.loginProofs.find((candidate) => candidate.tracked.id === tracked.id);
    if (previous) {
      if (previous.expectedUrl !== proof.expectedUrl || previous.observedUrl !== proof.observedUrl) {
        throw new Error("A login request cannot be reused for a different identity or destination proof.");
      }
      return;
    }
    this.loginProofs.push(proof);
    if (tracked.error === "net::ERR_ABORTED") this.recordLoginCancellation(proof);
  }

  private recordLoginCancellation(proof: LoginProof) {
    const tracked = proof.tracked;
    if (tracked.disposition || this.loginRedirects.length >= 10) {
      throw new Error("Login redirect cancellation evidence is duplicated or exceeds its per-run bound.");
    }
    if (!tracked.sameOrigin || tracked.error !== "net::ERR_ABORTED" || !tracked.nextActionHeader ||
      ![200, 303].includes(tracked.responseStatus ?? -1)) {
      throw new Error("The canceled login request lacks its observed same-origin Server Action response.");
    }
    const id = `login-redirect-${randomUUID()}`;
    const details = proof.assertions.map((item) => `${item.name}: ${item.details}`).join(" ").slice(0, 1000);
    const outcome = {
      id, testedSha: this.testedSha, runId: this.runId, origin: this.origin,
      pageId: tracked.pageId, requestId: tracked.id, requestUrl: tracked.url, requestPath: tracked.path,
      requestMethod: tracked.method, resource: tracked.resource, nextServerAction: true,
      nextActionHeader: true, observedFailure: tracked.error, responseStatus: tracked.responseStatus,
      phase: tracked.cancellationPhase ?? "navigation",
      expectedUrl: proof.expectedUrl, observedDestinationUrl: proof.observedUrl,
      freshFixtureIdentity: true, authenticatedServerAccount: true, accountStatus: proof.accountStatus,
      assertions: proof.assertions, assertionStatus: "PASS", details,
    };
    tracked.disposition = "login-redirect-canceled";
    tracked.outcomeId = id;
    tracked.reason = details;
    tracked.outcome = outcome;
    this.loginRedirects.push(outcome);
  }

  async finish() {
    if (this.finished) return this.finished;
    if (this.finishing) return this.finishing;
    this.finishing = this.finalize();
    return this.finishing;
  }

  private async finalize() {
    for (const stop of this.stopRequestHandlers.splice(0)) stop();
    const waitForPending = async (timeoutMs: number) => {
      const pendingNow = this.tracked.filter((tracked) => !tracked.isTerminal);
      if (!pendingNow.length) return { drained: true, pending: pendingNow };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const drained = await Promise.race([
        Promise.all(pendingNow.map((tracked) => tracked.terminal)).then(() => true),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
      ]);
      if (timer) clearTimeout(timer);
      return { drained, pending: pendingNow };
    };
    try {
      let drain = await waitForPending(1_500);
      if (!drain.drained) {
        this.teardownStartedAt = Date.now();
        const closePages = Promise.all([...this.pages].map(async (page) => {
          if (page.isClosed()) return;
          await page.close({ runBeforeUnload: false });
          const pageId = [...this.pagesById].find(([, observedPage]) => observedPage === page)?.[0];
          if (pageId) this.closedByObserver.add(pageId);
        })).then(() => ({ status: "closed" as const }), () => ({ status: "failed" as const }));
        let closeTimer: ReturnType<typeof setTimeout> | undefined;
        const pagesClosed = await Promise.race([
          closePages,
          new Promise<{ status: "timeout" }>((resolve) => { closeTimer = setTimeout(() => resolve({ status: "timeout" }), 2_000); }),
        ]);
        if (closeTimer) clearTimeout(closeTimer);
        if (pagesClosed.status !== "closed") {
          const stillPending = this.tracked.filter((tracked) => !tracked.isTerminal);
          const pendingSummary = this.pendingDiagnostics(stillPending);
          const stageFailure = pagesClosed.status === "timeout" ? "timed out" : "failed";
          throw new Error(`Browser observer page-close stage ${stageFailure} with ${stillPending.length} request(s) unsettled${pendingSummary ? `: ${pendingSummary}` : ""}.`);
        }
        drain = await waitForPending(10_000);
      }
      const pendingAfterDrain = this.tracked.filter((tracked) => !tracked.isTerminal);
      const closedPrefetches = pendingAfterDrain.filter((tracked) => this.isClosedPrefetch(tracked)).map((tracked) => {
        if (this.usedRequestIds.has(tracked.id)) throw new Error("A request cannot be both a Next cancellation and a closed prefetch.");
        return this.recordClosedPrefetch(tracked);
      });
      const remainingPending = pendingAfterDrain.filter((tracked) => !this.isClosedPrefetch(tracked));
      if (remainingPending.length) {
        const pendingSummary = this.pendingDiagnostics(remainingPending);
        throw new Error(`Browser request observer timed out waiting for ${remainingPending.length} non-prefetch request(s) to settle${pendingSummary ? `: ${pendingSummary}` : ""}.`);
      }
      this.finalClosedPrefetches = closedPrefetches;
    } finally {
      for (const detach of this.detachHandlers.splice(0)) detach();
    }
    for (const proof of this.loginProofs) {
      if (proof.tracked.error === "net::ERR_ABORTED" && !proof.tracked.disposition) this.recordLoginCancellation(proof);
    }
    for (const proof of this.destinationProofs) {
      const candidate = this.matchingLinkRequests(proof).filter((tracked) => tracked.error === "net::ERR_ABORTED");
      if (candidate.length > 1) throw new Error("A trusted navigation intent matched multiple canceled Next requests.");
      if (candidate.length === 1) this.recordLinkCancellation(proof, candidate[0]);
    }
    for (const tracked of this.tracked) {
      if (!tracked.sameOrigin || tracked.disposition || tracked.error !== "net::ERR_ABORTED" || tracked.method !== "GET" ||
        tracked.resource !== "fetch" || tracked.rsc !== "1" || tracked.path.startsWith("/api/") ||
        tracked.path.startsWith("/_next/image") || /\.(?:png|jpe?g|webp|gif|svg|woff2?|css|js|mp4|webm)$/i.test(tracked.path) ||
        !(tracked.prefetchHeader === "1" || (tracked.segmentPrefetch && tracked.segmentPrefetch.length <= 512)) ||
        (tracked.responseStatus !== null && (tracked.responseStatus < 200 || tracked.responseStatus >= 300))) continue;
      if (this.prefetchCount >= 900 || this.outcomes.length >= 1000) throw new Error("Next cancellation evidence exceeded its per-run bound.");
      if (this.usedRequestIds.has(tracked.id)) throw new Error("A Next request cannot be recorded more than once.");
      const id = `next-prefetch-${randomUUID()}`;
      const details = "A same-origin Next RSC prefetch request with an explicit router prefetch header was canceled; the observed response was absent or successful.";
      const outcome = {
        id, kind: "next-prefetch", testedSha: this.testedSha, runId: this.runId, origin: this.origin,
        pageId: tracked.pageId, requestId: tracked.id, requestUrl: tracked.url, requestPath: tracked.path,
        requestMethod: tracked.method, resource: tracked.resource, sourceUrl: tracked.sourceUrl,
        rsc: tracked.rsc, prefetchHeader: tracked.prefetchHeader, segmentPrefetch: tracked.segmentPrefetch,
        observedFailure: tracked.error, responseStatus: tracked.responseStatus,
        phase: tracked.cancellationPhase ?? "navigation", assertionStatus: "PASS", details,
      };
      tracked.disposition = "next-canceled";
      tracked.cancellationKind = outcome.kind;
      tracked.outcomeId = id;
      tracked.reason = details;
      tracked.outcome = outcome;
      this.outcomes.push(outcome);
      this.prefetchCount += 1;
      this.usedRequestIds.add(tracked.id);
    }
    if (this.prefetchCount + this.finalClosedPrefetches.length > 900 || this.outcomes.length + this.finalClosedPrefetches.length > 1000) {
      throw new Error("Next request cancellation and closed-prefetch evidence exceeded its per-run bound.");
    }
    const failedNetworkRequests = this.tracked.filter((tracked) => tracked.error).map((tracked) => {
      if (tracked.disposition && tracked.outcome) return {
        url: tracked.url, path: tracked.path, method: tracked.method, resource: tracked.resource,
        error: tracked.error, pageId: tracked.pageId, requestId: tracked.id,
        disposition: tracked.disposition, outcomeId: tracked.outcomeId, reason: tracked.reason,
        cancellationKind: tracked.cancellationKind,
        ...(tracked.disposition === "login-redirect-canceled"
          ? { nextServerAction: true, phase: tracked.cancellationPhase ?? "navigation" } : {}),
        ...(tracked.disposition === "navigation-canceled" ? { nextServerAction: true, phase: "product deletion refusal" } : {}),
        ...(tracked.disposition === "next-canceled" ? { phase: tracked.cancellationPhase ?? "navigation" } : {}),
      };
      return { url: tracked.url, path: tracked.path, method: tracked.method, resource: tracked.resource,
        error: tracked.error, pageId: tracked.pageId, requestId: tracked.id };
    });
    const classified = new Set(this.tracked.filter((tracked) => tracked.disposition).map((tracked) => tracked.id));
    const unresolved = this.tracked.filter((tracked) => tracked.error && !classified.has(tracked.id)).map((tracked) => ({
      url: tracked.url, path: tracked.path, method: tracked.method, resource: tracked.resource,
      error: tracked.error, pageId: tracked.pageId, requestId: tracked.id,
    }));
    const deepFreeze = (value: unknown): unknown => {
      if (value && typeof value === "object" && !Object.isFrozen(value)) {
        for (const nested of Object.values(value)) deepFreeze(nested);
        Object.freeze(value);
      }
      return value;
    };
    const freezeRecords = (records: Array<Record<string, unknown>>) =>
      Object.freeze(records.map((record) => deepFreeze(structuredClone(record)))) as unknown as Array<Record<string, unknown>>;
    this.finished = Object.freeze({
      origin: this.origin,
      failedNetworkRequests: freezeRecords(failedNetworkRequests),
      expectedNextCancellations: freezeRecords(this.outcomes),
      closedPrefetches: freezeRecords(this.finalClosedPrefetches),
      expectedNavigationCancellations: freezeRecords(this.productRedirects),
      expectedLoginRedirects: freezeRecords(this.loginRedirects),
      unresolved: freezeRecords(unresolved),
    });
    return this.finished;
  }

}
