import { test } from "vitest";
import assert from "node:assert/strict";
import {
  buildReadiness,
  extractAcceptanceCriteria,
  findBranchCandidates,
  hydratePullRequestDraftState,
  pagedRest,
  projectItemMatchesIssue,
  parseWorktreeBranches,
  referencesIssue,
  repositoryFromRemote,
  statusTransitionBlockers,
} from "./agent-harness.mjs";

test("reads GitHub HTTPS and SSH repository remotes", () => {
  assert.deepEqual(repositoryFromRemote("https://github.com/fantomx775/lamilia-lomi.git"), {
    owner: "fantomx775",
    repo: "lamilia-lomi",
  });
  assert.deepEqual(repositoryFromRemote("git@github.com:fantomx775/lamilia-lomi.git"), {
    owner: "fantomx775",
    repo: "lamilia-lomi",
  });
});

test("extracts acceptance criteria without consuming the following section", () => {
  assert.equal(
    extractAcceptanceCriteria("## Goal\nDo work.\n## Acceptance Criteria\n- [ ] Save it\n## Notes\nLater."),
    "- [ ] Save it",
  );
  assert.equal(extractAcceptanceCriteria("## Goal\nDo work."), null);
});

test("matches exact issue references and avoids adjacent issue numbers", () => {
  assert.equal(referencesIssue("Fixes #29", 29, "example/repo"), true);
  assert.equal(referencesIssue("Fixes example/repo#29", 29, "example/repo"), true);
  assert.equal(referencesIssue("https://github.com/example/repo/issues/29", 29, "example/repo"), true);
  assert.equal(referencesIssue("See https://github.com/example/repo/issues/29.", 29, "example/repo"), true);
  assert.equal(referencesIssue("https://github.com/example/repo/issues/29,", 29, "example/repo"), true);
  assert.equal(referencesIssue("https://github.com/example/repo/issues/29/", 29, "example/repo"), true);
  assert.equal(referencesIssue("(https://github.com/example/repo/issues/29.)", 29, "example/repo"), true);
  assert.equal(referencesIssue("https://github.com/example/repo/issues/29.evil", 29, "example/repo"), false);
  assert.equal(referencesIssue("https://github.com/example/repo/issues/29,evil", 29, "example/repo"), false);
  assert.equal(referencesIssue("https://github.com/example/repo/issues/29/next", 29, "example/repo"), false);
  assert.equal(referencesIssue("https://github.com/example/repo/issues/290", 29, "example/repo"), false);
  assert.equal(referencesIssue("Fixes #129", 29, "example/repo"), false);
});

test("does not treat a foreign repository issue reference as a local PR link", () => {
  assert.equal(referencesIssue("Related to other/repo#32", 32, "fantomx775/lamilia-lomi"), false);
  assert.equal(
    referencesIssue("https://github.com/other/repo/issues/32", 32, "fantomx775/lamilia-lomi"),
    false,
  );
  assert.equal(
    referencesIssue(
      "https://attacker.test/github.com/fantomx775/lamilia-lomi/issues/32",
      32,
      "fantomx775/lamilia-lomi",
    ),
    false,
  );
});

test("finds existing branches by issue number or meaningful title terms", () => {
  assert.deepEqual(
    findBranchCandidates(
      ["main", "codex/issue-29-layout", "codex/catalog-layout", "codex/auth-polish"],
      { number: 29, title: "Configurable books-per-row catalog layout" },
    ),
    ["codex/issue-29-layout", "codex/catalog-layout"],
  );
});

test("matches Project cards by repository issue node ID, not issue number alone", () => {
  const issue = { number: 29, node_id: "I_repoA_29" };
  assert.equal(projectItemMatchesIssue({ content: { id: "I_repoA_29", number: 29 } }, issue), true);
  assert.equal(projectItemMatchesIssue({ content: { id: "I_repoB_29", number: 29 } }, issue), false);
  assert.equal(projectItemMatchesIssue({ content: { number: 29 } }, issue), false);
});

test("finds branches checked out in linked local worktrees", () => {
  assert.deepEqual(
    parseWorktreeBranches(
      "worktree C:/repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree C:/repo-2\nHEAD def456\nbranch refs/heads/codex/issue-29-layout\n",
    ),
    ["main", "codex/issue-29-layout"],
  );
});

test("fails explicitly rather than hiding results beyond the REST page cap", async () => {
  let pages = 0;
  const client = {
    request: async () => {
      pages += 1;
      return Array.from({ length: 100 }, (_, index) => index);
    },
  };
  await assert.rejects(
    pagedRest(client, "/issues/29/comments"),
    /Pagination limit reached.*results may be incomplete/,
  );
  assert.equal(pages, 10);
});

test("uses exact issue number when a title has no meaningful branch keywords", () => {
  assert.deepEqual(
    findBranchCandidates(["codex/29", "codex/129", "codex/and-the-work"], {
      number: 29,
      title: "And the work",
    }),
    ["codex/29"],
  );
  assert.deepEqual(
    findBranchCandidates(["codex/admin-motion-polish"], {
      number: 32,
      title: "[EPIC] Lamilia Lomi polish & admin UX",
    }),
    [],
  );
});

