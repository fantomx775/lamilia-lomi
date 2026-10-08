import { test } from "vitest";
import assert from "node:assert/strict";
import {
  buildReleaseRequirements,
  buildReadiness,
  extractAcceptanceCriteria,
  findBranchCandidates,
  githubToken,
  hydratePullRequestDraftState,
  inspectIssue,
  pagedRest,
  planIssueRecovery,
  projectItemMatchesIssue,
  parseWorktreeBranches,
  referencesIssue,
  repositoryFromRemote,
  summarizeGitHubChecks,
  statusTransitionBlockers,
  validateIndependentReview,
  verificationEvidence,
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

test("blocks essential dependency gaps while reporting noncritical history gaps as warnings", () => {
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
  assert.equal(incompleteHistory.ready, true);
  assert.match(incompleteHistory.warnings.join(" "), /comments could not be read/);
  assert.match(incompleteHistory.warnings.join(" "), /branch history is incomplete/);

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

test("uses gh auth login sessions naturally and keeps authentication output private", () => {
  const calls = [];
  const token = githubToken({
    env: {},
    execute: (command, args, options) => {
      calls.push({ command, args, options });
      return "gh-test-token\n";
    },
  });
  assert.equal(token, "gh-test-token");
  assert.deepEqual(calls.map(({ command, args }) => [command, args]), [["gh", ["auth", "token"]]]);
  assert.deepEqual(calls[0].options.stdio, ["ignore", "pipe", "ignore"]);

  assert.equal(
    githubToken({
      env: { GH_TOKEN: "configured-test-token" },
      execute: () => assert.fail("configured token should avoid subprocesses"),
    }),
    "configured-test-token",
  );
});

test("falls back quietly to Git credentials without relaying helper errors", () => {
  const calls = [];
  const token = githubToken({
    env: {},
    execute: (command, args, options) => {
      calls.push(command);
      if (command === "gh") throw new Error("sensitive-test-secret from auth helper");
      assert.equal(args.join(" "), "credential fill");
      assert.match(options.input, /host=github\.com/);
      assert.equal(options.stdio[2], "ignore");
      return "username=test-user\npassword=git-test-token\n";
    },
  });
  assert.deepEqual(calls, ["gh", "git"]);
  assert.equal(token, "git-test-token");

  assert.throws(
    () => githubToken({
      env: {},
      execute: () => { throw new Error("sensitive-test-secret"); },
    }),
    (error) => {
      assert.match(error.message, /gh auth login/);
      assert.doesNotMatch(error.message, /sensitive-test-secret/);
      return true;
    },
  );
});

test("classifies migration and production dependency changes with a pre-merge deployment order", () => {
  const release = buildReleaseRequirements([
    { filename: "supabase/migrations/20261008170639_configurable_catalog_layout.sql" },
    { filename: "package.json" },
    { filename: "src/app/catalog/page.tsx" },
  ]);

  assert.equal(release.status, "NOT RUN");
  assert.deepEqual(release.migrationFiles, [
    "supabase/migrations/20261008170639_configurable_catalog_layout.sql",
  ]);
  assert.deepEqual(release.dependencyManifests, ["package.json"]);
  assert.match(release.deploymentOrder[0], /migration compatibility/);
  assert.match(release.deploymentOrder[1], /before merging/);
  assert.match(release.deploymentOrder[2], /Vercel Git integration/);
  assert.match(release.deploymentOrder[4], /production dependencies/);

  assert.equal(buildReleaseRequirements([]).status, "PASS");
  assert.equal(buildReleaseRequirements([], { available: false }).status, "BLOCKED");
});

test("resumes Issue 29 from its existing PR and preserves Review without creating or resetting work", () => {
  const readiness = buildReadiness({
    issue: { state: "open", body: "## Acceptance Criteria\n- [ ] Save" },
    item: { fieldValues: { nodes: [{ field: { name: "Status" }, name: "Review" }] } },
    blockedBy: [],
    dependencyReadAvailable: true,
  });
  assert.equal(readiness.recommendedStatus, "Review");

  const plan = planIssueRecovery({
    issueState: "open",
    projectStatus: "Review",
    pullRequests: [{
      number: 34,
      state: "open",
      url: "https://github.com/fantomx775/lamilia-lomi/pull/34",
      branch: "codex/issue-29-configurable-catalog-layout",
      draft: false,
    }],
    candidateBranches: ["codex/issue-29-configurable-catalog-layout"],
  });

  assert.equal(plan.action, "resume-open-pull-request");
  assert.equal(plan.pullRequest.number, 34);
  assert.equal(plan.pullRequest.branch, "codex/issue-29-configurable-catalog-layout");
  assert.equal(plan.statusToPreserve, "Review");
  assert.equal(plan.createBranch, false);
  assert.equal(plan.resetExistingWork, false);
  assert.match(
    statusTransitionBlockers("In Progress", { ready: true, reasons: [] }, [], plan).join(" "),
    /preserve Project Status "Review"/,
  );
});

test("resumes a matching branch without regressing Project progress", () => {
  const plan = planIssueRecovery({
    issueState: "open",
    projectStatus: "In Progress",
    candidateBranches: ["codex/issue-29-configurable-catalog-layout"],
  });

  assert.equal(plan.action, "resume-existing-branch");
  assert.equal(plan.branch, "codex/issue-29-configurable-catalog-layout");
  assert.equal(plan.createBranch, false);
  assert.equal(plan.resetExistingWork, false);
  assert.match(
    statusTransitionBlockers("Ready", { ready: true, reasons: [] }, [], plan).join(" "),
    /preserve Project Status "In Progress"/,
  );
  assert.deepEqual(statusTransitionBlockers("In Progress", { ready: true, reasons: [] }, [], plan), []);

  const readyPlan = planIssueRecovery({
    issueState: "open",
    projectStatus: "Ready",
    candidateBranches: ["codex/issue-29-configurable-catalog-layout"],
  });
  assert.deepEqual(statusTransitionBlockers("In Progress", { ready: true, reasons: [] }, [], readyPlan), []);
});

test("inspect surfaces Issue 29 PR, migration, independent-review, and CI state together", async () => {
  const issue = {
    number: 29,
    node_id: "I_repo_29",
    title: "Configurable catalog layout",
    state: "open",
    html_url: "https://github.com/fantomx775/lamilia-lomi/issues/29",
    body: "## Acceptance Criteria\n- [ ] Save the setting",
  };
  const pullRequest = {
    number: 34,
    title: "Configurable catalog layout",
    state: "open",
    html_url: "https://github.com/fantomx775/lamilia-lomi/pull/34",
    body: "Closes #29",
    draft: false,
    updated_at: "2026-10-08T18:19:49Z",
    user: { login: "author" },
    head: {
      ref: "codex/issue-29-configurable-catalog-layout",
      sha: "a".repeat(40),
    },
  };
  const client = {
    owner: "fantomx775",
    repo: "lamilia-lomi",
    projectOwner: "fantomx775",
    projectNumber: 1,
    request: async (path) => {
      if (path === "/repos/fantomx775/lamilia-lomi/issues/29") return issue;
      if (path.includes("/dependencies/")) return [];
      if (path.includes("/timeline?")) return [];
      if (path.includes("/pulls?state=open")) return [pullRequest];
      if (path.includes("/branches?")) return [{ name: pullRequest.head.ref }];
      if (path.includes("/comments?")) return [];
      if (path.endsWith("/pulls/34/reviews?per_page=100&page=1")) return [];
      if (path.endsWith("/pulls/34/files?per_page=100&page=1")) {
        return [{ filename: "supabase/migrations/20261008170639_configurable_catalog_layout.sql" }];
      }
      if (path.endsWith("/check-runs?per_page=100")) return { total_count: 0, check_runs: [] };
      if (path.endsWith("/status?per_page=100")) return { total_count: 0, statuses: [] };
      throw new Error("Unexpected mock request: " + path);
    },
    graphql: async () => ({
      user: {
        projectV2: {
          id: "project-1",
          title: "Development",
          url: "https://github.com/users/fantomx775/projects/1",
          fields: {
            nodes: [{
              __typename: "ProjectV2SingleSelectField",
              name: "Status",
              options: [{ name: "Review" }],
            }],
          },
          items: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{
              id: "item-29",
              isArchived: false,
              content: { id: issue.node_id },
              fieldValues: {
                nodes: [{ field: { name: "Status" }, name: "Review" }],
              },
            }],
          },
        },
      },
    }),
  };

  const discovery = await inspectIssue(client, 29);
  assert.equal(discovery.readiness.recommendedStatus, "Review");
  assert.equal(discovery.resume.recoveryPlan.action, "resume-open-pull-request");
  assert.equal(discovery.resume.recoveryPlan.pullRequest.number, 34);
  assert.equal(discovery.resume.recoveryPlan.createBranch, false);
  assert.equal(discovery.resume.pullRequestDetails[0].independentReview.status, "NOT RUN");
  assert.equal(discovery.resume.pullRequestDetails[0].verification.status, "NOT RUN");
  assert.deepEqual(
    discovery.resume.pullRequestDetails[0].releaseRequirements.migrationFiles,
    ["supabase/migrations/20261008170639_configurable_catalog_layout.sql"],
  );
});

test("blocks only new branch creation when recovery history is unavailable", () => {
  const plan = planIssueRecovery({
    issueState: "open",
    projectStatus: "Ready",
    pullRequestHistoryAvailable: false,
    branchHistoryAvailable: false,
  });
  assert.equal(plan.action, "blocked");
  assert.equal(plan.createBranch, false);
  assert.equal(plan.resetExistingWork, false);
  assert.deepEqual(
    statusTransitionBlockers("In Progress", { ready: true, reasons: [] }, [], plan),
    [plan.reason],
  );
});

test("requires an actual independent GitHub review for the exact current SHA", () => {
  const headSha = "a".repeat(40);
  const summary = [
    "Reviewer: @independent",
    "Reviewed SHA: " + headSha,
    "Critical: none",
    "High: none",
    "Medium: one finding, fixed below",
    "Low: none",
    "Fixes applied: normalized the migration order",
    "Unresolved findings: none",
  ].map((line) => "- " + line).join("\n");

  assert.equal(
    validateIndependentReview({
      pullRequestAuthor: "author",
      headSha,
      reviews: [],
    }).status,
    "NOT RUN",
  );
  assert.equal(
    validateIndependentReview({
      pullRequestAuthor: "author",
      headSha,
      reviews: [{
        user: { login: "author" },
        state: "COMMENTED",
        commit_id: headSha,
        body: summary.replace("@independent", "@author"),
      }],
    }).status,
    "FAIL",
  );
  assert.equal(
    validateIndependentReview({
      pullRequestAuthor: "author",
      headSha,
      reviews: [{
        user: { login: "independent" },
        state: "COMMENTED",
        commit_id: "b".repeat(40),
        body: summary,
      }],
    }).status,
    "FAIL",
  );
  const verified = validateIndependentReview({
    pullRequestAuthor: "author",
    headSha,
    reviews: [{
      user: { login: "independent" },
      state: "COMMENTED",
      commit_id: headSha,
      body: summary,
    }],
  });
  assert.equal(verified.status, "PASS");
  assert.equal(verified.reviewer, "independent");
  assert.equal(verified.reviewedSha, headSha);
  assert.deepEqual(verified.findingsBySeverity, {
    Critical: "none",
    High: "none",
    Medium: "one finding, fixed below",
    Low: "none",
  });
});

test("reports missing CI as NOT RUN and never as PASS", () => {
  const missing = summarizeGitHubChecks({ checkRuns: [], statuses: [] });
  assert.equal(missing.status, "NOT RUN");
  assert.match(missing.details, /not passing CI evidence/);

  assert.equal(
    summarizeGitHubChecks({
      checkRuns: [{ name: "test", status: "completed", conclusion: "success" }],
    }).status,
    "PASS",
  );
  assert.equal(
    summarizeGitHubChecks({
      checkRuns: [{ name: "test", status: "completed", conclusion: "failure" }],
    }).status,
    "FAIL",
  );
  assert.equal(
    summarizeGitHubChecks({
      statuses: [{ context: "build", state: "pending" }],
    }).status,
    "BLOCKED",
  );
  assert.equal(summarizeGitHubChecks({ available: false }).status, "BLOCKED");
  assert.throws(
    () => verificationEvidence({ status: "SKIPPED", command: "npm test", details: "not run" }),
    /Invalid verification status/,
  );
});
