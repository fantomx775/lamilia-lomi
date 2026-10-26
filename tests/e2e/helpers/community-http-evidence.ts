import { expect, type Page, type Response } from "@playwright/test";
import { COMMUNITY_TEST_ORIGIN } from "./community-fixtures";

/** Only an asserted real HTTP denial may explain a browser resource diagnostic. */
export function communityHttpEvidence(testedSha: string, runId: string) {
  const consoleErrors: Array<{ message: string; url: string }> = [];
  const expectedHttpOutcomes: Array<{
    id: string; testedSha: string; runId: string; url: string; path: string; method: string;
    expectedStatus: number; observedStatus: number; expectedError: string;
    observedError: string; assertionStatus: "PASS"; details: string;
  }> = [];
  function observe(page: Page) {
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push({ message: message.text(), url: message.location().url });
    });
  }
  async function assertOutcome(response: Response, input: {
    id: string; path: string; method: string; status: number; error: string; details: string;
  }) {
    expect(response.url()).toBe(`${COMMUNITY_TEST_ORIGIN}${input.path}`);
    expect(response.request().method()).toBe(input.method);
    expect(response.status()).toBe(input.status);
    const body = await response.json();
    expect(body.error).toBe(input.error);
    expectedHttpOutcomes.push({ id: input.id, testedSha, runId, url: response.url(), path: input.path,
      method: response.request().method(), expectedStatus: input.status, observedStatus: response.status(),
      expectedError: input.error, observedError: body.error, assertionStatus: "PASS", details: input.details });
  }
  function finish() {
    const used = new Set<string>();
    const classified = consoleErrors.map((event) => {
      const outcome = expectedHttpOutcomes.find((item) => !used.has(item.id)
        && event.url === item.url
        && event.message === `Failed to load resource: the server responded with a status of ${item.observedStatus} (${item.observedStatus === 409 ? "Conflict" : item.observedStatus === 403 ? "Forbidden" : "Bad Request"})`);
      if (!outcome) return event;
      used.add(outcome.id);
      return { ...event, disposition: "expected", outcomeId: outcome.id, path: outcome.path,
        method: outcome.method, statusCode: outcome.observedStatus, reason: outcome.details };
    });
    expect(classified.filter((event) => !("disposition" in event))).toEqual([]);
    expect(used.size).toBe(expectedHttpOutcomes.length);
    return { consoleErrors: classified, expectedHttpOutcomes };
  }
  return { observe, assertOutcome, finish };
}