test("readiness requires an open issue, a project card, and readable clear dependencies", () => {
  const ready = buildReadiness({
    issue: { state: "open", body: "## Acceptance Criteria\n- [ ] Save" },
    item: { fieldValues: { nodes: [{ field: { name: "Status" }, name: "Backlog" }] } },
    blockedBy: [],
    dependencyReadAvailable: true,
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.recommendedStatus, "Ready");
  assert.equal(ready.acceptanceCriteriaPresent, true);

  const blocked = buildReadiness({
    issue: { state: "open", body: "## Acceptance Criteria\n- [ ] Save" },
    item: { fieldValues: { nodes: [{ field: { name: "Status" }, name: "Backlog" }] } },
    blockedBy: [{ number: 23, title: "Media pipeline", state: "open", html_url: "https://example.test/23" }],
    dependencyReadAvailable: true,
  });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.recommendedStatus, "Blocked");
  assert.match(blocked.reasons[0], /#23/);

  const archived = buildReadiness({
    issue: { state: "open", body: "## Acceptance Criteria\n- [ ] Save" },
    item: {
      isArchived: true,
      fieldValues: { nodes: [{ field: { name: "Status" }, name: "Backlog" }] },
    },
    blockedBy: [],
    dependencyReadAvailable: true,
  });
  assert.equal(archived.ready, false);
  assert.match(archived.reasons.join(" "), /archived/);
});

test("fails closed when dependencies are unreadable or the issue is closed", () => {
  const unreadable = buildReadiness({
    issue: { state: "open", body: "" },
    item: { fieldValues: { nodes: [] } },
    blockedBy: [],
    dependencyReadAvailable: false,
  });
  assert.equal(unreadable.ready, false);
  assert.equal(unreadable.acceptanceCriteriaPresent, false);
  assert.match(unreadable.reasons.join(" "), /acceptance criteria are missing/);

  const noCriteria = buildReadiness({
    issue: { state: "open", body: "## Goal\nMake the change." },
    item: { fieldValues: { nodes: [] } },
    blockedBy: [],
    dependencyReadAvailable: true,
  });
  assert.equal(noCriteria.ready, false);
  assert.match(noCriteria.reasons.join(" "), /acceptance criteria are missing/);

  const incompleteHistory = buildReadiness({
    issue: { state: "open", body: "## Acceptance Criteria\n- [ ] Save" },
    item: { fieldValues: { nodes: [] } },
    blockedBy: [],
    dependencyReadAvailable: true,
    commentsReadAvailable: false,
    resumeContextAvailable: false,
  });
  assert.equal(incompleteHistory.ready, false);
  assert.match(incompleteHistory.reasons.join(" "), /comments could not be read/);
  assert.match(incompleteHistory.reasons.join(" "), /branch history could not be read/);

  const closed = buildReadiness({
    issue: { state: "closed", body: "" },
    item: { fieldValues: { nodes: [] } },
    blockedBy: [],
    dependencyReadAvailable: true,
  });
  assert.equal(closed.ready, false);
  assert.match(closed.reasons[0], /closed/);
});

test("guards Ready and In Progress transitions but permits recovery from Blocked", () => {
  const notReady = {
    ready: false,
    reasons: ["blocked by open issue(s): #23"],
  };
  assert.deepEqual(statusTransitionBlockers("Ready", notReady), notReady.reasons);
  assert.deepEqual(statusTransitionBlockers("In Progress", notReady), notReady.reasons);
  assert.deepEqual(statusTransitionBlockers("Review", notReady), [
    "an open non-draft PR linked to this issue is required",
  ]);
  assert.deepEqual(statusTransitionBlockers("Review", notReady, [
    { state: "open", draft: true },
    { state: "closed", draft: false },
  ]), ["an open non-draft PR linked to this issue is required"]);
  assert.deepEqual(statusTransitionBlockers("Review", notReady, [
    { state: "open", draft: false },
  ]), []);

  const recovered = buildReadiness({
    issue: { state: "open", body: "## Acceptance Criteria\n- [ ] Save" },
    item: { fieldValues: { nodes: [{ field: { name: "Status" }, name: "Blocked" }] } },
    blockedBy: [],
    dependencyReadAvailable: true,
  });
  assert.equal(recovered.ready, true);
  assert.deepEqual(statusTransitionBlockers("Ready", recovered), []);
});

test("hydrates draft state for timeline-linked open PRs before the Review gate", () => {
  const timelineLinked = [{ number: 11, state: "open", title: "Harness", url: "https://github.com/example/repo/pull/11" }];
  const openPullRequests = [{
    number: 11,
    html_url: "https://github.com/example/repo/pull/11",
    state: "open",
    draft: false,
  }];
  const hydrated = hydratePullRequestDraftState(timelineLinked, openPullRequests);

  assert.equal(hydrated[0].draft, false);
  assert.deepEqual(statusTransitionBlockers("Review", { ready: true, reasons: [] }, hydrated), []);
  assert.equal(hydrated[0].title, "Harness");

  const draft = hydratePullRequestDraftState(timelineLinked, [{
    number: 11,
    html_url: "https://github.com/example/repo/pull/11",
    state: "open",
    draft: true,
  }]);
  assert.deepEqual(statusTransitionBlockers("Review", { ready: true, reasons: [] }, draft), [
    "an open non-draft PR linked to this issue is required",
  ]);

  const crossRepository = hydratePullRequestDraftState(
    [{ ...timelineLinked[0], url: "https://github.com/other/repo/pull/11" }],
    openPullRequests,
  );
  assert.equal(crossRepository[0].draft, undefined);
  assert.deepEqual(statusTransitionBlockers("Review", { ready: true, reasons: [] }, crossRepository), [
    "an open non-draft PR linked to this issue is required",
  ]);
});
