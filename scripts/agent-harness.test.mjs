import { test } from "vitest";
import assert from "node:assert/strict";
import {
  buildReleaseRequirements,
  buildReadiness,
  assessPullRequestVerification,
  closesIssueReference,
  deliverPullRequest,
  findClosingIssueReferences,
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
  summarizeRequiredGitHubChecks,
  runProductionSmoke,
  statusTransitionBlockers,
  validateAiReview,
  validateBrowserVerification,
  validateGitHubReview,
  validateIndependentReview,
  validateLocalVerification,
  validateReleaseEvidence,
  validateProductionSmokePlan,
  validatePostDeploymentMigrationEvidence,
  waitForProductionDeployment,
  verifyPullRequest,
  verificationEvidence,
} from "./agent-harness.mjs";

const CURRENT_SHA = "a".repeat(40);
const CURRENT_BASE_SHA = "b".repeat(40);
const AI_REVIEW_MARKER = "<!-- agent-harness-ai-review:v1 -->";
const ISSUE_DELIVERY_MARKER = "<!-- agent-harness-issue-delivery:v1 -->";
const VERIFICATION_MARKER = "<!-- agent-harness-verification:v1 -->";

function structuredComment(marker, record, user = "author", createdAt = "2026-10-08T12:00:00Z") {
  return {
    user: { login: user },
    created_at: createdAt,
    body: marker + "\n```json\n" + JSON.stringify(record) + "\n```",
  };
}

function cleanAiReviewRecord(headSha = CURRENT_SHA, reviewerAgent = "reviewer-A", baseSha = CURRENT_BASE_SHA) {
  const noFindings = { Critical: [], High: [], Medium: [], Low: [] };
  return {
    schemaVersion: 1,
    reviewType: "ai-subagent",
    reviewerAgent,
    independentlyTasked: true,
    taskGoalProvided: true,
    actualDiffRead: true,
    reviewedBaseSha: baseSha,
    reviewedSha: headSha,
    reviewScope: ["correctness", "regressions", "testing", "scope"],
    findings: structuredClone(noFindings),
    unresolvedFindings: structuredClone(noFindings),
    fixesApplied: [],
  };
}

function cleanAiReviewComments(headSha = CURRENT_SHA) {
  return ["reviewer-A", "reviewer-B"].map((reviewerAgent, index) =>
    structuredComment(
      AI_REVIEW_MARKER,
      cleanAiReviewRecord(headSha, reviewerAgent),
      "author",
      "2026-10-08T12:0" + index + ":00Z",
    ),
  );
}

function cleanVerificationRecord({ headSha = CURRENT_SHA, uiBehavior = false, browser, release, productionSmokePlan } = {}) {
  return {
    schemaVersion: 1,
    headSha,
    uiBehavior,
    checks: ["diff", "lint", "tests"].map((kind) => ({
      kind,
      status: "PASS",
      command: kind === "diff" ? "git diff --check" : "npm run " + kind,
      result: "passed",
    })),
    ...(browser ? { browser } : {}),
    ...(release ? { release } : {}),
    ...(productionSmokePlan ? { productionSmokePlan } : {}),
  };
}

function cleanGitHubReview({ headSha = CURRENT_SHA, user = "reviewer", state = "COMMENTED", unresolved = "none" } = {}) {
  return {
    user: { login: user },
    state,
    commit_id: headSha,
    submitted_at: "2026-10-08T12:00:00Z",
    body: [
      "Reviewer: @" + user,
      "Reviewed SHA: " + headSha,
      "Critical: none",
      "High: none",
      "Medium: none",
      "Low: none",
      "Fixes applied: none",
      "Unresolved findings: " + unresolved,
    ].join("\n"),
  };
}

function cleanPullRequest(overrides = {}) {
  return {
    number: 52,
    title: "Harness quality gate",
    state: "open",
    merged: false,
    merged_at: null,
    mergeable: true,
    mergeable_state: "clean",
    html_url: "https://github.com/example/repo/pull/52",
    draft: false,
    body: "Part of #7",
    user: { login: "author" },
    base: { ref: "main", sha: CURRENT_BASE_SHA },
    head: { ref: "codex/harness", sha: CURRENT_SHA },
    ...overrides,
  };
}

function pullRequestCommitPage(messages, after) {
  const start = after ? Number(after) : 0;
  const end = Math.min(start + 100, messages.length);
  return {
    repository: {
      pullRequest: {
        commits: {
          nodes: messages.slice(start, end).map((message, index) => ({
            commit: {
              oid: String(start + index + 1).padStart(40, "0"),
              message,
            },
          })),
          pageInfo: {
            hasNextPage: end < messages.length,
            endCursor: end < messages.length ? String(end) : null,
          },
        },
      },
    },
  };
}

function cleanMergePolicy(overrides = {}) {
  return {
    available: true,
    requiredChecks: [],
    requiredApprovals: 0,
    strictRequiredChecks: false,
    dismissStaleReviews: false,
    requireLastPushApproval: false,
    unassessedRules: [],
    sources: ["no classic branch protection", "effective branch rules"],
    ...overrides,
  };
}

function createDeliveryClient({
  alreadyMerged = false,
  initialIssueState = "open",
  pullRequestBody = "Part of #7",
  bodyAfterMerge = null,
  pullRequestCommitMessages = ["Update the agent harness"],
  closedByPullRequest = alreadyMerged,
  closedByCommitInPullRequest = false,
  laterIndependentClosure = false,
  issueCommentsReadError = false,
  issueCommentActor = "author",
  projectUpdateDelayReads = 0,
  previouslyVerifiedDelivery = false,
  previouslyVerifiedDeliveryAuthor = "author",
  baseShaOnPreMerge = null,
  mergeParentSha = CURRENT_BASE_SHA,
} = {}) {
  const mergeSha = "c".repeat(40);
  const issueId = "I_issue-7";
  const calls = [];
  let merged = alreadyMerged;
  let pullRequestReads = 0;
  let mergedBody = pullRequestBody;
  let issueState = initialIssueState;
  let projectStatus = initialIssueState === "closed" ? "Done" : "Review";
  let delayedProjectStatus = null;
  let remainingDelayedReads = 0;
  let projectStatusDelayedOnce = false;
  const issueComments = previouslyVerifiedDelivery
    ? [structuredComment(ISSUE_DELIVERY_MARKER, {
        schemaVersion: 1,
        status: "PASS",
        issueNumber: 7,
        pullRequestNumber: 52,
        candidateSha: CURRENT_SHA,
        mergeSha,
        productionDeployment: { status: "PASS", deployment: { sha: mergeSha } },
        productionSmoke: { status: "PASS" },
        postDeploymentMigration: { status: "PASS" },
      }, previouslyVerifiedDeliveryAuthor)]
    : [];
  const client = {
    owner: "example",
    repo: "repo",
    projectOwner: "owner",
    projectNumber: 1,
    calls,
    request: async (path, options = {}) => {
      const method = options.method || "GET";
      calls.push({ path, method, body: options.body || null });
      if (path === "/repos/example/repo/pulls/52") {
        pullRequestReads += 1;
        const baseSha = baseShaOnPreMerge && !merged && pullRequestReads >= 3
          ? baseShaOnPreMerge
          : CURRENT_BASE_SHA;
        return merged
          ? cleanPullRequest({
              state: "closed",
              merged: true,
              merge_commit_sha: mergeSha,
              merged_at: "2026-10-08T12:00:00Z",
              body: mergedBody,
            })
          : cleanPullRequest({ body: pullRequestBody, base: { ref: "main", sha: baseSha } });
      }
      if (path === "/repos/example/repo/pulls/52/merge" && method === "PUT") {
        const body = JSON.parse(options.body);
        assert.equal(body.sha, CURRENT_SHA);
        assert.equal(body.merge_method, "merge");
        merged = true;
        if (bodyAfterMerge !== null) {
          mergedBody = bodyAfterMerge;
          if (findClosingIssueReferences(bodyAfterMerge, "example/repo").includes(7)) {
            issueState = "closed";
            projectStatus = "Done";
            closedByPullRequest = true;
          }
        }
        return { merged: true, sha: mergeSha, message: "Pull Request successfully merged" };
      }
      if (path === "/repos/example/repo/commits/" + mergeSha) {
        return { sha: mergeSha, parents: [{ sha: mergeParentSha }, { sha: CURRENT_SHA }] };
      }
      if (path === "/repos/example/repo/issues/7" && method === "PATCH") {
        const body = JSON.parse(options.body);
        issueState = body.state;
        if (body.state === "closed") projectStatus = "Done";
        return { number: 7, node_id: issueId, state: issueState };
      }
      if (path === "/repos/example/repo/issues/7") {
        return { number: 7, node_id: issueId, state: issueState, title: "Delivery issue" };
      }
      if (path.startsWith("/repos/example/repo/issues/7/comments") && method === "POST") {
        const body = JSON.parse(options.body).body;
        issueComments.push({ user: { login: issueCommentActor }, created_at: "2026-10-08T12:00:03Z", body });
        return { id: calls.length, html_url: "https://github.com/example/repo/issues/7#issuecomment-" + calls.length };
      }
      if (path.startsWith("/repos/example/repo/issues/7/comments")) {
        if (issueCommentsReadError) throw new Error("GitHub issue comments unavailable");
        return issueComments;
      }
      if (method === "POST" && (
        path.startsWith("/repos/example/repo/issues/52/comments") ||
        path.startsWith("/repos/example/repo/issues/7/comments")
      )) {
        return { id: calls.length, html_url: "https://github.com/example/repo/issues/52#issuecomment-" + calls.length };
      }
      if (path.startsWith("/repos/example/repo/pulls/52/files")) return [];
      if (path.startsWith("/repos/example/repo/pulls/52/commits")) {
        return pullRequestCommitMessages.map((message, index) => ({
          sha: String(index + 1).padStart(40, "0"),
          commit: { message },
        }));
      }
      if (path.startsWith("/repos/example/repo/issues/52/comments")) return [];
      throw new Error("Unexpected delivery API request: " + method + " " + path);
    },
    graphql: async (query, variables = {}) => {
      calls.push({ path: "graphql", method: "POST", body: query });
      if (query.includes("timelineItems")) {
        const timelineItems = [];
        if (closedByPullRequest) {
          timelineItems.push({
            createdAt: "2026-10-08T12:00:02Z",
            closer: { __typename: "PullRequest", number: 52, mergeCommit: { oid: mergeSha } },
          });
        }
        if (closedByCommitInPullRequest) {
          timelineItems.push({
            createdAt: "2026-10-08T12:00:02Z",
            closer: { __typename: "Commit", oid: "0".repeat(39) + "1" },
          });
        }
        if (laterIndependentClosure) {
          timelineItems.push({
            createdAt: "2026-10-08T12:03:00Z",
            closer: { __typename: "Commit", oid: "d".repeat(40) },
          });
        }
        return {
          repository: {
            issue: {
              closedAt: laterIndependentClosure ? "2026-10-08T12:03:00Z" :
                closedByPullRequest || closedByCommitInPullRequest ? "2026-10-08T12:00:03Z" : null,
              timelineItems: {
                nodes: timelineItems,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        };
      }
      if (query.includes("UpdateProjectV2ItemFieldValueInput")) {
        const optionId = variables.input?.value?.singleSelectOptionId || "";
        const nextStatus = optionId.replace(/^status-/, "");
        delayedProjectStatus = null;
        remainingDelayedReads = 0;
        if (nextStatus === "Done" && projectUpdateDelayReads > 0 && !projectStatusDelayedOnce) {
          delayedProjectStatus = "Done";
          remainingDelayedReads = projectUpdateDelayReads;
          projectStatusDelayedOnce = true;
        } else {
          projectStatus = nextStatus;
        }
        return { updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-7" } } };
      }
      const statusForRead = projectStatus;
      if (delayedProjectStatus && remainingDelayedReads > 0) {
        remainingDelayedReads -= 1;
      } else if (delayedProjectStatus) {
        projectStatus = delayedProjectStatus;
        delayedProjectStatus = null;
      }
      return {
        user: {
          projectV2: {
            id: "project-1",
            title: "Project",
            url: "https://github.com/users/owner/projects/1",
            fields: {
              nodes: [{
                id: "status-field",
                name: "Status",
                options: ["Backlog", "Review", "Blocked", "Done"].map((name) => ({ id: "status-" + name, name })),
              }],
            },
            items: {
              nodes: [{
                id: "item-7",
                isArchived: false,
                content: { __typename: "Issue", id: issueId },
                fieldValues: {
                  nodes: [{ name: statusForRead, field: { name: "Status" } }],
                },
              }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      };
    },
  };
  return { client, calls, mergeSha, get issueState() { return issueState; }, get projectStatus() { return projectStatus; } };
}

function createMultiIssueMergedDeliveryClient({
  pullRequestBody = "Closes #7 and resolves #8",
  pullRequestCommitMessages = ["Update the delivery workflow"],
} = {}) {
  const mergeSha = "c".repeat(40);
  const calls = [];
  const issueStates = new Map([[7, "closed"], [8, "closed"]]);
  const projectStatuses = new Map([[7, "Done"], [8, "Done"]]);
  const issueComments = new Map([[7, []], [8, []]]);
  const issueNodeId = (number) => "I_issue-" + number;
  const projectItemId = (number) => "item-" + number;
  const client = {
    owner: "example",
    repo: "repo",
    projectOwner: "owner",
    projectNumber: 1,
    calls,
    request: async (path, options = {}) => {
      const method = options.method || "GET";
      calls.push({ path, method, body: options.body || null });
      if (path === "/repos/example/repo/pulls/52") {
        return cleanPullRequest({
          state: "closed",
          merged: true,
          merge_commit_sha: mergeSha,
          merged_at: "2026-10-08T12:00:00Z",
          body: pullRequestBody,
        });
      }
      if (path.startsWith("/repos/example/repo/pulls/52/commits")) {
        return pullRequestCommitMessages.map((message, index) => ({
          sha: String(index + 1).padStart(40, "0"),
          commit: { message },
        }));
      }
      if (path.startsWith("/repos/example/repo/pulls/52/files")) return [];
      if (path.startsWith("/repos/example/repo/issues/52/comments") && method === "POST") {
        return { id: calls.length, html_url: "https://github.com/example/repo/pull/52#issuecomment-" + calls.length };
      }
      if (path.startsWith("/repos/example/repo/issues/52/comments")) return [];
      const issueMatch = path.match(/^\/repos\/example\/repo\/issues\/(\d+)(?:\/(comments))?/);
      if (issueMatch) {
        const issueNumber = Number(issueMatch[1]);
        if (issueNumber !== 7 && issueNumber !== 8) throw new Error("Unexpected issue " + issueNumber);
        if (issueMatch[2] === "comments") {
          if (method === "POST") {
            const body = JSON.parse(options.body).body;
            issueComments.get(issueNumber).push({
              user: { login: "author" },
              created_at: "2026-10-08T12:00:03Z",
              body,
            });
            return { id: calls.length, html_url: "https://github.com/example/repo/issues/" + issueNumber + "#issuecomment-" + calls.length };
          }
          return issueComments.get(issueNumber);
        }
        if (method === "PATCH") {
          const body = JSON.parse(options.body);
          issueStates.set(issueNumber, body.state);
          return { number: issueNumber, node_id: issueNodeId(issueNumber), state: body.state };
        }
        return {
          number: issueNumber,
          node_id: issueNodeId(issueNumber),
          state: issueStates.get(issueNumber),
          title: "Delivery issue " + issueNumber,
        };
      }
      throw new Error("Unexpected delivery API request: " + method + " " + path);
    },
    graphql: async (query, variables = {}) => {
      calls.push({ path: "graphql", method: "POST", body: query });
      if (query.includes("timelineItems")) {
        return {
          repository: {
            issue: {
              closedAt: "2026-10-08T12:00:03Z",
              timelineItems: {
                nodes: [{
                  createdAt: "2026-10-08T12:00:02Z",
                  closer: { __typename: "PullRequest", number: 52, mergeCommit: { oid: mergeSha } },
                }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        };
      }
      if (query.includes("UpdateProjectV2ItemFieldValueInput")) {
        const issueNumber = variables.input.itemId === projectItemId(7) ? 7 : 8;
        const optionId = variables.input.value.singleSelectOptionId;
        projectStatuses.set(issueNumber, optionId.replace(/^status-/, ""));
        return { updateProjectV2ItemFieldValue: { projectV2Item: { id: projectItemId(issueNumber) } } };
      }
      return {
        user: {
          projectV2: {
            id: "project-1",
            title: "Project",
            url: "https://github.com/users/owner/projects/1",
            fields: {
              nodes: [{
                id: "status-field",
                name: "Status",
                options: ["Backlog", "Review", "Blocked", "Done"].map((name) => ({ id: "status-" + name, name })),
              }],
            },
            items: {
              nodes: [7, 8].map((issueNumber) => ({
                id: projectItemId(issueNumber),
                isArchived: false,
                content: { __typename: "Issue", id: issueNodeId(issueNumber) },
                fieldValues: {
                  nodes: [{ name: projectStatuses.get(issueNumber), field: { name: "Status" } }],
                },
              })),
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      };
    },
  };
  return {
    client,
    calls,
    mergeSha,
    issueStates,
    projectStatuses,
  };
}

test("reads GitHub HTTPS and SSH repository remotes", () => {
  assert.deepEqual(repositoryFromRemote("https://github.com/fantomx775/lamilia-lomi.git"), {
    owner: "fantomx775",
    repo: "lamilia-lomi",
  });
  assert.deepEqual(repositoryFromRemote("git@github.com:fantomx775/lamilia-lomi.git"), {
    owner: "fantomx775",
    repo: "lamilia-lomi",
  });
  assert.deepEqual(repositoryFromRemote("ssh://git@github.com/fantomx775/lamilia-lomi.git"), {
    owner: "fantomx775",
    repo: "lamilia-lomi",
  });
  assert.throws(
    () => repositoryFromRemote("https://evil.example/github.com/attacker/victim.git"),
    /Could not parse a GitHub owner\/repository/,
  );
  assert.throws(
    () => repositoryFromRemote("git@evil.example:attacker/victim.git"),
    /Could not parse a GitHub owner\/repository/,
  );
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
  assert.equal(referencesIssue("Closes: #29", 29, "example/repo"), true);
  assert.equal(referencesIssue("RESOLVES: example/repo#29", 29, "example/repo"), true);
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

test("detects only GitHub closing keywords that target the exact issue", () => {
  assert.equal(closesIssueReference("Closes #29", 29, "example/repo"), true);
  assert.equal(closesIssueReference("Fixes example/repo#29", 29, "example/repo"), true);
  assert.equal(closesIssueReference("Resolves https://github.com/example/repo/issues/29", 29, "example/repo"), true);
  assert.equal(closesIssueReference("Part of #29", 29, "example/repo"), false);
  assert.equal(closesIssueReference("Closes #290", 29, "example/repo"), false);
  assert.equal(closesIssueReference("Closes other/repo#29", 29, "example/repo"), false);
});

test("enumerates every local issue a delivery PR would auto-close", () => {
  assert.deepEqual(findClosingIssueReferences(
    "Closes #29 and resolves example/repo#31; fixes https://github.com/example/repo/issues/32",
    "example/repo",
  ), [29, 31, 32]);
  assert.deepEqual(findClosingIssueReferences("Fixes other/repo#29", "example/repo"), []);
  assert.deepEqual(findClosingIssueReferences("Part of #29", "example/repo"), []);
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

test("preserves Project progress while an ambiguous PR or branch match is resolved", () => {
  const pullRequestPlan = planIssueRecovery({
    issueState: "open",
    projectStatus: "Review",
    pullRequests: [
      { number: 34, state: "open", url: "https://github.com/example/repo/pull/34" },
      { number: 35, state: "open", url: "https://github.com/example/repo/pull/35" },
    ],
  });
  assert.equal(pullRequestPlan.action, "resolve-existing-pull-requests");
  assert.match(
    statusTransitionBlockers("Ready", { ready: true, reasons: [] }, [], pullRequestPlan).join(" "),
    /multiple open PRs.*preserve Project Status "Review"/,
  );

  const branchPlan = planIssueRecovery({
    issueState: "open",
    projectStatus: "In Progress",
    candidateBranches: ["codex/issue-29-layout", "codex/catalog-layout"],
  });
  assert.equal(branchPlan.action, "resolve-existing-branches");
  assert.match(
    statusTransitionBlockers("Ready", { ready: true, reasons: [] }, [], branchPlan).join(" "),
    /multiple matching branches.*preserve Project Status "In Progress"/,
  );
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
  assert.equal(discovery.resume.pullRequestDetails[0].githubReview.status, "NOT RUN");
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

test("separates formal GitHub review identity from AI evidence and validates current-SHA findings", () => {
  const headSha = CURRENT_SHA;
  assert.equal(validateGitHubReview({
    pullRequestAuthor: "author",
    headSha,
    reviews: [],
  }).status, "NOT RUN");

  const authorReview = cleanGitHubReview({ headSha, user: "author" });
  assert.equal(validateGitHubReview({
    pullRequestAuthor: "author",
    headSha,
    reviews: [authorReview],
  }).status, "NOT RUN");

  const stale = cleanGitHubReview({ headSha: "b".repeat(40) });
  assert.equal(validateGitHubReview({
    pullRequestAuthor: "author",
    headSha,
    reviews: [stale],
  }).status, "BLOCKED");

  const verified = validateIndependentReview({
    pullRequestAuthor: "author",
    headSha,
    reviews: [cleanGitHubReview({ headSha, user: "independent" })],
  });
  assert.equal(verified.status, "PASS");
  assert.equal(verified.reviewer, "independent");
  assert.equal(verified.reviewedSha, headSha);
  assert.deepEqual(verified.findingsBySeverity, {
    Critical: "none",
    High: "none",
    Medium: "none",
    Low: "none",
  });

  for (const severity of ["High", "Critical"]) {
    const review = cleanGitHubReview({
      headSha,
      user: "independent",
      unresolved: severity + " finding remains",
    });
    assert.equal(validateGitHubReview({
      pullRequestAuthor: "author",
      headSha,
      reviews: [review],
    }).status, "FAIL");
  }
  assert.equal(validateGitHubReview({
    pullRequestAuthor: "author",
    headSha,
    reviews: [cleanGitHubReview({ headSha, user: "independent", state: "CHANGES_REQUESTED" })],
  }).status, "PASS");

  const outstandingRequest = cleanGitHubReview({
    headSha,
    user: "reviewer-a",
    state: "CHANGES_REQUESTED",
  });
  outstandingRequest.submitted_at = "2026-10-08T12:00:00Z";
  const laterReviewer = cleanGitHubReview({ headSha, user: "reviewer-b" });
  laterReviewer.submitted_at = "2026-10-08T13:00:00Z";
  const aggregateRequest = validateGitHubReview({
    pullRequestAuthor: "author",
    headSha,
    reviews: [outstandingRequest, laterReviewer],
  });
  assert.equal(aggregateRequest.status, "PASS");
  assert.equal(aggregateRequest.requestedChanges, true);
  assert.ok(aggregateRequest.reviewers.some(({ reviewer, requestedChanges }) =>
    reviewer === "reviewer-a" && requestedChanges,
  ));

  const outstandingHigh = cleanGitHubReview({
    headSha,
    user: "reviewer-a",
    unresolved: "High finding remains",
  });
  outstandingHigh.submitted_at = "2026-10-08T12:00:00Z";
  const laterCleanReview = cleanGitHubReview({ headSha, user: "reviewer-b" });
  laterCleanReview.submitted_at = "2026-10-08T13:00:00Z";
  const aggregateFinding = validateGitHubReview({
    pullRequestAuthor: "author",
    headSha,
    reviews: [outstandingHigh, laterCleanReview],
  });
  assert.equal(aggregateFinding.status, "FAIL");
  assert.ok(aggregateFinding.unresolvedSeverity.includes("High"));

  const sameReviewerResolved = validateGitHubReview({
    pullRequestAuthor: "author",
    headSha,
    reviews: [
      outstandingRequest,
      cleanGitHubReview({ headSha, user: "reviewer-a", state: "APPROVED" }),
      laterCleanReview,
    ],
  });
  assert.equal(sameReviewerResolved.status, "PASS");
  assert.equal(sameReviewerResolved.requestedChanges, true);

  const dismissedRequest = { ...outstandingRequest, state: "DISMISSED" };
  const dismissedAndResolved = validateGitHubReview({
    pullRequestAuthor: "author",
    headSha,
    reviews: [
      dismissedRequest,
      cleanGitHubReview({ headSha, user: "reviewer-a", state: "APPROVED" }),
      laterCleanReview,
    ],
  });
  assert.equal(dismissedAndResolved.status, "PASS");
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

test("requires two distinct independently tasked AI reviews and allows them to share the author's GitHub identity", () => {
  const record = cleanAiReviewRecord();
  const comment = structuredComment(AI_REVIEW_MARKER, record, "author");
  const ai = validateAiReview({ headSha: CURRENT_SHA, comments: [comment] });

  assert.equal(ai.status, "BLOCKED");
  assert.equal(ai.requiredReviewCount, 2);
  assert.equal(ai.independentReviewCount, 1);
  assert.equal(ai.reviewers[0].reviewerAgent, "reviewer-A");
  assert.equal(ai.reviewers[0].recordedBy, "author");
  assert.equal(validateGitHubReview({
    pullRequestAuthor: "author",
    headSha: CURRENT_SHA,
    reviews: [],
  }).status, "NOT RUN");

  const twoReviews = validateAiReview({
    headSha: CURRENT_SHA,
    expectedAuthor: "author",
    comments: cleanAiReviewComments(),
  });
  assert.equal(twoReviews.status, "PASS");
  assert.equal(twoReviews.independentReviewCount, 2);
  assert.deepEqual(twoReviews.reviewers.map(({ recordedBy }) => recordedBy), ["author", "author"]);

  assert.equal(validateAiReview({
    headSha: CURRENT_SHA,
    baseSha: CURRENT_BASE_SHA,
    expectedAuthor: "author",
    comments: ["reviewer-A", "reviewer-B"].map((reviewerAgent) =>
      structuredComment(AI_REVIEW_MARKER, cleanAiReviewRecord(CURRENT_SHA, reviewerAgent, "c".repeat(40))),
    ),
  }).status, "BLOCKED");

  assert.equal(validateAiReview({
    headSha: CURRENT_SHA,
    expectedAuthor: "author",
    comments: [
      structuredComment(AI_REVIEW_MARKER, cleanAiReviewRecord(CURRENT_SHA, "reviewer-A"), "other-writer"),
      structuredComment(AI_REVIEW_MARKER, cleanAiReviewRecord(CURRENT_SHA, "reviewer-B"), "other-writer"),
    ],
  }).status, "BLOCKED");

  assert.equal(validateAiReview({
    headSha: CURRENT_SHA,
    comments: [
      structuredComment(AI_REVIEW_MARKER, cleanAiReviewRecord(CURRENT_SHA, "reviewer-A"), "author"),
      structuredComment(AI_REVIEW_MARKER, cleanAiReviewRecord(CURRENT_SHA, "REVIEWER-a"), "author"),
    ],
  }).status, "FAIL");

  const stale = structuredComment(AI_REVIEW_MARKER, cleanAiReviewRecord("b".repeat(40)));
  assert.equal(validateAiReview({ headSha: CURRENT_SHA, comments: [stale] }).status, "BLOCKED");

  const unresolved = cleanAiReviewRecord();
  unresolved.findings.High.push({ summary: "High-risk regression", requiredFix: "Correct the state check." });
  unresolved.unresolvedFindings.High.push({ summary: "High-risk regression", requiredFix: "Correct the state check." });
  assert.equal(validateAiReview({
    headSha: CURRENT_SHA,
    comments: [
      structuredComment(AI_REVIEW_MARKER, unresolved),
      ...cleanAiReviewComments().slice(1),
    ],
  }).status, "FAIL");

  for (const severity of ["Critical", "High"]) {
    const finding = cleanAiReviewRecord(CURRENT_SHA, "reviewer-A");
    finding.findings[severity].push({ summary: severity + " issue", requiredFix: "Fix it." });
    finding.unresolvedFindings[severity].push({ summary: severity + " issue", requiredFix: "Fix it." });
    assert.equal(validateAiReview({
      headSha: CURRENT_SHA,
      comments: [
        structuredComment(AI_REVIEW_MARKER, finding),
        structuredComment(AI_REVIEW_MARKER, cleanAiReviewRecord(CURRENT_SHA, "reviewer-B")),
      ],
    }).status, "FAIL");
  }

  const malformed = structuredComment(AI_REVIEW_MARKER, null);
  assert.doesNotThrow(() => validateAiReview({ headSha: CURRENT_SHA, comments: [malformed] }));
  assert.equal(validateAiReview({ headSha: CURRENT_SHA, comments: [malformed] }).status, "FAIL");
});

test("requires current-SHA structured local evidence and distinguishes missing, stale, and malformed records", () => {
  assert.equal(validateLocalVerification({ headSha: CURRENT_SHA, comments: [] }).status, "NOT RUN");

  const current = structuredComment(
    VERIFICATION_MARKER,
    cleanVerificationRecord(),
  );
  assert.equal(validateLocalVerification({
    headSha: CURRENT_SHA,
    expectedAuthor: "author",
    comments: [current],
  }).status, "PASS");
  assert.equal(validateLocalVerification({
    headSha: CURRENT_SHA,
    expectedAuthor: "author",
    comments: [structuredComment(VERIFICATION_MARKER, cleanVerificationRecord(), "other-writer")],
  }).status, "BLOCKED");

  const stale = structuredComment(
    VERIFICATION_MARKER,
    cleanVerificationRecord({ headSha: "b".repeat(40) }),
  );
  assert.equal(validateLocalVerification({ headSha: CURRENT_SHA, comments: [stale] }).status, "BLOCKED");

  const malformed = { body: VERIFICATION_MARKER + "\n```json\nnot json\n```" };
  assert.equal(validateLocalVerification({ headSha: CURRENT_SHA, comments: [malformed] }).status, "FAIL");
});

test("requires committed browser evidence for UI changes and keeps non-UI changes browser-optional", () => {
  const screenshot = "docs/verification/issue-29/catalog-mobile.png";
  const browser = {
    status: "PASS",
    tool: "Playwright",
    testedSha: CURRENT_SHA,
    runId: "pr-52-catalog-run-1",
    flows: ["open catalog and save layout"],
    screenshots: [{ path: screenshot, testedSha: CURRENT_SHA, runId: "pr-52-catalog-run-1" }],
    responsiveLayouts: ["desktop 1440px", "mobile 390px"],
    persistence: { status: "PASS", details: "Selection remains after reload." },
    screenshotReview: { status: "PASS", details: "Screenshot matches the updated layout." },
    retestedAfterFixes: true,
    consoleErrors: [],
    failedNetworkRequests: [],
  };
  const uiFiles = ["src/app/catalog/page.tsx", screenshot];
  const noBrowser = validateBrowserVerification({
    uiRequired: true,
    localVerification: { record: cleanVerificationRecord({ uiBehavior: true }) },
    files: uiFiles,
  });
  assert.equal(noBrowser.status, "NOT RUN");
  assert.equal(noBrowser.required, true);

  const verified = validateBrowserVerification({
    uiRequired: true,
    localVerification: { reviewedSha: CURRENT_SHA, record: cleanVerificationRecord({ uiBehavior: true, browser }) },
    files: uiFiles,
  });
  assert.equal(verified.status, "PASS");
  assert.deepEqual(verified.screenshots, [screenshot]);

  const staleScreenshot = structuredClone(browser);
  staleScreenshot.screenshots[0].testedSha = "b".repeat(40);
  assert.equal(validateBrowserVerification({
    uiRequired: true,
    localVerification: { reviewedSha: CURRENT_SHA, record: cleanVerificationRecord({ uiBehavior: true, browser: staleScreenshot }) },
    files: uiFiles,
  }).status, "BLOCKED");

  const differentRunScreenshot = structuredClone(browser);
  differentRunScreenshot.screenshots[0].runId = "older-run";
  assert.equal(validateBrowserVerification({
    uiRequired: true,
    localVerification: { reviewedSha: CURRENT_SHA, record: cleanVerificationRecord({ uiBehavior: true, browser: differentRunScreenshot }) },
    files: uiFiles,
  }).status, "BLOCKED");

  assert.equal(validateBrowserVerification({
    uiRequired: true,
    localVerification: { reviewedSha: CURRENT_SHA, record: cleanVerificationRecord({ uiBehavior: true, browser }) },
    files: [{ filename: screenshot, status: "removed" }],
  }).status, "BLOCKED");

  const missingScreenshot = validateBrowserVerification({
    uiRequired: true,
    localVerification: { reviewedSha: CURRENT_SHA, record: cleanVerificationRecord({ uiBehavior: true, browser }) },
    files: ["src/app/catalog/page.tsx"],
  });
  assert.equal(missingScreenshot.status, "BLOCKED");

  const consoleFailure = structuredClone(browser);
  consoleFailure.consoleErrors = [{ message: "uncaught error" }];
  assert.equal(validateBrowserVerification({
    uiRequired: true,
    localVerification: { reviewedSha: CURRENT_SHA, record: cleanVerificationRecord({ uiBehavior: true, browser: consoleFailure }) },
    files: uiFiles,
  }).status, "FAIL");

  const browserFailure = structuredClone(browser);
  browserFailure.status = "FAIL";
  assert.equal(validateBrowserVerification({
    uiRequired: true,
    localVerification: { reviewedSha: CURRENT_SHA, record: cleanVerificationRecord({ uiBehavior: true, browser: browserFailure }) },
    files: uiFiles,
  }).status, "FAIL");

  const notRun = structuredClone(browser);
  notRun.status = "NOT RUN";
  assert.equal(validateBrowserVerification({
    uiRequired: true,
    localVerification: { reviewedSha: CURRENT_SHA, record: cleanVerificationRecord({ uiBehavior: true, browser: notRun }) },
    files: uiFiles,
  }).status, "NOT RUN");

  const nonUi = validateBrowserVerification({
    uiRequired: false,
    localVerification: { record: cleanVerificationRecord() },
    files: ["scripts/agent-harness.mjs"],
  });
  assert.equal(nonUi.status, "NOT RUN");
  assert.equal(nonUi.required, false);
});

test("keeps migration and dependency release obligations blocking until each is explicit", () => {
  const files = [
    "supabase/migrations/20261008170639_catalog.sql",
    "package.json",
    "package-lock.json",
  ];
  const missing = validateReleaseEvidence({ files, localVerification: { record: null } });
  assert.equal(missing.status, "BLOCKED");
  const missingMigrationGate = assessPullRequestVerification({
    pullRequest: cleanPullRequest(),
    files: [files[0]],
    comments: [
      structuredComment(VERIFICATION_MARKER, cleanVerificationRecord()),
      ...cleanAiReviewComments(),
    ],
    mergePolicy: cleanMergePolicy(),
  });
  assert.equal(missingMigrationGate.releaseRequirements.status, "BLOCKED");
  assert.equal(missingMigrationGate.decision, "BLOCKED");

  const release = {
    migrationCompatibility: {
      status: "PASS",
      command: "review migration compatibility",
      details: "Additive migration is backward compatible.",
      strategy: "compatible",
      migrationIds: ["20261008170639_catalog"],
    },
    stageMigration: {
      status: "PASS",
      required: true,
      environment: "Stage",
      migrationIds: ["20261008170639_catalog"],
      command: "supabase db push --dry-run --linked; apply to local Stage database",
      details: "Migration applied and verified against Stage; affected query passed.",
    },
    preMergeMigration: {
      status: "PASS",
      required: false,
      command: "assess pre-merge migration order",
      details: "The existing application does not need the new column before deployment.",
    },
    dependencyAudit: {
      status: "PASS",
      command: "npm audit --omit=dev",
      details: "No production vulnerabilities; lockfile aligned.",
    },
  };
  const passed = validateReleaseEvidence({
    files,
    localVerification: { record: { release } },
  });
  assert.equal(passed.status, "PASS");
  assert.match(passed.preMergeMigration.details, /Explicitly not required/);

  const pendingRequired = validateReleaseEvidence({
    files,
    localVerification: { record: { release: {
      ...release,
      preMergeMigration: { ...release.preMergeMigration, required: true, status: "NOT RUN" },
    } } },
  });
  assert.equal(pendingRequired.status, "BLOCKED");

  const appliedBeforeMerge = validateReleaseEvidence({
    files,
    localVerification: { record: { release: {
      ...release,
      preMergeMigration: {
        ...release.preMergeMigration,
        required: true,
        status: "PASS",
        environment: "Production",
        migrationIds: ["20261008170639_catalog"],
      },
    } } },
  });
  assert.equal(appliedBeforeMerge.status, "PASS");

  const missingStage = validateReleaseEvidence({
    files,
    localVerification: { record: { release: { ...release, stageMigration: undefined } } },
  });
  assert.equal(missingStage.status, "BLOCKED");
  assert.equal(missingStage.stageMigration.status, "BLOCKED");

  const breakingFiles = [
    "supabase/migrations/20261008170639_catalog_expand.sql",
    "supabase/migrations/20261009120000_catalog_contract.sql",
  ];
  const expandId = "20261008170639_catalog_expand";
  const contractId = "20261009120000_catalog_contract";
  const breakingRelease = {
    ...release,
    migrationCompatibility: {
      ...release.migrationCompatibility,
      strategy: "expand-contract",
      migrationIds: [expandId, contractId],
      expandMigrationIds: [expandId],
      contractMigrationIds: [contractId],
      deploymentSequence: ["expand", "compatible-deploy", "contract"],
    },
    stageMigration: { ...release.stageMigration, migrationIds: [expandId, contractId] },
    preMergeMigration: {
      ...release.preMergeMigration,
      required: true,
      environment: "Production",
      phase: "expand",
      migrationIds: [expandId],
    },
  };
  assert.equal(validateReleaseEvidence({
    files: breakingFiles,
    localVerification: { record: { release: breakingRelease } },
  }).status, "PASS");
  assert.equal(validatePostDeploymentMigrationEvidence({
    files: breakingFiles,
    localVerification: { record: { release: breakingRelease } },
  }).status, "BLOCKED");
  assert.equal(validatePostDeploymentMigrationEvidence({
    files: breakingFiles,
    localVerification: { record: { release: {
      ...breakingRelease,
      postDeployMigration: {
        status: "PASS",
        environment: "Production",
        phase: "contract",
        migrationIds: [contractId],
        command: "supabase migration list --linked",
        details: "Contract migration is applied and the final schema is verified.",
      },
    } } },
  }).status, "PASS");
  const outOfOrderSequence = validateReleaseEvidence({
    files: breakingFiles,
    localVerification: { record: { release: {
      ...breakingRelease,
      migrationCompatibility: {
        ...breakingRelease.migrationCompatibility,
        deploymentSequence: ["compatible-deploy", "expand", "contract"],
      },
    } } },
  });
  assert.equal(outOfOrderSequence.status, "BLOCKED");
  assert.match(outOfOrderSequence.migrationCompatibility.details, /exact order/);

  const earlyContract = validateReleaseEvidence({
    files: breakingFiles,
    localVerification: { record: { release: {
      ...breakingRelease,
      preMergeMigration: { ...breakingRelease.preMergeMigration, migrationIds: [expandId, contractId] },
    } } },
  });
  assert.equal(earlyContract.preMergeMigration.status, "BLOCKED");

  const missingContractPhase = validatePostDeploymentMigrationEvidence({
    files: breakingFiles,
    localVerification: { record: { release: {
      ...breakingRelease,
      postDeployMigration: {
        status: "PASS",
        environment: "Production",
        phase: "contract",
        migrationIds: [expandId],
        command: "supabase migration list --linked",
        details: "Wrong phase migration was applied.",
      },
    } } },
  });
  assert.equal(missingContractPhase.status, "BLOCKED");
});

test("reports configured required checks as missing, pending, failed, or green on the current SHA", () => {
  const base = { requiredChecks: ["build"], headSha: CURRENT_SHA };
  assert.equal(summarizeRequiredGitHubChecks(base).status, "BLOCKED");
  assert.equal(summarizeRequiredGitHubChecks({
    ...base,
    checkRuns: [{ name: "build", head_sha: CURRENT_SHA, status: "in_progress" }],
  }).status, "BLOCKED");
  assert.equal(summarizeRequiredGitHubChecks({
    ...base,
    checkRuns: [{ name: "build", head_sha: CURRENT_SHA, status: "completed", conclusion: "failure" }],
  }).status, "FAIL");
  assert.equal(summarizeRequiredGitHubChecks({
    ...base,
    checkRuns: [{ name: "build", head_sha: CURRENT_SHA, status: "completed", conclusion: "success" }],
  }).status, "PASS");
  assert.equal(summarizeRequiredGitHubChecks({
    ...base,
    requiredChecks: [],
  }).status, "NOT RUN");
  assert.equal(summarizeRequiredGitHubChecks({
    ...base,
    requiredChecks: [{ context: "build", integration_id: 73 }],
    checkRuns: [{
      name: "build",
      head_sha: CURRENT_SHA,
      app: { id: 42 },
      status: "completed",
      conclusion: "success",
    }],
  }).status, "BLOCKED");
  assert.equal(summarizeRequiredGitHubChecks({
    ...base,
    requiredChecks: [{ context: "build", integration_id: 73 }],
    checkRuns: [{
      name: "build",
      head_sha: CURRENT_SHA,
      app: { id: 73 },
      status: "completed",
      conclusion: "success",
    }],
  }).status, "PASS");
  assert.equal(summarizeRequiredGitHubChecks({
    ...base,
    requiredChecks: [{ context: "build", integration_id: "unknown" }],
  }).status, "BLOCKED");
  assert.equal(summarizeRequiredGitHubChecks({
    ...base,
    requiredChecks: [{ context: "build", app_id: -1 }],
    checkRuns: [{
      name: "build",
      head_sha: CURRENT_SHA,
      app: { id: 42 },
      status: "completed",
      conclusion: "success",
    }],
  }).status, "PASS");
});

test("two AI reviews and local evidence satisfy an unprotected branch without optional CI or owner approval", () => {
  const comments = [
    structuredComment(VERIFICATION_MARKER, cleanVerificationRecord()),
    ...cleanAiReviewComments(),
  ];
  const input = {
    pullRequest: cleanPullRequest(),
    files: ["scripts/agent-harness.mjs"],
    comments,
    mergePolicy: cleanMergePolicy(),
  };
  const mergeReady = assessPullRequestVerification(input);
  assert.equal(mergeReady.decision, "READY_FOR_MERGE");
  assert.equal(mergeReady.stages.implementationComplete, true);
  assert.equal(mergeReady.stages.internalReviewComplete, true);
  assert.equal(mergeReady.stages.qualityGatesComplete, true);
  assert.equal(mergeReady.githubReview.status, "NOT RUN");
  assert.equal(mergeReady.checks.required.status, "NOT RUN");
  assert.equal(mergeReady.checks.policy.status, "PASS");
  assert.equal(mergeReady.checks.branchReviewPolicy.status, "PASS");
  assert.equal(mergeReady.mergeReadiness.status, "PASS");
  assert.equal(mergeReady.checks.policy.details.includes("Optional GitHub checks are informational"), true);

  const optionalMissing = assessPullRequestVerification({
    ...input,
    checkRuns: [],
    statuses: [],
  });
  assert.equal(optionalMissing.checks.observed.status, "NOT RUN");
  assert.equal(optionalMissing.checks.policy.status, "PASS");
  assert.equal(optionalMissing.decision, "READY_FOR_MERGE");

  const optionalFailure = assessPullRequestVerification({
    ...input,
    checkRuns: [{
      name: "optional-preview",
      head_sha: CURRENT_SHA,
      status: "completed",
      conclusion: "failure",
    }],
  });
  assert.equal(optionalFailure.checks.observed.status, "FAIL");
  assert.equal(optionalFailure.checks.policy.status, "PASS");
  assert.equal(optionalFailure.decision, "READY_FOR_MERGE");

  const enforcedApprovalMissing = assessPullRequestVerification({
    ...input,
    mergePolicy: cleanMergePolicy({ requiredApprovals: 1 }),
  });
  assert.equal(enforcedApprovalMissing.decision, "READY_FOR_REVIEW");
  assert.equal(enforcedApprovalMissing.stages.waitingForEnforcedApproval, true);
  assert.equal(enforcedApprovalMissing.mergeReadiness.status, "BLOCKED");

  const enforcedApprovalPresent = assessPullRequestVerification({
    ...input,
    mergePolicy: cleanMergePolicy({ requiredApprovals: 1 }),
    reviews: [cleanGitHubReview({ headSha: CURRENT_SHA, user: "reviewer", state: "APPROVED" })],
  });
  assert.equal(enforcedApprovalPresent.decision, "READY_FOR_MERGE");

  const lastPushApprovalPresent = assessPullRequestVerification({
    ...input,
    mergePolicy: cleanMergePolicy({ requiredApprovals: 1, requireLastPushApproval: true }),
    reviews: [cleanGitHubReview({ headSha: CURRENT_SHA, user: "reviewer", state: "APPROVED" })],
    latestPushReviewDecision: "APPROVED",
    latestPushReviewDecisionAvailable: true,
  });
  assert.equal(lastPushApprovalPresent.decision, "READY_FOR_MERGE");
  assert.equal(lastPushApprovalPresent.checks.branchReviewPolicy.approvalsPresent, 1);

  const lastPushApprovalStale = assessPullRequestVerification({
    ...input,
    mergePolicy: cleanMergePolicy({ requiredApprovals: 1, requireLastPushApproval: true }),
    reviews: [cleanGitHubReview({ headSha: "b".repeat(40), user: "reviewer", state: "APPROVED" })],
    latestPushReviewDecision: "REVIEW_REQUIRED",
    latestPushReviewDecisionAvailable: true,
  });
  assert.equal(lastPushApprovalStale.decision, "READY_FOR_REVIEW");
  assert.equal(lastPushApprovalStale.checks.branchReviewPolicy.approvalsPresent, 0);

  const nonEnforcedChangeRequest = assessPullRequestVerification({
    ...input,
    reviews: [cleanGitHubReview({ headSha: CURRENT_SHA, user: "reviewer", state: "CHANGES_REQUESTED" })],
  });
  assert.equal(nonEnforcedChangeRequest.githubReview.requestedChanges, true);
  assert.equal(nonEnforcedChangeRequest.decision, "READY_FOR_MERGE");

  const priorApproval = cleanGitHubReview({
    headSha: "b".repeat(40),
    user: "reviewer",
    state: "APPROVED",
  });
  const approvalNotDismissedOnPush = assessPullRequestVerification({
    ...input,
    mergePolicy: cleanMergePolicy({ requiredApprovals: 1, dismissStaleReviews: false }),
    reviews: [priorApproval],
  });
  assert.equal(approvalNotDismissedOnPush.decision, "READY_FOR_MERGE");
  assert.equal(approvalNotDismissedOnPush.checks.branchReviewPolicy.approvalsPresent, 1);

  const approvalDismissedOnPush = assessPullRequestVerification({
    ...input,
    mergePolicy: cleanMergePolicy({ requiredApprovals: 1, dismissStaleReviews: true }),
    reviews: [priorApproval],
  });
  assert.equal(approvalDismissedOnPush.decision, "READY_FOR_REVIEW");
  assert.equal(approvalDismissedOnPush.checks.branchReviewPolicy.approvalsPresent, 0);

  const failedReview = assessPullRequestVerification({
    ...input,
    comments: [
      structuredComment(VERIFICATION_MARKER, cleanVerificationRecord()),
      structuredComment(AI_REVIEW_MARKER, {
        ...cleanAiReviewRecord(CURRENT_SHA, "reviewer-A"),
        findings: { Critical: [], High: [{ summary: "High bug", requiredFix: "Fix it." }], Medium: [], Low: [] },
        unresolvedFindings: { Critical: [], High: [{ summary: "High bug", requiredFix: "Fix it." }], Medium: [], Low: [] },
      }),
      ...cleanAiReviewComments().slice(1),
    ],
  });
  assert.equal(failedReview.decision, "BLOCKED");
  assert.equal(failedReview.mergeReadiness.status, "BLOCKED");

  const requiredCheckMissing = assessPullRequestVerification({
    ...input,
    mergePolicy: cleanMergePolicy({ requiredChecks: ["build"] }),
  });
  assert.equal(requiredCheckMissing.checks.required.status, "BLOCKED");
  assert.equal(requiredCheckMissing.checks.policy.status, "BLOCKED");
  assert.equal(requiredCheckMissing.decision, "BLOCKED");

  const requiredCheckSuccess = assessPullRequestVerification({
    ...input,
    mergePolicy: cleanMergePolicy({ requiredChecks: ["build"] }),
    checkRuns: [{
      name: "build",
      head_sha: CURRENT_SHA,
      status: "completed",
      conclusion: "success",
    }],
  });
  assert.equal(requiredCheckSuccess.checks.required.status, "PASS");
  assert.equal(requiredCheckSuccess.checks.policy.status, "PASS");
  assert.equal(requiredCheckSuccess.decision, "READY_FOR_MERGE");

  const requiredCheckFailure = assessPullRequestVerification({
    ...input,
    mergePolicy: cleanMergePolicy({ requiredChecks: ["build"] }),
    checkRuns: [{
      name: "build",
      head_sha: CURRENT_SHA,
      status: "completed",
      conclusion: "failure",
    }],
  });
  assert.equal(requiredCheckFailure.checks.required.status, "FAIL");
  assert.equal(requiredCheckFailure.decision, "BLOCKED");

  const staleEvidence = assessPullRequestVerification({
    ...input,
    comments: [
      structuredComment(VERIFICATION_MARKER, cleanVerificationRecord({ headSha: "b".repeat(40) })),
      ...cleanAiReviewComments(),
    ],
  });
  assert.equal(staleEvidence.localVerification.status, "BLOCKED");
  assert.equal(staleEvidence.decision, "BLOCKED");

  for (const mergeable of [false, null]) {
    const mergeabilityBlocked = assessPullRequestVerification({
      ...input,
      pullRequest: cleanPullRequest({ mergeable }),
    });
    assert.equal(mergeabilityBlocked.decision, "BLOCKED");
    assert.equal(mergeabilityBlocked.mergeReadiness.status, "BLOCKED");
    assert.notEqual(mergeabilityBlocked.mergeability.status, "PASS");
  }
});

test("blocks UI PR review readiness until the exact-SHA browser record is complete", () => {
  const screenshot = "docs/verification/pr-52/catalog.png";
  const files = ["src/app/catalog/page.tsx", screenshot];
  const browser = {
    status: "PASS",
    tool: "Playwright",
    testedSha: CURRENT_SHA,
    runId: "pr-52-catalog-run-1",
    flows: ["change catalog layout"],
    screenshots: [{ path: screenshot, testedSha: CURRENT_SHA, runId: "pr-52-catalog-run-1" }],
    responsiveLayouts: ["desktop", "mobile"],
    persistence: { status: "NOT APPLICABLE", details: "This layout does not save user state." },
    screenshotReview: { status: "PASS", details: "Captured layout matches code." },
    retestedAfterFixes: true,
    consoleErrors: [],
    failedNetworkRequests: [],
  };
  const ai = cleanAiReviewComments();
  const missingBrowser = assessPullRequestVerification({
    pullRequest: cleanPullRequest(),
    files,
    comments: [
      structuredComment(VERIFICATION_MARKER, cleanVerificationRecord({ uiBehavior: true })),
      ...ai,
    ],
    mergePolicy: cleanMergePolicy(),
  });
  assert.equal(missingBrowser.fileScope.uiBehaviorRequired, true);
  assert.equal(missingBrowser.browserVerification.status, "NOT RUN");
  assert.equal(missingBrowser.decision, "BLOCKED");

  const verified = assessPullRequestVerification({
    pullRequest: cleanPullRequest(),
    files,
    comments: [
      structuredComment(VERIFICATION_MARKER, cleanVerificationRecord({
        uiBehavior: true,
        browser,
        productionSmokePlan: {
          status: "PASS",
          flows: [{
            name: "catalog page",
            affectedFiles: ["src/app/catalog/page.tsx"],
            paths: [{ path: "/catalog", expectedText: "Catalog" }],
          }],
        },
      })),
      ...ai,
    ],
    mergePolicy: cleanMergePolicy(),
  });
  assert.equal(verified.browserVerification.status, "PASS");
  assert.equal(verified.productionSmokePlan.status, "PASS");
  assert.equal(verified.decision, "READY_FOR_MERGE");

  for (const filename of ["src/lib/catalog-settings.ts", "tailwind.config.ts", "postcss.config.js"]) {
    const helperOnly = assessPullRequestVerification({
      pullRequest: cleanPullRequest(),
      files: [filename],
      comments: [
        structuredComment(VERIFICATION_MARKER, cleanVerificationRecord({ uiBehavior: false })),
        ...ai,
      ],
      mergePolicy: cleanMergePolicy(),
    });
    assert.equal(helperOnly.fileScope.uiBehaviorRequired, true, filename);
    assert.equal(helperOnly.browserVerification.required, true, filename);
    assert.equal(helperOnly.decision, "BLOCKED", filename);
  }
});

test("production smoke plans bind changed route files to valid paths and expected content", () => {
  const files = ["src/app/[locale]/products/page.tsx", "src/components/ProductGrid.tsx"];
  const plan = {
    status: "PASS",
    flows: [
      {
        name: "localized products page",
        affectedFiles: ["src/app/[locale]/products/page.tsx"],
        paths: [{ path: "/pl/products", expectedText: "Produkty" }],
      },
      {
        name: "product grid",
        affectedFiles: ["src/components/ProductGrid.tsx"],
        routeFiles: ["src/app/[locale]/products/page.tsx"],
        paths: [{ path: "/pl/products", expectedText: "Produkty" }],
      },
    ],
  };
  assert.equal(validateProductionSmokePlan({ files, localVerification: { record: { productionSmokePlan: plan } } }).status, "PASS");

  const multipleRoutes = validateProductionSmokePlan({
    files: ["src/app/products/page.tsx", "src/app/about/page.tsx"],
    localVerification: { record: { productionSmokePlan: {
      status: "PASS",
      flows: [{
        name: "catalog and about routes",
        affectedFiles: ["src/app/products/page.tsx", "src/app/about/page.tsx"],
        paths: [
          { path: "/products", expectedText: "Products" },
          { path: "/about", expectedText: "About" },
        ],
      }],
    } } },
  });
  assert.equal(multipleRoutes.status, "PASS");
  const missingSecondRoute = validateProductionSmokePlan({
    files: ["src/app/products/page.tsx", "src/app/about/page.tsx"],
    localVerification: { record: { productionSmokePlan: {
      status: "PASS",
      flows: [{
        name: "catalog and about routes",
        affectedFiles: ["src/app/products/page.tsx", "src/app/about/page.tsx"],
        paths: [{ path: "/products", expectedText: "Products" }],
      }],
    } } },
  });
  assert.equal(missingSecondRoute.status, "BLOCKED");

  const unrelatedComponentRoute = structuredClone(plan);
  unrelatedComponentRoute.flows[1].paths[0].path = "/catalog";
  assert.equal(validateProductionSmokePlan({
    files,
    localVerification: { record: { productionSmokePlan: unrelatedComponentRoute } },
  }).status, "BLOCKED");

  const wrongRoute = structuredClone(plan);
  wrongRoute.flows[0].paths[0].path = "/catalog";
  assert.equal(validateProductionSmokePlan({ files, localVerification: { record: { productionSmokePlan: wrongRoute } } }).status, "BLOCKED");

  const uncovered = structuredClone(plan);
  uncovered.flows[1].affectedFiles = [];
  assert.equal(validateProductionSmokePlan({ files, localVerification: { record: { productionSmokePlan: uncovered } } }).status, "BLOCKED");

  for (const path of ["products", "//elsewhere.test/products", "/"]) {
    const invalidPath = structuredClone(plan);
    invalidPath.flows[0].paths[0].path = path;
    assert.equal(validateProductionSmokePlan({ files, localVerification: { record: { productionSmokePlan: invalidPath } } }).status, "BLOCKED", path);
  }

  const routingControls = ["middleware.ts", "src/proxy.ts", "next.config.mjs"];
  for (const filename of routingControls) {
    const missingRoutingPlan = validateProductionSmokePlan({ files: [filename] });
    assert.equal(missingRoutingPlan.status, "BLOCKED", filename);
    const routingPlan = validateProductionSmokePlan({
      files: [filename],
      localVerification: { record: { productionSmokePlan: {
        status: "PASS",
        flows: [{
          name: "localized product route through routing control",
          affectedFiles: [filename],
          routeFiles: ["src/app/[locale]/products/page.tsx"],
          paths: [{ path: "/pl/products", expectedText: "Produkty" }],
        }],
      } } },
    });
    assert.equal(routingPlan.status, "PASS", filename);
  }

  const srcPagesRoute = "src/pages/catalog.tsx";
  assert.equal(validateProductionSmokePlan({ files: [srcPagesRoute] }).status, "BLOCKED");
  assert.equal(validateProductionSmokePlan({
    files: [srcPagesRoute],
    localVerification: { record: { productionSmokePlan: {
      status: "PASS",
      flows: [{
        name: "Pages Router catalog",
        affectedFiles: [srcPagesRoute],
        paths: [{ path: "/catalog", expectedText: "Catalog" }],
      }],
    } } },
  }).status, "PASS");
});

test("marks the PR blocked when its state, base, or HEAD changes during assessment", () => {
  const evidenceComments = [
    structuredComment(VERIFICATION_MARKER, cleanVerificationRecord()),
    structuredComment(AI_REVIEW_MARKER, cleanAiReviewRecord()),
  ];
  const base = {
    pullRequest: cleanPullRequest(),
    files: ["scripts/agent-harness.mjs"],
    comments: evidenceComments,
    mergePolicy: cleanMergePolicy(),
  };
  assert.equal(assessPullRequestVerification({
    ...base,
    pullRequest: cleanPullRequest({ state: "closed" }),
  }).decision, "BLOCKED");
  assert.equal(assessPullRequestVerification({
    ...base,
    pullRequest: cleanPullRequest({ base: { ref: "develop", sha: "b".repeat(40) } }),
  }).decision, "BLOCKED");
  assert.equal(assessPullRequestVerification({ ...base, snapshotStable: false }).decision, "BLOCKED");
});

test("verify-pr reads exact-SHA evidence and branch policy without write or merge calls", async () => {
  const pullRequest = cleanPullRequest();
  const comments = [
    structuredComment(VERIFICATION_MARKER, cleanVerificationRecord()),
    ...cleanAiReviewComments(),
  ];
  const calls = [];
  const client = {
    owner: "example",
    repo: "repo",
    graphql: async (query) => query.includes("reviewDecision")
      ? { repository: { pullRequest: { reviewDecision: "APPROVED" } } }
      : { repository: { pullRequest: { commits: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } },
    request: async (path) => {
      calls.push(path);
      if (path === "/repos/example/repo/pulls/52") return pullRequest;
      if (path.endsWith("/pulls/52/reviews?per_page=100&page=1")) return [];
      if (path.endsWith("/pulls/52/files?per_page=100&page=1")) return [{ filename: "scripts/agent-harness.mjs" }];
      if (path.endsWith("/pulls/52/commits?per_page=100&page=1")) return [{ sha: "d".repeat(40), commit: { message: "Add harness changes" } }];
      if (path.endsWith("/issues/52/comments?per_page=100&page=1")) return comments;
      if (path.endsWith("/check-runs?per_page=100&page=1")) return { total_count: 0, check_runs: [] };
      if (path.endsWith("/statuses?per_page=100&page=1")) return [];
      if (path.endsWith("/branches/main/protection")) {
        throw new Error("GitHub API (404): Branch not protected");
      }
      if (path.endsWith("/rules/branches/main?per_page=100&page=1")) return [];
      throw new Error("Unexpected read request: " + path);
    },
  };
  const result = await verifyPullRequest(client, 52);
  assert.equal(result.decision, "READY_FOR_MERGE");
  assert.equal(result.currentSha, CURRENT_SHA);
  assert.ok(calls.some((path) => path.endsWith("/statuses?per_page=100&page=1")));
  assert.ok(calls.every((path) => !/\/merges(?:\?|$)|\/deployments(?:\?|$)/.test(path)));

  const unavailableLastPushDecisionClient = {
    ...client,
    graphql: async (query, variables) => {
      if (query.includes("reviewDecision")) throw new Error("GitHub reviewDecision unavailable");
      return client.graphql(query, variables);
    },
    request: async (path) => {
      if (path.endsWith("/branches/main/protection")) {
        return { required_pull_request_reviews: {
          required_approving_review_count: 1,
          dismiss_stale_reviews: false,
          require_last_push_approval: true,
        } };
      }
      if (path.endsWith("/pulls/52/reviews?per_page=100&page=1")) {
        return [cleanGitHubReview({ headSha: CURRENT_SHA, user: "reviewer", state: "APPROVED" })];
      }
      return client.request(path);
    },
  };
  const unavailableLastPushDecision = await verifyPullRequest(unavailableLastPushDecisionClient, 52);
  assert.equal(unavailableLastPushDecision.decision, "BLOCKED");
  assert.equal(unavailableLastPushDecision.stages.waitingForEnforcedApproval, false);
  assert.equal(unavailableLastPushDecision.checks.branchReviewPolicy.status, "BLOCKED");

  const mergedPullRequest = cleanPullRequest({
    state: "closed",
    merged: true,
    merge_commit_sha: "d".repeat(40),
    mergeable: null,
    base: { ref: "main", sha: "e".repeat(40) },
  });
  const mergedClient = {
    ...client,
    request: async (path) => {
      if (path === "/repos/example/repo/pulls/52") return mergedPullRequest;
      if (path.endsWith("/commits/" + "d".repeat(40))) {
        return { sha: "d".repeat(40), parents: [{ sha: CURRENT_BASE_SHA }, { sha: CURRENT_SHA }] };
      }
      return client.request(path);
    },
  };
  const verifiedMerge = await verifyPullRequest(mergedClient, 52, { allowMerged: true });
  assert.equal(verifiedMerge.decision, "VERIFIED_MERGE");
  assert.equal(verifiedMerge.pullRequest.merged, true);
  assert.equal(verifiedMerge.pullRequest.baseSha, CURRENT_BASE_SHA);
  assert.equal(verifiedMerge.currentSha, CURRENT_SHA);
  assert.equal(verifiedMerge.mergeBase.status, "PASS");
  assert.equal(verifiedMerge.mergeBase.reviewedBaseSha, CURRENT_BASE_SHA);
  assert.equal(verifiedMerge.mergeBase.reviewedBaseShaVerified, true);

  const mergedWithWrongParentClient = {
    ...mergedClient,
    request: async (path) => {
      if (path === "/repos/example/repo/pulls/52") return mergedPullRequest;
      if (path.endsWith("/commits/" + "d".repeat(40))) {
        return { sha: "d".repeat(40), parents: [{ sha: "f".repeat(40) }, { sha: CURRENT_SHA }] };
      }
      return client.request(path);
    },
  };
  const wrongMergedBase = await verifyPullRequest(mergedWithWrongParentClient, 52, { allowMerged: true });
  assert.equal(wrongMergedBase.decision, "BLOCKED");
  assert.match(wrongMergedBase.aiReview.details, /different or unrecorded base SHA/);
  assert.equal(wrongMergedBase.mergeBase.status, "BLOCKED");
  assert.equal(wrongMergedBase.mergeBase.sha, "f".repeat(40));
  assert.equal(wrongMergedBase.mergeBase.reviewedBaseSha, CURRENT_BASE_SHA);
  assert.equal(wrongMergedBase.mergeBase.reviewedBaseShaVerified, false);

  const mergedWithUnreadableParentClient = {
    ...mergedClient,
    request: async (path) => {
      if (path === "/repos/example/repo/pulls/52") return mergedPullRequest;
      if (path.endsWith("/commits/" + "d".repeat(40))) return { sha: "d".repeat(40), parents: [] };
      return client.request(path);
    },
  };
  const unreadableMergedBase = await verifyPullRequest(mergedWithUnreadableParentClient, 52, { allowMerged: true });
  assert.equal(unreadableMergedBase.decision, "BLOCKED");
  assert.equal(unreadableMergedBase.mergeBase.status, "BLOCKED");
  assert.ok(unreadableMergedBase.fileScope);
  assert.ok(unreadableMergedBase.productionSmokePlan);
  assert.ok(unreadableMergedBase.reasons.some((reason) => /first parent/.test(reason)));

  const closingPrClient = {
    ...client,
    request: async (path) => path === "/repos/example/repo/pulls/52"
      ? cleanPullRequest({ body: "Closes #29" })
      : client.request(path),
  };
  const closingPr = await verifyPullRequest(closingPrClient, 52);
  assert.equal(closingPr.decision, "BLOCKED");
  assert.ok(closingPr.reasons.some((reason) => /auto-close issue references/.test(reason)));

  const closingCommitClient = {
    ...client,
    request: async (path) => path.endsWith("/pulls/52/commits?per_page=100&page=1")
      ? [{ sha: "d".repeat(40), commit: { message: "Fixes #29 after delivery" } }]
      : client.request(path),
  };
  const closingCommit = await verifyPullRequest(closingCommitClient, 52);
  assert.equal(closingCommit.decision, "BLOCKED");
  assert.ok(closingCommit.reasons.some((reason) => /commit message.*auto-close issue references/.test(reason)));

  const longCommitMessages = Array.from({ length: 251 }, (_, index) =>
    index === 250 ? "Closes: #29 in a commit beyond the REST cap" : "Ordinary implementation commit " + index,
  );
  const longHistoryClient = {
    ...client,
    request: async (path) => {
      const match = path.match(/\/pulls\/52\/commits\?per_page=100&page=(\d+)/);
      if (match) {
        const page = Number(match[1]);
        return longCommitMessages.slice((page - 1) * 100, page * 100).map((message, index) => ({
          sha: String((page - 1) * 100 + index + 1).padStart(40, "0"),
          commit: { message },
        }));
      }
      return client.request(path);
    },
    graphql: async (query, variables = {}) => query.includes("commits(first: 100")
      ? pullRequestCommitPage(longCommitMessages, variables.after)
      : client.graphql(query, variables),
  };
  const longHistory = await verifyPullRequest(longHistoryClient, 52);
  assert.equal(longHistory.decision, "BLOCKED");
  assert.ok(longHistory.reasons.some((reason) => /commit message.*auto-close issue references/.test(reason)));

  const unreadableCommitHistory = {
    ...client,
    request: async (path) => path.endsWith("/pulls/52/commits?per_page=100&page=1")
      ? Promise.reject(new Error("commit history unavailable"))
      : client.request(path),
  };
  const unreadableCommits = await verifyPullRequest(unreadableCommitHistory, 52);
  assert.equal(unreadableCommits.decision, "BLOCKED");
  assert.ok(unreadableCommits.reasons.some((reason) => /commit history could not be read/.test(reason)));

  let prReads = 0;
  const unstableClient = {
    ...client,
    request: async (path) => {
      if (path === "/repos/example/repo/pulls/52") {
        prReads += 1;
        return prReads === 1 ? pullRequest : cleanPullRequest({
          head: { ref: "codex/harness", sha: "c".repeat(40) },
        });
      }
      return client.request(path);
    },
  };
  const unstable = await verifyPullRequest(unstableClient, 52);
  assert.equal(unstable.decision, "BLOCKED");
  assert.ok(unstable.reasons.some((reason) => /changed during verification/.test(reason)));

  for (const changedState of [
    { state: "closed" },
    { draft: true },
    { base: { ref: "develop", sha: "d".repeat(40) } },
  ]) {
    let stateReads = 0;
    const changedStateClient = {
      ...client,
      request: async (path) => {
        if (path === "/repos/example/repo/pulls/52") {
          stateReads += 1;
          return stateReads === 1 ? pullRequest : cleanPullRequest(changedState);
        }
        return client.request(path);
      },
    };
    const changedSnapshot = await verifyPullRequest(changedStateClient, 52);
    assert.equal(changedSnapshot.decision, "BLOCKED");
    assert.ok(changedSnapshot.reasons.some((reason) => /changed during verification/.test(reason)));
  }

  const strictPolicyClient = {
    ...client,
    request: async (path) => path === "/repos/example/repo/pulls/52"
      ? cleanPullRequest({ mergeable_state: "behind" })
      : path.endsWith("/branches/main/protection")
        ? { required_status_checks: { contexts: ["build"], checks: [], strict: true } }
        : client.request(path),
  };
  const strictPolicy = await verifyPullRequest(strictPolicyClient, 52);
  assert.equal(strictPolicy.decision, "BLOCKED");
  assert.equal(strictPolicy.mergeReadiness.status, "BLOCKED");
  assert.match(strictPolicy.checks.branchReviewPolicy.details, /behind its base/);

  const strictPolicySatisfiedClient = {
    ...strictPolicyClient,
    request: async (path) => path === "/repos/example/repo/pulls/52"
      ? cleanPullRequest({ mergeable_state: "clean" })
      : path.endsWith("/branches/main/protection")
        ? { required_status_checks: { contexts: ["build"], checks: [], strict: true } }
        : path.endsWith("/check-runs?per_page=100&page=1")
          ? { total_count: 1, check_runs: [{
              name: "build",
              head_sha: CURRENT_SHA,
              status: "completed",
              conclusion: "success",
            }] }
          : client.request(path),
  };
  const strictPolicySatisfied = await verifyPullRequest(strictPolicySatisfiedClient, 52);
  assert.equal(strictPolicySatisfied.decision, "READY_FOR_MERGE", JSON.stringify(strictPolicySatisfied));
  assert.equal(strictPolicySatisfied.checks.branchReviewPolicy.status, "PASS");

  const strictPolicyBehindWithApprovalClient = {
    ...strictPolicySatisfiedClient,
    request: async (path) => path === "/repos/example/repo/pulls/52"
      ? cleanPullRequest({ mergeable_state: "behind" })
      : path.endsWith("/branches/main/protection")
        ? {
            required_status_checks: { contexts: ["build"], checks: [], strict: true },
            required_pull_request_reviews: {
              required_approving_review_count: 1,
              dismiss_stale_reviews: false,
              require_last_push_approval: false,
            },
          }
        : path.endsWith("/pulls/52/reviews?per_page=100&page=1")
          ? [cleanGitHubReview({ headSha: CURRENT_SHA, user: "reviewer", state: "APPROVED" })]
          : path.endsWith("/check-runs?per_page=100&page=1")
            ? { total_count: 1, check_runs: [{
                name: "build",
                head_sha: CURRENT_SHA,
                status: "completed",
                conclusion: "success",
              }] }
            : client.request(path),
  };
  const strictBehindWithApproval = await verifyPullRequest(strictPolicyBehindWithApprovalClient, 52);
  assert.equal(strictBehindWithApproval.decision, "BLOCKED");
  assert.equal(strictBehindWithApproval.stages.waitingForEnforcedApproval, false);
  assert.match(strictBehindWithApproval.checks.branchReviewPolicy.details, /behind its base/);

  const oldApproval = cleanGitHubReview({
    headSha: "b".repeat(40),
    user: "reviewer",
    state: "APPROVED",
  });
  const staleApprovalPolicyClient = {
    ...client,
    request: async (path) => {
      if (path.endsWith("/branches/main/protection")) {
        return { required_pull_request_reviews: {
          required_approving_review_count: 1,
          dismiss_stale_reviews: false,
          require_last_push_approval: false,
        } };
      }
      if (path.endsWith("/pulls/52/reviews?per_page=100&page=1")) return [oldApproval];
      return client.request(path);
    },
  };
  const staleApprovalAllowed = await verifyPullRequest(staleApprovalPolicyClient, 52);
  assert.equal(staleApprovalAllowed.decision, "READY_FOR_MERGE");
  assert.equal(staleApprovalAllowed.checks.branchReviewPolicy.approvalsPresent, 1);

  const staleApprovalDismissalClient = {
    ...staleApprovalPolicyClient,
    request: async (path) => path.endsWith("/branches/main/protection")
      ? { required_pull_request_reviews: {
          required_approving_review_count: 1,
          dismiss_stale_reviews: true,
          require_last_push_approval: false,
        } }
      : staleApprovalPolicyClient.request(path),
  };
  const staleApprovalDismissed = await verifyPullRequest(staleApprovalDismissalClient, 52);
  assert.equal(staleApprovalDismissed.decision, "READY_FOR_REVIEW");
  assert.equal(staleApprovalDismissed.checks.branchReviewPolicy.approvalsPresent, 0);

  const staleRulesetApprovalClient = {
    ...client,
    request: async (path) => {
      if (path.endsWith("/branches/main/protection")) {
        throw new Error("GitHub API (404): Branch not protected");
      }
      if (path.endsWith("/rules/branches/main?per_page=100&page=1")) {
        return [{ type: "pull_request", parameters: {
          required_approving_review_count: 1,
          dismiss_stale_reviews: false,
        } }];
      }
      if (path.endsWith("/pulls/52/reviews?per_page=100&page=1")) return [oldApproval];
      return client.request(path);
    },
  };
  const staleRulesetApproval = await verifyPullRequest(staleRulesetApprovalClient, 52);
  assert.equal(staleRulesetApproval.decision, "READY_FOR_MERGE");
  assert.equal(staleRulesetApproval.checks.branchReviewPolicy.approvalsPresent, 1);

  const lastPushApprovalPolicyClient = {
    ...client,
    request: async (path) => {
      if (path.endsWith("/branches/main/protection")) {
        return { required_pull_request_reviews: {
          required_approving_review_count: 1,
          dismiss_stale_reviews: false,
          require_last_push_approval: true,
        } };
      }
      if (path.endsWith("/pulls/52/reviews?per_page=100&page=1")) {
        return [cleanGitHubReview({ headSha: CURRENT_SHA, user: "reviewer", state: "APPROVED" })];
      }
      return client.request(path);
    },
  };
  const lastPushApprovalVerified = await verifyPullRequest(lastPushApprovalPolicyClient, 52);
  assert.equal(lastPushApprovalVerified.decision, "READY_FOR_MERGE");
  assert.equal(lastPushApprovalVerified.checks.branchReviewPolicy.approvalsPresent, 1);
  const latestPushStillNeedsReview = await verifyPullRequest({
    ...lastPushApprovalPolicyClient,
    graphql: async (query, variables) => query.includes("reviewDecision")
      ? { repository: { pullRequest: { reviewDecision: "REVIEW_REQUIRED" } } }
      : client.graphql(query, variables),
  }, 52);
  assert.equal(latestPushStillNeedsReview.decision, "READY_FOR_REVIEW");
  assert.equal(latestPushStillNeedsReview.checks.branchReviewPolicy.status, "BLOCKED");
  assert.match(latestPushStillNeedsReview.checks.branchReviewPolicy.details, /most recent reviewable push/);

  const appBoundPolicyClient = {
    ...client,
    request: async (path) => {
      if (path.endsWith("/branches/main/protection")) {
        return { required_status_checks: { contexts: ["build"], checks: [{ context: "build", app_id: 73 }] } };
      }
      if (path.endsWith("/check-runs?per_page=100&page=1")) {
        return {
          total_count: 1,
          check_runs: [{
            name: "build",
            head_sha: CURRENT_SHA,
            app: { id: 42 },
            status: "completed",
            conclusion: "success",
          }],
        };
      }
      return client.request(path);
    },
  };
  const wrongProvider = await verifyPullRequest(appBoundPolicyClient, 52);
  assert.equal(wrongProvider.checks.required.status, "BLOCKED");
  assert.match(wrongProvider.checks.required.details, /required provider/);

  const matchingProviderClient = {
    ...appBoundPolicyClient,
    request: async (path) => path.endsWith("/check-runs?per_page=100&page=1")
      ? {
          total_count: 1,
          check_runs: [{
            name: "build",
            head_sha: CURRENT_SHA,
            app: { id: 73 },
            status: "completed",
            conclusion: "success",
          }],
        }
      : appBoundPolicyClient.request(path),
  };
  const matchingProvider = await verifyPullRequest(matchingProviderClient, 52);
  assert.equal(matchingProvider.checks.required.status, "PASS");

  const rulesetProviderClient = {
    ...client,
    request: async (path) => {
      if (path.endsWith("/branches/main/protection")) {
        throw new Error("GitHub API (404): Branch not protected");
      }
      if (path.endsWith("/rules/branches/main?per_page=100&page=1")) {
        return [{
          type: "required_status_checks",
          parameters: {
            required_status_checks: [{ context: "build", integration_id: 73 }],
          },
        }];
      }
      if (path.endsWith("/check-runs?per_page=100&page=1")) {
        return {
          total_count: 1,
          check_runs: [{
            name: "build",
            head_sha: CURRENT_SHA,
            app: { id: 42 },
            status: "completed",
            conclusion: "success",
          }],
        };
      }
      return client.request(path);
    },
  };
  const rulesetWrongProvider = await verifyPullRequest(rulesetProviderClient, 52);
  assert.equal(rulesetWrongProvider.checks.required.status, "BLOCKED");
  assert.match(rulesetWrongProvider.checks.required.details, /required provider/);

  const paginatedRulesClient = {
    ...client,
    request: async (path) => {
      if (path.endsWith("/branches/main/protection")) {
        throw new Error("GitHub API (404): Branch not protected");
      }
      if (path.endsWith("/rules/branches/main?per_page=100&page=1")) {
        return Array.from({ length: 100 }, () => ({
          type: "required_status_checks",
          parameters: { required_status_checks: [] },
        }));
      }
      if (path.endsWith("/rules/branches/main?per_page=100&page=2")) {
        return [{
          type: "required_status_checks",
          parameters: {
            required_status_checks: [{ context: "late-build", integration_id: 73 }],
          },
        }];
      }
      if (path.endsWith("/check-runs?per_page=100&page=1")) {
        return {
          total_count: 1,
          check_runs: [{
            name: "late-build",
            head_sha: CURRENT_SHA,
            app: { id: 73 },
            status: "completed",
            conclusion: "success",
          }],
        };
      }
      return client.request(path);
    },
  };
  const paginatedRules = await verifyPullRequest(paginatedRulesClient, 52);
  assert.equal(paginatedRules.checks.required.status, "PASS");
});

test("waits for a successful Production deployment of the exact merge SHA", async () => {
  const mergeSha = "c".repeat(40);
  const deploymentUrl = "https://lamilia-lomi-8bozqd5pu-fantomxs-projects.vercel.app";
  const calls = [];
  const client = {
    owner: "example",
    repo: "repo",
    request: async (path) => {
      calls.push(path);
      if (path.includes("/deployments?sha=")) {
        return [
          { id: 1, sha: "b".repeat(40), environment: "Production", created_at: "2026-10-08T11:00:00Z" },
          {
            id: 2,
            sha: mergeSha,
            ref: mergeSha,
            task: "deploy",
            creator: { login: "vercel[bot]" },
            environment: "Production",
            created_at: "2026-10-08T12:00:00Z",
          },
        ];
      }
      if (path.endsWith("/deployments/2/statuses?per_page=100&page=1")) {
        return [{
          id: 9,
          state: "success",
          environment_url: deploymentUrl,
          creator: { login: "vercel[bot]" },
          created_at: "2026-10-08T12:05:00Z",
        }];
      }
      throw new Error("Unexpected deployment request: " + path);
    },
  };
  const ready = await waitForProductionDeployment(client, mergeSha, { timeoutMs: 0 });
  assert.equal(ready.status, "PASS");
  assert.equal(ready.deployment.sha, mergeSha);
  assert.equal(ready.deployment.environmentUrl, deploymentUrl);
  assert.equal(ready.deployment.provider, "Vercel Git integration");
  assert.equal(calls.length, 2);

  const missing = await waitForProductionDeployment({
    owner: "example",
    repo: "repo",
    request: async () => [{ id: 3, sha: "d".repeat(40), environment: "Production" }],
  }, mergeSha, { timeoutMs: 0 });
  assert.equal(missing.status, "BLOCKED");
  assert.match(missing.details, /No Production deployment for the exact merge SHA/);

  let now = 0;
  let deploymentReads = 0;
  const retried = await waitForProductionDeployment({
    owner: "example",
    repo: "repo",
    request: async (path) => {
      if (path.includes("/deployments?sha=")) {
        deploymentReads += 1;
        if (deploymentReads === 1) throw new Error("temporary GitHub API error");
        return [{
          id: 4,
          sha: mergeSha,
          ref: mergeSha,
          task: "deploy",
          creator: { login: "vercel[bot]" },
          environment: "Production",
        }];
      }
      if (path.includes("/deployments/4/statuses?")) return [{
        state: "success",
        environment_url: deploymentUrl,
        creator: { login: "vercel[bot]" },
      }];
      throw new Error("Unexpected retry request: " + path);
    },
  }, mergeSha, {
    timeoutMs: 100,
    pollIntervalMs: 10,
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
  });
  assert.equal(retried.status, "PASS");
  assert.equal(deploymentReads, 2);

  const failed = await waitForProductionDeployment({
    owner: "example",
    repo: "repo",
    request: async (path) => path.includes("/deployments?sha=")
      ? [{
          id: 5,
          sha: mergeSha,
          ref: mergeSha,
          task: "deploy",
          creator: { login: "vercel[bot]" },
          environment: "Production",
        }]
      : [{
          state: "failure",
          creator: { login: "vercel[bot]" },
          target_url: "https://vercel.example.test/deployments/5",
          log_url: "https://vercel.example.test/deployments/5/logs",
          description: "Build failed.",
        }],
  }, mergeSha, { timeoutMs: 0 });
  assert.equal(failed.status, "FAIL");
  assert.match(failed.details, /Build failed/);
  assert.match(failed.details, /deployments\/5\/logs/);
});

test("Production deployment verification requires Vercel provenance and this project's HTTPS origin", async () => {
  const mergeSha = "c".repeat(40);
  const untrusted = await waitForProductionDeployment({
    owner: "example",
    repo: "repo",
    request: async (path) => path.includes("/deployments?sha=")
      ? [{
          id: 6,
          sha: mergeSha,
          ref: mergeSha,
          task: "deploy",
          creator: { login: "another-bot[bot]" },
          environment: "Production",
        }]
      : [{ state: "success", environment_url: "https://lamilia-lomi.vercel.app", creator: { login: "vercel[bot]" } }],
  }, mergeSha, { timeoutMs: 0 });
  assert.equal(untrusted.status, "BLOCKED");
  assert.match(untrusted.details, /none are verifiable as a Vercel Git deployment/);

  const mutableAlias = await waitForProductionDeployment({
    owner: "example",
    repo: "repo",
    request: async (path) => path.includes("/deployments?sha=")
      ? [{
          id: 61,
          sha: mergeSha,
          ref: mergeSha,
          task: "deploy",
          creator: { login: "vercel[bot]" },
          environment: "Production",
        }]
      : [{ state: "success", environment_url: "https://lamilia-lomi.vercel.app", creator: { login: "vercel[bot]" } }],
  }, mergeSha, { timeoutMs: 0 });
  assert.equal(mutableAlias.status, "BLOCKED");
  assert.match(mutableAlias.details, /expected Production project/);

  const wrongOrigin = await waitForProductionDeployment({
    owner: "example",
    repo: "repo",
    request: async (path) => path.includes("/deployments?sha=")
      ? [{
          id: 7,
          sha: mergeSha,
          ref: mergeSha,
          task: "deploy",
          creator: { login: "vercel[bot]" },
          environment: "Production",
        }]
      : [{ state: "success", environment_url: "https://attacker.example", creator: { login: "vercel[bot]" } }],
  }, mergeSha, { timeoutMs: 0 });
  assert.equal(wrongOrigin.status, "BLOCKED");
  assert.match(wrongOrigin.details, /expected Production project/);

  const siblingProjectOrigin = await waitForProductionDeployment({
    owner: "example",
    repo: "repo",
    request: async (path) => path.includes("/deployments?sha=")
      ? [{
          id: 71,
          sha: mergeSha,
          ref: mergeSha,
          task: "deploy",
          creator: { login: "vercel[bot]" },
          environment: "Production",
        }]
      : [{
          state: "success",
          environment_url: "https://lamilia-lomi-other-project-abc123456-fantomxs-projects.vercel.app",
          creator: { login: "vercel[bot]" },
        }],
  }, mergeSha, { timeoutMs: 0 });
  assert.equal(siblingProjectOrigin.status, "BLOCKED");
  assert.match(siblingProjectOrigin.details, /expected Production project/);

  const untrustedStatus = await waitForProductionDeployment({
    owner: "example",
    repo: "repo",
    request: async (path) => path.includes("/deployments?sha=")
      ? [{
          id: 8,
          sha: mergeSha,
          ref: mergeSha,
          task: "deploy",
          creator: { login: "vercel[bot]" },
          environment: "Production",
        }]
      : [{
          state: "success",
          environment_url: "https://lamilia-lomi.vercel.app",
          creator: { login: "other-writer" },
        }],
  }, mergeSha, { timeoutMs: 0 });
  assert.equal(untrustedStatus.status, "BLOCKED");
  assert.match(untrustedStatus.details, /status was not authored by the Vercel Git integration/);
});

test("Production smoke checks stay on HTTPS and fail on unsuccessful or empty responses", async () => {
  const paths = ["/", "/catalog"];
  const calls = [];
  const success = await runProductionSmoke("https://production.example.test", {
    paths,
    fetchImpl: async (url) => {
      calls.push(url.href);
      return {
        ok: true,
        status: 200,
        url: url.href,
        headers: { get: () => "text/html" },
        text: async () => "<html>ok</html>",
      };
    },
  });
  assert.equal(success.status, "PASS");
  assert.deepEqual(calls, [
    "https://production.example.test/",
    "https://production.example.test/catalog",
  ]);

  const failed = await runProductionSmoke("https://production.example.test", {
    paths: ["/"],
    fetchImpl: async (url) => ({
      ok: false,
      status: 503,
      url: url.href,
      headers: { get: () => "text/html" },
      text: async () => "Unavailable",
    }),
  });
  assert.equal(failed.status, "FAIL");
  assert.match(failed.details, /HTTP 503/);

  const empty = await runProductionSmoke("https://production.example.test", {
    paths: ["/products"],
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      url: url.href,
      headers: { get: () => "text/html" },
      text: async () => "  ",
    }),
  });
  assert.equal(empty.status, "FAIL");
  assert.match(empty.details, /empty response/);

  const expectedFlow = await runProductionSmoke("https://production.example.test", {
    paths: ["/products"],
    expectations: [{ path: "/products", expectedText: "Products" }],
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      url: url.href,
      headers: { get: () => "text/html" },
      text: async () => "<main>Products</main>",
    }),
  });
  assert.equal(expectedFlow.status, "PASS");
  assert.equal(expectedFlow.checks[0].expectedTextMatched, true);

  const wrongExpectedFlow = await runProductionSmoke("https://production.example.test", {
    paths: ["/products"],
    expectations: [{ path: "/products", expectedText: "Private admin console" }],
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      url: url.href,
      headers: { get: () => "text/html" },
      text: async () => "<main>Products</main>",
    }),
  });
  assert.equal(wrongExpectedFlow.status, "FAIL");
  assert.match(wrongExpectedFlow.details, /expected content/);

  assert.equal((await runProductionSmoke("http://production.example.test")).status, "BLOCKED");
  assert.equal((await runProductionSmoke("https://production.example.test", { paths: ["//elsewhere.test"] })).status, "BLOCKED");
});

test("blocks merge when the base SHA changes after verification", async () => {
  const fixture = createDeliveryClient({ baseShaOnPreMerge: "d".repeat(40) });
  const result = await deliverPullRequest(fixture.client, 52, {
    verify: async () => ({ decision: "READY_FOR_MERGE", currentSha: CURRENT_SHA, reasons: [] }),
  });

  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.stage, "final-merge-snapshot");
  assert.equal(fixture.calls.some(({ path, method }) => path.endsWith("/pulls/52/merge") && method === "PUT"), false);
});

test("blocks delivery when the merge commit first parent differs from the reviewed base", async () => {
  const fixture = createDeliveryClient({ mergeParentSha: "d".repeat(40) });
  let productionSmokeRan = false;
  const result = await deliverPullRequest(fixture.client, 52, {
    issueNumber: 7,
    verify: async () => ({
      decision: "READY_FOR_MERGE",
      currentSha: CURRENT_SHA,
      pullRequest: { baseSha: CURRENT_BASE_SHA },
      reasons: [],
    }),
    waitForDeployment: async (_client, mergeSha) => ({
      status: "PASS",
      deployment: { id: 14, sha: mergeSha, environmentUrl: "https://production.example.test" },
      details: "Exact-SHA deployment passed.",
    }),
    smoke: async () => {
      productionSmokeRan = true;
      return { status: "PASS", checks: [], details: "Production smoke passed." };
    },
  });

  assert.equal(result.merged, true);
  assert.equal(result.mergeBaseVerification.status, "BLOCKED");
  assert.equal(result.mergeBaseVerification.expectedSha, CURRENT_BASE_SHA);
  assert.equal(result.mergeBaseVerification.sha, "d".repeat(40));
  assert.equal(productionSmokeRan, true);
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.completed, false);
  assert.equal(fixture.issueState, "open");
  assert.notEqual(fixture.projectStatus, "Done");
});

test("merged recovery still collects Production signals when the merge base is unreadable", async () => {
  const fixture = createDeliveryClient({
    alreadyMerged: true,
    mergeParentSha: null,
  });
  let deploymentChecks = 0;
  let smokeChecks = 0;
  const result = await deliverPullRequest(fixture.client, 52, {
    issueNumber: 7,
    verify: async () => ({
      decision: "BLOCKED",
      currentSha: CURRENT_SHA,
      pullRequest: { baseSha: null },
      mergeBase: { status: "BLOCKED", sha: null },
      fileScope: { files: [], productionSmokePlan: { status: "PASS", required: false } },
      productionSmokePlan: { status: "PASS", required: false },
      reasons: ["The merge commit's reviewed base SHA could not be verified."],
    }),
    waitForDeployment: async (_client, mergeSha) => {
      deploymentChecks += 1;
      return {
        status: "PASS",
        deployment: { id: 14, sha: mergeSha, environmentUrl: "https://production.example.test" },
        details: "Exact-SHA deployment was observed.",
      };
    },
    smoke: async () => {
      smokeChecks += 1;
      return { status: "PASS", checks: [], details: "Production health smoke passed." };
    },
  });

  assert.equal(deploymentChecks, 1);
  assert.equal(smokeChecks, 1);
  assert.equal(result.productionDeployment.status, "PASS");
  assert.equal(result.productionSmoke.status, "PASS");
  assert.equal(result.mergeBaseVerification.status, "BLOCKED");
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.completed, false);
  assert.equal(fixture.issueState, "open");
  assert.notEqual(fixture.projectStatus, "Done");
});

test("merged recovery reports a blocked merge base when review evidence names a different base", async () => {
  const fixture = createDeliveryClient({ alreadyMerged: true });
  const reviewedBaseSha = "d".repeat(40);
  const result = await deliverPullRequest(fixture.client, 52, {
    issueNumber: 7,
    verify: async () => ({
      decision: "BLOCKED",
      currentSha: CURRENT_SHA,
      pullRequest: { baseSha: CURRENT_BASE_SHA },
      mergeBase: {
        status: "BLOCKED",
        sha: CURRENT_BASE_SHA,
        reviewedBaseSha,
        details: "The review evidence was recorded against a different base.",
      },
      fileScope: { files: [], productionSmokePlan: { status: "PASS", required: false } },
      productionSmokePlan: { status: "PASS", required: false },
      reasons: ["AI review records were prepared against a different base SHA."],
    }),
    waitForDeployment: async (_client, mergeSha) => ({
      status: "PASS",
      deployment: { id: 14, sha: mergeSha, environmentUrl: "https://production.example.test" },
      details: "Exact-SHA deployment was observed.",
    }),
    smoke: async () => ({ status: "PASS", checks: [], details: "Production health smoke passed." }),
  });

  assert.equal(result.mergeBaseVerification.status, "BLOCKED");
  assert.equal(result.mergeBaseVerification.sha, CURRENT_BASE_SHA);
  assert.equal(result.mergeBaseVerification.expectedSha, null);
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.completed, false);
  assert.equal(fixture.issueState, "open");
  assert.notEqual(fixture.projectStatus, "Done");
});

test("merged recovery does not trust PR base fallback after its first-parent read fails", async () => {
  const fixture = createDeliveryClient({ alreadyMerged: true });
  const request = fixture.client.request;
  let mergeCommitReads = 0;
  fixture.client.request = async (path, options) => {
    if (path === "/repos/example/repo/commits/" + fixture.mergeSha) {
      mergeCommitReads += 1;
      return mergeCommitReads === 1
        ? { sha: fixture.mergeSha, parents: [] }
        : { sha: fixture.mergeSha, parents: [{ sha: CURRENT_BASE_SHA }, { sha: CURRENT_SHA }] };
    }
    return request(path, options);
  };
  let deploymentChecks = 0;
  let smokeChecks = 0;
  const result = await deliverPullRequest(fixture.client, 52, {
    issueNumber: 7,
    verify: verifyPullRequest,
    waitForDeployment: async (_client, mergeSha) => {
      deploymentChecks += 1;
      return {
        status: "PASS",
        deployment: { id: 14, sha: mergeSha, environmentUrl: "https://production.example.test" },
        details: "Exact-SHA deployment was observed.",
      };
    },
    smoke: async () => {
      smokeChecks += 1;
      return { status: "PASS", checks: [], details: "Production health smoke passed." };
    },
  });

  assert.ok(mergeCommitReads >= 2);
  assert.equal(deploymentChecks, 1);
  assert.equal(smokeChecks, 1);
  assert.equal(result.productionDeployment.status, "PASS");
  assert.equal(result.productionSmoke.status, "PASS");
  assert.equal(result.mergeBaseVerification.status, "BLOCKED");
  assert.equal(result.mergeBaseVerification.sha, CURRENT_BASE_SHA);
  assert.equal(result.mergeBaseVerification.expectedSha, null);
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.completed, false);
  assert.notEqual(fixture.projectStatus, "Done");
});

test("does not mark an issue Done when GitHub did not record a trusted delivery comment", async () => {
  const fixture = createDeliveryClient({ issueCommentActor: "different-account" });
  const result = await deliverPullRequest(fixture.client, 52, {
    issueNumber: 7,
    verify: async () => ({ decision: "READY_FOR_MERGE", currentSha: CURRENT_SHA, reasons: [] }),
    waitForDeployment: async (_client, mergeSha) => ({
      status: "PASS",
      deployment: { id: 14, sha: mergeSha, environmentUrl: "https://production.example.test" },
      details: "Exact-SHA deployment passed.",
    }),
    smoke: async () => ({ status: "PASS", checks: [], details: "Production smoke passed." }),
  });

  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.completed, false);
  assert.equal(result.issue.status, "BLOCKED");
  assert.equal(fixture.issueState, "open");
  assert.equal(fixture.projectStatus, "Blocked");
  assert.equal(fixture.calls.some(({ path, method, body }) =>
    path.endsWith("/issues/7") && method === "PATCH" && JSON.parse(body).state === "closed",
  ), false);
});

test("automatically merges a fully green PR and updates its issue only after Production passes", async () => {
  const fixture = createDeliveryClient();
  const result = await deliverPullRequest(fixture.client, 52, {
    issueNumber: 7,
    verify: async () => ({ decision: "READY_FOR_MERGE", currentSha: CURRENT_SHA, reasons: [] }),
    waitForDeployment: async (_client, mergeSha) => {
      assert.equal(mergeSha, fixture.mergeSha);
      return {
        status: "PASS",
        deployment: { id: 14, sha: mergeSha, environmentUrl: "https://production.example.test" },
        details: "Deployment READY for the exact merge SHA.",
      };
    },
    smoke: async (url) => ({
      status: "PASS",
      checks: [{ path: "/", statusCode: 200, finalUrl: url + "/" }],
      details: "Production root returned HTTP 200.",
    }),
  });

  assert.equal(result.decision, "DELIVERED");
  assert.equal(result.status, "PASS");
  assert.equal(result.candidateSha, CURRENT_SHA);
  assert.equal(result.mergeSha, fixture.mergeSha);
  assert.equal(result.completed, true);
  assert.equal(fixture.issueState, "closed");
  assert.equal(fixture.projectStatus, "Done");
  assert.ok(fixture.calls.some(({ path, method }) => path.endsWith("/pulls/52/merge") && method === "PUT"));
  const closeCall = fixture.calls.find(({ path, method }) => path.endsWith("/issues/7") && method === "PATCH");
  assert.equal(JSON.parse(closeCall.body).state, "closed");
  assert.ok(fixture.calls.some(({ path, method, body }) =>
    path.startsWith("/repos/example/repo/issues/52/comments") && method === "POST" && body.includes("agent-harness-delivery:v1"),
  ));
});

test("reconciles closing references added in the merge race before Production tracking", async () => {
  const fixture = createDeliveryClient({
    pullRequestBody: "Part of #7",
    bodyAfterMerge: "Closes: #7",
  });
  const result = await deliverPullRequest(fixture.client, 52, {
    verify: async () => ({ decision: "READY_FOR_MERGE", currentSha: CURRENT_SHA, reasons: [] }),
    waitForDeployment: async () => ({
      status: "FAIL",
      deployment: { id: 14, sha: fixture.mergeSha, state: "failure" },
      details: "Vercel deployment failed during build.",
    }),
  });

  assert.equal(result.decision, "DELIVERY_FAILED");
  assert.equal(result.completed, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].issue, 7);
  assert.equal(fixture.issueState, "open");
  assert.equal(fixture.projectStatus, "Blocked");
});

test("retries verified delivery when Project status propagation is delayed", async () => {
  const fixture = createDeliveryClient({ projectUpdateDelayReads: 1 });
  const verify = async (_client, _number, { allowMerged } = {}) => allowMerged
    ? { decision: "VERIFIED_MERGE", currentSha: CURRENT_SHA, pullRequest: { baseSha: CURRENT_BASE_SHA }, reasons: [] }
    : { decision: "READY_FOR_MERGE", currentSha: CURRENT_SHA, pullRequest: { baseSha: CURRENT_BASE_SHA }, reasons: [] };
  const waitForDeployment = async (_client, mergeSha) => ({
    status: "PASS",
    deployment: { id: 14, sha: mergeSha, environmentUrl: "https://production.example.test" },
    details: "Exact-SHA deployment passed.",
  });
  const smoke = async () => ({ status: "PASS", checks: [], details: "Production smoke passed." });

  const first = await deliverPullRequest(fixture.client, 52, { issueNumber: 7, verify, waitForDeployment, smoke });
  assert.equal(first.decision, "BLOCKED");
  assert.equal(fixture.issueState, "open");

  const resumed = await deliverPullRequest(fixture.client, 52, { issueNumber: 7, verify, waitForDeployment, smoke });
  assert.equal(resumed.decision, "DELIVERED", JSON.stringify(resumed));
  assert.equal(fixture.issueState, "closed");
  assert.equal(fixture.projectStatus, "Done");
});

test("application-flow delivery requires and runs an explicit affected Production smoke path", async () => {
  const missingPathFixture = createDeliveryClient();
  const noPlanVerification = async () => ({
    decision: "READY_FOR_MERGE",
    currentSha: CURRENT_SHA,
    fileScope: { files: ["src/app/products/page.tsx"] },
    reasons: [],
  });
  const missingPath = await deliverPullRequest(missingPathFixture.client, 52, { verify: noPlanVerification });
  assert.equal(missingPath.stage, "production-smoke-plan");
  assert.equal(missingPath.merged, false);
  assert.equal(missingPathFixture.calls.some(({ path }) => path.endsWith("/pulls/52/merge")), false);

  const verification = async () => ({
    decision: "READY_FOR_MERGE",
    currentSha: CURRENT_SHA,
    fileScope: { files: ["src/app/products/page.tsx"] },
    productionSmokePlan: {
      status: "PASS",
      required: true,
      paths: ["/products"],
      expectations: [{ path: "/products", expectedText: "Products" }],
    },
    reasons: [],
  });
  const fixture = createDeliveryClient();
  let smokePaths = null;
  let smokeExpectations = null;
  const delivered = await deliverPullRequest(fixture.client, 52, {
    verify: verification,
    waitForDeployment: async (_client, mergeSha) => ({
      status: "PASS",
      deployment: { id: 14, sha: mergeSha, environmentUrl: "https://production.example.test" },
      details: "Exact-SHA deployment passed.",
    }),
    smoke: async (_url, options) => {
      smokePaths = options.paths;
      smokeExpectations = options.expectations;
      return { status: "PASS", checks: [], details: "Affected product flow passed." };
    },
  });
  assert.equal(delivered.decision, "DELIVERED");
  assert.deepEqual(smokePaths, ["/products"]);
  assert.deepEqual(smokeExpectations, [{ path: "/products", expectedText: "Products" }]);

  for (const configuredPath of ["/catalog", "//elsewhere.test/catalog"]) {
    const invalidFixture = createDeliveryClient();
    const invalid = await deliverPullRequest(invalidFixture.client, 52, {
      verify: verification,
      productionSmokePaths: [configuredPath],
    });
    assert.equal(invalid.stage, "production-smoke-plan");
    assert.equal(invalidFixture.calls.some(({ path }) => path.endsWith("/pulls/52/merge")), false);
  }
});

test("failed Production verification is recorded and cannot close or complete a tracked issue", async () => {
  const fixture = createDeliveryClient();
  const result = await deliverPullRequest(fixture.client, 52, {
    issueNumber: 7,
    verify: async () => ({ decision: "READY_FOR_MERGE", currentSha: CURRENT_SHA, reasons: [] }),
    waitForDeployment: async () => ({
      status: "FAIL",
      deployment: { id: 14, sha: fixture.mergeSha, state: "failure" },
      details: "Vercel deployment failed during build.",
    }),
    smoke: async () => {
      throw new Error("Smoke must not run after a failed deployment.");
    },
  });

  assert.equal(result.decision, "DELIVERY_FAILED");
  assert.equal(result.status, "FAIL");
  assert.equal(result.completed, false);
  assert.equal(fixture.issueState, "open");
  assert.equal(fixture.projectStatus, "Blocked");
  assert.equal(fixture.calls.some(({ path, method, body }) =>
    path.endsWith("/issues/7") && method === "PATCH" && JSON.parse(body).state === "closed",
  ), false);
  assert.ok(fixture.calls.some(({ path, method }) => path.startsWith("/repos/example/repo/issues/7/comments") && method === "POST"));
  assert.ok(fixture.calls.some(({ path, method }) => path.endsWith("/pulls/52/merge") && method === "PUT"));
});

test("resumed delivery reopens a previously auto-closed issue when Production verification fails", async () => {
  const fixture = createDeliveryClient({ alreadyMerged: true, initialIssueState: "closed" });
  const result = await deliverPullRequest(fixture.client, 52, {
    issueNumber: 7,
    verify: async () => ({ decision: "VERIFIED_MERGE", currentSha: CURRENT_SHA, reasons: [] }),
    waitForDeployment: async () => ({
      status: "FAIL",
      deployment: { id: 14, sha: fixture.mergeSha, state: "failure" },
      details: "Vercel deployment failed during build.",
    }),
  });

  assert.equal(result.decision, "DELIVERY_FAILED");
  assert.equal(result.completed, false);
  assert.equal(fixture.issueState, "open");
  assert.equal(fixture.projectStatus, "Blocked");
  assert.ok(fixture.calls.some(({ path, method, body }) =>
    path.endsWith("/issues/7") && method === "PATCH" && JSON.parse(body).state === "open",
  ));
  assert.equal(fixture.calls.some(({ path, method }) => path.endsWith("/pulls/52/merge") && method === "PUT"), false);
});

test("resumed delivery recognizes an exact PR commit as the issue closer", async () => {
  const fixture = createDeliveryClient({
    alreadyMerged: true,
    initialIssueState: "closed",
    pullRequestBody: "Part of #7",
    pullRequestCommitMessages: ["Closes #7 in the merged change"],
    closedByPullRequest: false,
    closedByCommitInPullRequest: true,
  });
  const result = await deliverPullRequest(fixture.client, 52, {
    verify: async () => ({ decision: "VERIFIED_MERGE", currentSha: CURRENT_SHA, reasons: [] }),
    waitForDeployment: async () => ({ status: "FAIL", details: "Production failed." }),
  });

  assert.equal(result.decision, "DELIVERY_FAILED");
  assert.equal(result.completed, false);
  assert.equal(result.issues[0].issue, 7);
  assert.equal(fixture.issueState, "open");
  assert.equal(fixture.projectStatus, "Blocked");
});

test("merged recovery infers every closing issue without --issue and blocks them after Production failure", async () => {
  const fixture = createMultiIssueMergedDeliveryClient();
  const result = await deliverPullRequest(fixture.client, 52, {
    verify: async () => ({ decision: "VERIFIED_MERGE", currentSha: CURRENT_SHA, reasons: [] }),
    waitForDeployment: async () => ({
      status: "FAIL",
      deployment: { id: 14, sha: fixture.mergeSha, state: "failure" },
      details: "Vercel deployment failed during build.",
    }),
  });

  assert.equal(result.decision, "DELIVERY_FAILED");
  assert.equal(result.completed, false);
  assert.equal(result.issue.status, "PASS");
  assert.deepEqual(result.issues.map((outcome) => outcome.issue), [7, 8]);
  assert.ok(result.issues.every((outcome) => outcome.status === "PASS"));
  for (const issueNumber of [7, 8]) {
    assert.equal(fixture.issueStates.get(issueNumber), "open");
    assert.equal(fixture.projectStatuses.get(issueNumber), "Blocked");
    assert.ok(fixture.calls.some(({ path, method, body }) =>
      path.endsWith("/issues/" + issueNumber) && method === "PATCH" && JSON.parse(body).state === "open",
    ));
    assert.equal(fixture.calls.some(({ path, method, body }) =>
      path.endsWith("/issues/" + issueNumber) && method === "PATCH" && JSON.parse(body).state === "closed",
    ), false);
  }
  assert.equal(fixture.calls.some(({ path, method }) => path.endsWith("/pulls/52/merge") && method === "PUT"), false);
});

test("merged recovery fails closed when PR commit history cannot be read", async () => {
  const fixture = createDeliveryClient({ alreadyMerged: true, initialIssueState: "closed" });
  const request = fixture.client.request;
  fixture.client.request = async (path, options) => {
    if (path.startsWith("/repos/example/repo/pulls/52/commits")) {
      throw new Error("GitHub history unavailable");
    }
    return request(path, options);
  };
  let deploymentChecks = 0;
  const result = await deliverPullRequest(fixture.client, 52, {
    verify: async () => ({ decision: "VERIFIED_MERGE", currentSha: CURRENT_SHA, reasons: [] }),
    waitForDeployment: async () => { deploymentChecks += 1; return { status: "FAIL" }; },
  });

  assert.equal(result.stage, "commit-history");
  assert.equal(result.merged, true);
  assert.equal(result.completed, undefined);
  assert.equal(deploymentChecks, 0);
  assert.equal(fixture.issueState, "closed");
  assert.equal(fixture.projectStatus, "Done");
  assert.match(result.reasons[0], /complete commit history is unavailable/);
});

test("failed retry preserves a closed issue with prior exact-SHA Production pass evidence", async () => {
  const fixture = createDeliveryClient({
    alreadyMerged: true,
    initialIssueState: "closed",
    previouslyVerifiedDelivery: true,
    closedByPullRequest: false,
  });
  const result = await deliverPullRequest(fixture.client, 52, {
    issueNumber: 7,
    verify: async () => ({ decision: "VERIFIED_MERGE", currentSha: CURRENT_SHA, reasons: [] }),
    waitForDeployment: async () => ({
      status: "FAIL",
      deployment: { id: 14, sha: fixture.mergeSha, state: "failure" },
      details: "A later deployment status read failed.",
    }),
  });

  assert.equal(result.decision, "DELIVERY_FAILED");
  assert.equal(result.completed, false);
  assert.equal(result.issue.status, "BLOCKED");
  assert.equal(fixture.issueState, "closed");
  assert.equal(fixture.projectStatus, "Done");
  assert.equal(fixture.calls.some(({ path, method, body }) =>
    path.endsWith("/issues/7") && method === "PATCH" && JSON.parse(body).state === "open",
  ), false);
});

test("ignores prior Production evidence posted by someone other than the PR author", async () => {
  const fixture = createDeliveryClient({
    alreadyMerged: true,
    initialIssueState: "closed",
    previouslyVerifiedDelivery: true,
    previouslyVerifiedDeliveryAuthor: "untrusted-writer",
    closedByPullRequest: true,
  });
  const result = await deliverPullRequest(fixture.client, 52, {
    issueNumber: 7,
    verify: async () => ({ decision: "VERIFIED_MERGE", currentSha: CURRENT_SHA, reasons: [] }),
    waitForDeployment: async () => ({ status: "FAIL", details: "The exact Production deployment failed." }),
  });

  assert.equal(result.decision, "DELIVERY_FAILED");
  assert.equal(result.completed, false);
  assert.equal(result.issue.status, "PASS");
  assert.equal(fixture.issueState, "open");
  assert.equal(fixture.projectStatus, "Blocked");
});

test("resumed delivery does not reopen an issue closed independently of the merged PR", async () => {
  const fixture = createDeliveryClient({
    alreadyMerged: true,
    initialIssueState: "closed",
    closedByPullRequest: false,
  });
  const result = await deliverPullRequest(fixture.client, 52, {
    issueNumber: 7,
    verify: async () => ({ decision: "VERIFIED_MERGE", currentSha: CURRENT_SHA, reasons: [] }),
    waitForDeployment: async () => ({
      status: "FAIL",
      deployment: { id: 14, sha: fixture.mergeSha, state: "failure" },
      details: "Vercel deployment failed during build.",
    }),
  });

  assert.equal(result.decision, "DELIVERY_FAILED");
  assert.equal(result.completed, false);
  assert.equal(result.issue.status, "BLOCKED");
  assert.equal(fixture.issueState, "closed");
  assert.equal(fixture.calls.some(({ path, method, body }) =>
    path.endsWith("/issues/7") && method === "PATCH" && JSON.parse(body).state === "open",
  ), false);
  assert.equal(fixture.calls.some(({ path, method }) => path.endsWith("/pulls/52/merge") && method === "PUT"), false);
});

test("resumed delivery preserves a later independently closed issue despite an earlier PR closure", async () => {
  const fixture = createDeliveryClient({
    alreadyMerged: true,
    initialIssueState: "closed",
    closedByPullRequest: true,
    laterIndependentClosure: true,
  });
  const result = await deliverPullRequest(fixture.client, 52, {
    issueNumber: 7,
    verify: async () => ({ decision: "VERIFIED_MERGE", currentSha: CURRENT_SHA, reasons: [] }),
    waitForDeployment: async () => ({ status: "FAIL", details: "Production failed." }),
  });

  assert.equal(result.decision, "DELIVERY_FAILED");
  assert.equal(result.completed, false);
  assert.equal(result.issue.status, "BLOCKED");
  assert.equal(fixture.issueState, "closed");
  assert.equal(fixture.projectStatus, "Done");
  assert.equal(fixture.calls.some(({ path, method, body }) =>
    path.endsWith("/issues/7") && method === "PATCH" && JSON.parse(body).state === "open",
  ), false);
});

test("unreadable prior delivery evidence never reopens a closed issue", async () => {
  const fixture = createDeliveryClient({
    alreadyMerged: true,
    initialIssueState: "closed",
    closedByPullRequest: true,
    issueCommentsReadError: true,
  });
  const result = await deliverPullRequest(fixture.client, 52, {
    issueNumber: 7,
    verify: async () => ({ decision: "VERIFIED_MERGE", currentSha: CURRENT_SHA, reasons: [] }),
    waitForDeployment: async () => ({ status: "FAIL", details: "Production failed." }),
  });

  assert.equal(result.decision, "DELIVERY_FAILED");
  assert.equal(result.completed, false);
  assert.equal(result.issue.status, "BLOCKED");
  assert.equal(fixture.issueState, "closed");
  assert.equal(fixture.projectStatus, "Done");
  assert.equal(fixture.calls.some(({ path, method, body }) =>
    path.endsWith("/issues/7") && method === "PATCH" && JSON.parse(body).state === "open",
  ), false);
});

test("delivery requires an exact PR-to-issue link and blocks GitHub closing keywords", async () => {
  let verificationCalls = 0;
  const unrelated = createDeliveryClient({ pullRequestBody: "Part of #8" });
  const unrelatedResult = await deliverPullRequest(unrelated.client, 52, {
    issueNumber: 7,
    verify: async () => { verificationCalls += 1; return { decision: "READY_FOR_MERGE", currentSha: CURRENT_SHA }; },
  });
  assert.equal(unrelatedResult.stage, "issue-preflight");
  assert.equal(verificationCalls, 0);
  assert.equal(unrelated.calls.some(({ path }) => path.endsWith("/pulls/52/merge")), false);

  const closing = createDeliveryClient({ pullRequestBody: "Closes #7" });
  const closingResult = await deliverPullRequest(closing.client, 52, {
    issueNumber: 7,
    verify: async () => ({ decision: "READY_FOR_MERGE", currentSha: CURRENT_SHA, reasons: [] }),
  });
  assert.equal(closingResult.stage, "issue-preflight");
  assert.equal(closing.calls.some(({ path }) => path.endsWith("/pulls/52/merge")), false);
  assert.equal(closing.projectStatus, "Review");

  const untrackedClosing = createDeliveryClient({ pullRequestBody: "Closes #29" });
  const untrackedClosingResult = await deliverPullRequest(untrackedClosing.client, 52, {
    verify: async () => { verificationCalls += 1; return { decision: "READY_FOR_MERGE", currentSha: CURRENT_SHA }; },
  });
  assert.equal(untrackedClosingResult.stage, "issue-preflight");
  assert.equal(untrackedClosingResult.merged, false);
  assert.equal(untrackedClosing.calls.some(({ path }) => path.endsWith("/pulls/52/merge")), false);

  const closingCommit = createDeliveryClient({ pullRequestCommitMessages: ["Fixes #29 from the migration"] });
  const closingCommitResult = await deliverPullRequest(closingCommit.client, 52, {
    verify: async () => ({ decision: "READY_FOR_MERGE", currentSha: CURRENT_SHA, reasons: [] }),
  });
  assert.equal(closingCommitResult.stage, "commit-history");
  assert.equal(closingCommitResult.merged, false);
  assert.equal(closingCommit.calls.some(({ path }) => path.endsWith("/pulls/52/merge")), false);
});

test("a blocked pre-merge gate prevents the merge API and Production side effects", async () => {
  const fixture = createDeliveryClient();
  let productionChecks = 0;
  const result = await deliverPullRequest(fixture.client, 52, {
    verify: async () => ({
      decision: "BLOCKED",
      currentSha: CURRENT_SHA,
      reasons: ["Two independent reviews are required."],
    }),
    waitForDeployment: async () => { productionChecks += 1; return { status: "PASS" }; },
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.stage, "pre-merge-gates");
  assert.equal(result.merged, false);
  assert.equal(productionChecks, 0);
  assert.equal(fixture.calls.some(({ path }) => path.endsWith("/pulls/52/merge")), false);
});
