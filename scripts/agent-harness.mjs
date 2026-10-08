import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2026-03-10";
const PROJECT_NUMBER = Number(process.env.AGENT_HARNESS_PROJECT_NUMBER ?? 1);
const PROJECT_OWNER = process.env.AGENT_HARNESS_PROJECT_OWNER;
const STATUS_FIELD = "Status";
const DONE_STATUS = "Done";

const PROJECT_QUERY = `
  query($login: String!, $number: Int!, $after: String) {
    user(login: $login) {
      projectV2(number: $number) {
        id
        title
        url
        fields(first: 100) {
          nodes {
            __typename
            ... on ProjectV2FieldCommon { id name }
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name color description }
            }
          }
        }
        items(first: 100, archivedStates: [ARCHIVED, NOT_ARCHIVED], after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isArchived
            content {
              __typename
              ... on Issue {
                id number title state url body
                labels(first: 30) { nodes { name } }
                assignees(first: 20) { nodes { login } }
                parent { id number title state url body }
                subIssues(first: 100) {
                  nodes { id number title state url body }
                  pageInfo { hasNextPage endCursor }
                }
                trackedIssues(first: 100) {
                  nodes { id number title state url body }
                  pageInfo { hasNextPage endCursor }
                }
                trackedInIssues(first: 100) {
                  nodes { id number title state url body }
                  pageInfo { hasNextPage endCursor }
                }
              }
            }
            fieldValues(first: 100) {
              nodes {
                __typename
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2SingleSelectField { id name } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const UPDATE_FIELD_MUTATION = `
  mutation($input: UpdateProjectV2ItemFieldValueInput!) {
    updateProjectV2ItemFieldValue(input: $input) {
      projectV2Item { id }
    }
  }
`;

const ADD_ITEM_MUTATION = `
  mutation($input: AddProjectV2ItemByIdInput!) {
    addProjectV2ItemById(input: $input) {
      item { id }
    }
  }
`;

const UNARCHIVE_ITEM_MUTATION = `
  mutation($input: UnarchiveProjectV2ItemInput!) {
    unarchiveProjectV2Item(input: $input) {
      item { id isArchived }
    }
  }
`;

function parseIssueNumber(value) {
  const issueNumber = Number(value);
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
    throw new Error(`Invalid issue number: ${value}`);
  }
  return issueNumber;
}

export function repositoryFromRemote(remoteUrl) {
  const match = remoteUrl.match(
    /github\.com[:/]([^/]+)\/([^/?#]+?)(?:\.git)?(?:[?#].*)?$/i,
  );
  if (!match) {
    throw new Error(`Could not read owner/repository from origin: ${remoteUrl}`);
  }
  return { owner: match[1], repo: match[2] };
}

function currentRepository() {
  const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  return repositoryFromRemote(remoteUrl);
}

export function githubToken({ env = process.env, execute = execFileSync } = {}) {
  const configured =
    env.GITHUB_PAT_CLASSIC_CODEX ||
    env.GH_TOKEN ||
    env.GITHUB_TOKEN;
  if (configured) return configured;

  const runQuietly = (command, args, options) => {
    try {
      return execute(command, args, options).trim();
    } catch {
      // Authentication helper errors can contain sensitive values. Never relay them.
      return "";
    }
  };

  const ghToken = runQuietly("gh", ["auth", "token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env,
  });
  if (ghToken) return ghToken;

  const credentials = runQuietly("git", ["credential", "fill"], {
      encoding: "utf8",
      input: "protocol=https\nhost=github.com\n\n",
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...env, GIT_TERMINAL_PROMPT: "0" },
  });
  const password = credentials.match(/^password=(.+)$/m)?.[1];
  if (password) return password;

  throw new Error(
    "No GitHub token found. Run gh auth login, set a supported token environment variable, or configure Git credential fill.",
  );
}

function createClient() {
  const repository = currentRepository();
  const token = githubToken();
  const projectOwner = PROJECT_OWNER || repository.owner;

  async function request(path, options = {}) {
    const response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const reason = payload?.message || response.statusText;
      throw new Error(`${options.method || "GET"} ${path} failed (${response.status}): ${reason}`);
    }
    return payload;
  }

  async function graphql(query, variables = {}) {
    const payload = await request("/graphql", {
      method: "POST",
      body: JSON.stringify({ query, variables }),
    });
    if (payload.errors?.length) {
      throw new Error(`GitHub GraphQL failed: ${payload.errors.map((error) => error.message).join("; ")}`);
    }
    return payload.data;
  }

  return { ...repository, projectOwner, projectNumber: PROJECT_NUMBER, request, graphql };
}

async function readIssue(client, issueNumber) {
  return client.request(`/repos/${client.owner}/${client.repo}/issues/${issueNumber}`);
}

async function readProjectItem(client, issue) {
  let after = null;
  let project;
  let fields = [];
  let item = null;

  do {
    const data = await client.graphql(PROJECT_QUERY, {
      login: client.projectOwner,
      number: client.projectNumber,
      after,
    });
    const page = data.user?.projectV2?.items;
    if (!data.user?.projectV2) {
      throw new Error(
        `Project #${client.projectNumber} for ${client.projectOwner} was not accessible. Check project permissions and owner settings.`,
      );
    }
    project ??= data.user.projectV2;
    fields = project.fields.nodes;
    item = page.nodes.find((candidate) => projectItemMatchesIssue(candidate, issue)) || item;
    if (item || !page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  } while (after);

  return { project, fields, item };
}

export async function pagedRest(client, path) {
  const values = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await client.request(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    if (!Array.isArray(result)) return result;
    values.push(...result);
    if (result.length < 100) return values;
    if (page === 10) {
      throw new Error(`Pagination limit reached for ${path}; results may be incomplete.`);
    }
  }
  return values;
}

function projectItemFields(item) {
  if (!item) return {};
  return Object.fromEntries(
    item.fieldValues.nodes
      .filter((value) => value.field?.name)
      .map((value) => [value.field.name, value.name]),
  );
}

export function projectItemMatchesIssue(item, issue) {
  return Boolean(issue.node_id && item.content?.id === issue.node_id);
}

export function parseWorktreeBranches(porcelain = "") {
  return [...new Set(
    [...porcelain.matchAll(/^branch refs\/heads\/(.+)$/gm)].map((match) => match[1]),
  )];
}

function localGitContext(issue) {
  const branchOutput = execFileSync("git", ["branch", "--format=%(refname:short)"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const worktreeOutput = execFileSync("git", ["worktree", "list", "--porcelain"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const currentBranch = execFileSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim() || null;
  const worktreeBranches = parseWorktreeBranches(worktreeOutput);
  const localBranches = [...new Set([
    ...branchOutput.split(/\r?\n/).map((branch) => branch.trim()).filter(Boolean),
    ...worktreeBranches,
  ])];
  return {
    currentBranch,
    localBranchCandidates: findBranchCandidates(localBranches, issue),
    checkedOutBranchCandidates: findBranchCandidates(worktreeBranches, issue),
  };
}

function issueSummary(issue) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    url: issue.html_url,
    body: issue.body || "",
    labels: (issue.labels || []).map((label) => label.name),
    assignees: (issue.assignees || []).map((assignee) => assignee.login),
  };
}

export function extractAcceptanceCriteria(body = "") {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    /^#{1,6}\s+(acceptance criteria|definition of done)\s*$/i.test(line.trim()),
  );
  if (start < 0) return null;
  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s+/.test(line)) break;
    section.push(line);
  }
  const content = section.join("\n").trim();
  return content || null;
}

export function buildReadiness({
  issue,
  item,
  blockedBy,
  dependencyReadAvailable,
  commentsReadAvailable = true,
  resumeContextAvailable = true,
  projectNumber = PROJECT_NUMBER,
}) {
  const openBlockers = (blockedBy || []).filter((dependency) => dependency.state === "open");
  const projectStatus = projectItemFields(item)[STATUS_FIELD] || null;
  const acceptanceCriteriaPresent = Boolean(extractAcceptanceCriteria(issue.body || ""));
  const reasons = [];
  const warnings = [];
  if (issue.state !== "open") reasons.push("issue is closed");
  if (!item) reasons.push("issue is not on Project #" + projectNumber);
  if (item?.isArchived) reasons.push("issue is archived on Project #" + projectNumber + "; restore the card before starting");
  if (!dependencyReadAvailable) reasons.push("blocked-by relationships could not be read");
  if (!acceptanceCriteriaPresent) reasons.push("acceptance criteria are missing");
  if (!commentsReadAvailable) {
    warnings.push("issue comments could not be read; retry or inspect the issue before relying on missing context");
  }
  if (!resumeContextAvailable) {
    warnings.push("PR or branch history is incomplete; do not create a new branch until recovery checks succeed");
  }
  if (openBlockers.length) {
    reasons.push("blocked by open issue(s): " + openBlockers.map((dependency) => "#" + dependency.number).join(", "));
  }
  return {
    ready: reasons.length === 0,
    reasons,
    warnings,
    openBlockers: openBlockers.map(({ number, title, html_url }) => ({ number, title, url: html_url })),
    acceptanceCriteriaPresent,
    projectStatus,
    recommendedStatus: reasons.length
      ? "Blocked"
      : ["In Progress", "Review"].includes(projectStatus)
        ? projectStatus
        : "Ready",
  };
}

export function planIssueRecovery({
  issueState,
  projectStatus = null,
  pullRequests = [],
  candidateBranches = [],
  pullRequestHistoryAvailable = true,
  branchHistoryAvailable = true,
}) {
  const statusToPreserve = projectStatus || null;
  const openPullRequests = [...new Map(
    pullRequests
      .filter((pullRequest) => pullRequest.state === "open")
      .map((pullRequest) => [pullRequest.number, pullRequest]),
  ).values()];
  const branches = [...new Set(candidateBranches || [])];
  const base = {
    statusToPreserve,
    pullRequestHistoryAvailable,
    branchHistoryAvailable,
    createBranch: false,
    resetExistingWork: false,
  };

  if (issueState !== "open") {
    return { ...base, action: "do-not-start", reason: "issue is closed" };
  }
  if (openPullRequests.length === 1) {
    const pullRequest = openPullRequests[0];
    return {
      ...base,
      action: "resume-open-pull-request",
      pullRequest: {
        number: pullRequest.number,
        url: pullRequest.url,
        branch: pullRequest.branch || null,
        draft: pullRequest.draft ?? null,
      },
      reason: "open PR #" + pullRequest.number + " already tracks this issue",
    };
  }
  if (openPullRequests.length > 1) {
    return {
      ...base,
      action: "resolve-existing-pull-requests",
      pullRequests: openPullRequests.map(({ number, url, branch }) => ({ number, url, branch: branch || null })),
      reason: "multiple open PRs already reference this issue; inspect and resume the correct one",
    };
  }
  if (branches.length === 1) {
    return {
      ...base,
      action: "resume-existing-branch",
      branch: branches[0],
      reason: "an existing branch matches this issue",
    };
  }
  if (branches.length > 1) {
    return {
      ...base,
      action: "resolve-existing-branches",
      branches,
      reason: "multiple branches match this issue; inspect them before choosing one",
    };
  }
  if (!pullRequestHistoryAvailable || !branchHistoryAvailable) {
    return {
      ...base,
      action: "blocked",
      reason: "existing PR or branch history is incomplete; retry discovery before creating a branch",
    };
  }
  return {
    ...base,
    action: "start-new-work",
    createBranch: true,
    reason: "no existing PR or matching branch was found",
  };
}

export const VERIFICATION_STATES = Object.freeze(["PASS", "FAIL", "NOT RUN", "BLOCKED"]);

export function verificationEvidence({ status, command, details }) {
  if (!VERIFICATION_STATES.includes(status)) {
    throw new Error("Invalid verification status: " + status);
  }
  if (!command?.trim()) throw new Error("Verification evidence requires the exact command or check source.");
  if (!details?.trim()) throw new Error("Verification evidence requires a result or limitation.");
  return { status, command: command.trim(), details: details.trim() };
}

export function summarizeGitHubChecks({
  checkRuns = [],
  statuses = [],
  available = true,
  command = "GitHub commit check-runs and commit status",
}) {
  if (!available) {
    return verificationEvidence({
      status: "BLOCKED",
      command,
      details: "GitHub check results could not be read; CI state is unknown.",
    });
  }
  const outcomes = [
    ...checkRuns.map((check) => ({
      name: check.name || "unnamed check",
      state: check.status === "completed" ? check.conclusion : check.status,
    })),
    ...statuses.map((check) => ({
      name: check.context || "unnamed status",
      state: check.state,
    })),
  ];
  if (!outcomes.length) {
    return verificationEvidence({
      status: "NOT RUN",
      command,
      details: "No GitHub check runs or commit statuses were published; this is not passing CI evidence.",
    });
  }
  const failures = outcomes.filter(({ state }) =>
    ["failure", "error", "cancelled", "timed_out", "action_required"].includes(state),
  );
  if (failures.length) {
    return verificationEvidence({
      status: "FAIL",
      command,
      details: "Failed checks: " + failures.map(({ name, state }) => name + " (" + state + ")").join(", ") + ".",
    });
  }
  const pending = outcomes.filter(({ state }) => state !== "success");
  if (pending.length) {
    return verificationEvidence({
      status: "BLOCKED",
      command,
      details: "Checks are pending or need interpretation: " + pending.map(({ name, state }) => name + " (" + (state || "unknown") + ")").join(", ") + ".",
    });
  }
  return verificationEvidence({
    status: "PASS",
    command,
    details: outcomes.length + " published check result(s) completed successfully.",
  });
}

export function buildReleaseRequirements(files, { available = true } = {}) {
  if (!available) {
    return {
      status: "BLOCKED",
      migrationFiles: null,
      dependencyManifests: null,
      details: "Changed files could not be read; migration and production-dependency scope is unknown.",
      deploymentOrder: [],
    };
  }
  const names = files.map((file) => typeof file === "string" ? file : file.filename).filter(Boolean);
  const migrationFiles = names.filter((name) => /(^|\/)supabase\/migrations\/[^/]+\.sql$/i.test(name));
  const dependencyManifests = names.filter((name) => /(^|\/)(package\.json|package-lock\.json)$/i.test(name));
  const deploymentOrder = [];
  if (migrationFiles.length) {
    deploymentOrder.push(
      "Verify migration compatibility with the deployed application, existing data, and database access policies.",
      "If the new application requires this schema, apply and verify a backward-compatible migration before merging; use an expand/contract sequence for breaking changes.",
      "Merge to main only after the remaining database steps are explicit; the Vercel Git integration then performs the Production deployment.",
      "After the automatic deployment, verify the migration history and affected runtime flow.",
    );
  }
  if (dependencyManifests.length) {
    deploymentOrder.push(
      "Compare production dependencies in dependencies (not only devDependencies), verify runtime/framework compatibility and lockfile alignment, and report any unresolved risk before merge.",
    );
  }
  return {
    status: migrationFiles.length || dependencyManifests.length ? "NOT RUN" : "PASS",
    migrationFiles,
    dependencyManifests,
    details: migrationFiles.length || dependencyManifests.length
      ? "Release compatibility and ordering require an explicit PR assessment."
      : "No database migration or dependency manifest changes were found.",
    deploymentOrder,
  };
}

function reviewField(body, label) {
  const match = body.match(new RegExp("^\\s*(?:[-*]\\s*)?" + label + "\\s*:\\s*(.+?)\\s*$", "im"));
  return match?.[1]?.trim() || null;
}

export function validateIndependentReview({
  pullRequestAuthor,
  headSha,
  reviews = [],
  available = true,
}) {
  if (!available || !pullRequestAuthor || !/^[a-f0-9]{40}$/i.test(headSha || "")) {
    return {
      status: "BLOCKED",
      reviewer: null,
      reviewedSha: null,
      findingsBySeverity: null,
      fixesApplied: null,
      unresolvedFindings: null,
      details: "Review records or the current PR head SHA could not be verified.",
    };
  }
  const submitted = reviews.filter(
    (review) => review.user?.login && !["PENDING", "DISMISSED"].includes(review.state),
  );
  if (!submitted.length) {
    return {
      status: "NOT RUN",
      reviewer: null,
      reviewedSha: null,
      findingsBySeverity: null,
      fixesApplied: null,
      unresolvedFindings: null,
      details: "No submitted GitHub pull request review is available; text in the PR body is not independent-review evidence.",
    };
  }
  const independent = submitted.filter(
    (review) => review.user.login.toLowerCase() !== (pullRequestAuthor || "").toLowerCase(),
  );
  if (!independent.length) {
    return {
      status: "FAIL",
      reviewer: null,
      reviewedSha: null,
      findingsBySeverity: null,
      fixesApplied: null,
      unresolvedFindings: null,
      details: "Only the PR author has submitted a review; self-review does not satisfy independent review.",
    };
  }
  const currentShaReviews = independent
    .filter((review) => review.commit_id === headSha)
    .sort((left, right) => (right.submitted_at || "").localeCompare(left.submitted_at || ""));
  if (!currentShaReviews.length) {
    return {
      status: "FAIL",
      reviewer: null,
      reviewedSha: null,
      findingsBySeverity: null,
      fixesApplied: null,
      unresolvedFindings: null,
      details: "Independent review exists only for a different commit; review the exact current PR head SHA.",
    };
  }
  const latest = currentShaReviews[0];
  const body = latest.body || "";
  const reviewer = reviewField(body, "Reviewer");
  const reviewedSha = reviewField(body, "Reviewed SHA");
  const findingsBySeverity = Object.fromEntries(
    ["Critical", "High", "Medium", "Low"].map((severity) => [severity, reviewField(body, severity)]),
  );
  const fixesApplied = reviewField(body, "Fixes applied");
  const unresolvedFindings = reviewField(body, "Unresolved findings");
  const reviewerMatches = reviewer?.replace(/^@/, "").toLowerCase() === latest.user.login.toLowerCase();
  const shaMatches = reviewedSha?.toLowerCase() === headSha.toLowerCase();
  const complete =
    reviewerMatches &&
    shaMatches &&
    Object.values(findingsBySeverity).every(Boolean) &&
    Boolean(fixesApplied) &&
    Boolean(unresolvedFindings);
  return {
    status: complete ? "PASS" : "FAIL",
    reviewer: latest.user.login,
    reviewedSha: reviewedSha || null,
    findingsBySeverity,
    fixesApplied,
    unresolvedFindings,
    details: complete
      ? "Independent review by @" + latest.user.login + " covers the current head SHA."
      : "The latest independent review on the current SHA is missing or mismatches required summary fields.",
  };
}

export function statusTransitionBlockers(status, readiness, pullRequests = [], recoveryPlan = null) {
  const blockers = [];
  if (["Ready", "In Progress"].includes(status) && !readiness.ready) {
    blockers.push(...readiness.reasons);
  }
  const statusOrder = ["Backlog", "Ready", "In Progress", "Review", "Done"];
  const previousOrder = statusOrder.indexOf(recoveryPlan?.statusToPreserve);
  const requestedOrder = statusOrder.indexOf(status);
  const existingWork =
    recoveryPlan?.action === "resume-open-pull-request"
      ? "open PR #" + recoveryPlan.pullRequest.number
      : recoveryPlan?.action === "resume-existing-branch"
        ? "branch " + recoveryPlan.branch
        : recoveryPlan?.action === "resolve-existing-pull-requests"
          ? "multiple open PRs"
          : recoveryPlan?.action === "resolve-existing-branches"
            ? "multiple matching branches"
        : null;
  if (
    existingWork &&
    previousOrder >= 0 &&
    requestedOrder >= 0 &&
    requestedOrder < previousOrder
  ) {
    blockers.push(
      existingWork + " already tracks this issue; preserve Project Status \"" +
      recoveryPlan.statusToPreserve + "\" and resume the existing work",
    );
  }
  if (
    status === "In Progress" &&
    ["blocked", "resolve-existing-pull-requests", "resolve-existing-branches"].includes(recoveryPlan?.action) &&
    recoveryPlan.statusToPreserve !== "In Progress"
  ) {
    blockers.push(recoveryPlan.reason);
  }
  if (status === "Review" && !pullRequests.some((pr) => pr.state === "open" && pr.draft === false)) {
    blockers.push("an open non-draft PR linked to this issue is required");
  }
  return blockers;
}

export function referencesIssue(text = "", issueNumber, repository) {
  const number = parseIssueNumber(issueNumber);
  const [owner, repo] = (repository || "").split("/");
  if (!owner || !repo) throw new Error("A repository in owner/name form is required to match issue references.");
  const escapedRepository = `${owner}/${repo}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const shorthand = new RegExp(`(?:^|[^A-Za-z0-9_./-])#${number}\\b`, "i");
  const qualified = new RegExp(`(?:^|[^A-Za-z0-9_./-])${escapedRepository}#${number}\\b`, "i");
  const issueUrl = new RegExp(
    `(?:^|[^A-Za-z0-9_])https?://github\\.com/${escapedRepository}/issues/${number}(?:[?#\\s]|/$|$|[.,;:!?](?=\\)?(?:$|\\s))|\\)(?=$|\\s))`,
    "i",
  );
  return shorthand.test(text) || qualified.test(text) || issueUrl.test(text);
}

export function findBranchCandidates(branches, issue) {
  const ignored = new Set(["and", "the", "with", "from", "issue", "work", "fix", "feature", "polish"]);
  const keywords = (issue.title.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((word) => word.length > 2 && !ignored.has(word));
  if (!keywords.length) {
    return branches.filter((branch) =>
      new RegExp(`(?:^|[/_-])${issue.number}(?:$|[/_-])`).test(branch.toLowerCase()),
    );
  }
  return branches.filter((branch) => {
    const normalized = branch.toLowerCase();
    const numberMatch = new RegExp(`(?:^|[/_-])${issue.number}(?:$|[/_-])`).test(normalized);
    const titleMatches = keywords.filter((word) => normalized.includes(word)).length;
    return numberMatch || titleMatches >= Math.min(2, keywords.length);
  });
}

function linkedPullRequests(timeline) {
  const linked = new Map();
  for (const event of timeline) {
    if (event.event !== "cross-referenced") continue;
    const source = event.source?.issue;
    if (!source?.pull_request) continue;
    linked.set(source.number, {
      number: source.number,
      title: source.title,
      state: source.state,
      url: source.html_url,
      body: source.body || "",
      branch: source.head?.ref || null,
    });
  }
  return [...linked.values()];
}

export function hydratePullRequestDraftState(timelinePullRequests, openPullRequests) {
  const normalizeUrl = (value) => {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      return `${url.origin.toLowerCase()}${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
    } catch {
      return null;
    }
  };
  const openByUrl = new Map(
    openPullRequests
      .map((pullRequest) => [normalizeUrl(pullRequest.html_url), pullRequest])
      .filter(([url]) => url !== null),
  );
  return timelinePullRequests.map((pullRequest) => {
    const url = normalizeUrl(pullRequest.url);
    const current = url ? openByUrl.get(url) : null;
    return current
      ? { ...pullRequest, state: current.state, draft: current.draft }
      : pullRequest;
  });
}

export async function inspectIssue(client, issueNumber) {
  const issue = await readIssue(client, issueNumber);
  const [
    { project, item },
    blockedByResult,
    blockingResult,
    timelineResult,
    prsResult,
    branchesResult,
    commentsResult,
  ] =
    await Promise.all([
      readProjectItem(client, issue),
      pagedRest(client, `/repos/${client.owner}/${client.repo}/issues/${issueNumber}/dependencies/blocked_by`).then((value) => ({ value })).catch((error) => ({ error })),
      pagedRest(client, `/repos/${client.owner}/${client.repo}/issues/${issueNumber}/dependencies/blocking`).then((value) => ({ value })).catch((error) => ({ error })),
      pagedRest(client, `/repos/${client.owner}/${client.repo}/issues/${issueNumber}/timeline`).then((value) => ({ value })).catch((error) => ({ error })),
      pagedRest(client, `/repos/${client.owner}/${client.repo}/pulls?state=open`).then((value) => ({ value })).catch((error) => ({ error })),
      pagedRest(client, `/repos/${client.owner}/${client.repo}/branches`).then((value) => ({ value })).catch((error) => ({ error })),
      pagedRest(client, `/repos/${client.owner}/${client.repo}/issues/${issueNumber}/comments`).then((value) => ({ value })).catch((error) => ({ error })),
    ]);

  const dependencyReadAvailable = !blockedByResult.error;
  const blockedBy = blockedByResult.value || [];
  const blocking = blockingResult.value || [];
  const timeline = timelineResult.value || [];
  const openPRs = prsResult.value || [];
  const branches = branchesResult.value || [];
  const timelinePRs = hydratePullRequestDraftState(linkedPullRequests(timeline), openPRs);
  const relatedOpenPRs = openPRs
    .filter((pr) => referencesIssue(
      `${pr.title}\n${pr.body || ""}`,
      issueNumber,
      `${client.owner}/${client.repo}`,
    ))
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      url: pr.html_url,
      body: pr.body || "",
      draft: pr.draft,
      branch: pr.head?.ref,
      author: pr.user?.login || null,
      headSha: pr.head?.sha || null,
      updatedAt: pr.updated_at,
    }));
  const remoteCandidateBranches = branchesResult.error
    ? []
    : findBranchCandidates(branches.map((branch) => branch.name), issue);
  let localContext;
  let localGitContextError = null;
  try {
    localContext = localGitContext(issue);
  } catch (error) {
    localGitContextError = error.message;
    localContext = {
      currentBranch: null,
      localBranchCandidates: [],
      checkedOutBranchCandidates: [],
    };
  }
  const candidateBranches = [...new Set([
    ...remoteCandidateBranches,
    ...localContext.localBranchCandidates,
  ])];
  const branchHistoryAvailable = !branchesResult.error && !localGitContextError;
  const resumeContextAvailable = !timelineResult.error && !prsResult.error && branchHistoryAvailable;
  const readiness = buildReadiness({
    issue,
    item,
    blockedBy,
    dependencyReadAvailable,
    commentsReadAvailable: !commentsResult.error,
    resumeContextAvailable,
    projectNumber: client.projectNumber,
  });
  const recoveryPlan = planIssueRecovery({
    issueState: issue.state,
    projectStatus: readiness.projectStatus,
    pullRequests: relatedOpenPRs,
    candidateBranches,
    pullRequestHistoryAvailable: !prsResult.error,
    branchHistoryAvailable,
  });
  const pullRequestDetails = await Promise.all(relatedOpenPRs.map(async (pullRequest) => {
    const pullRequestPath = "/repos/" + client.owner + "/" + client.repo + "/pulls/" + pullRequest.number;
    const checksPath = pullRequest.headSha
      ? "/repos/" + client.owner + "/" + client.repo + "/commits/" + pullRequest.headSha
      : null;
    const [reviewsResult, filesResult, checkRunsResult, statusesResult] = await Promise.all([
      pagedRest(client, pullRequestPath + "/reviews").then((value) => ({ value })).catch((error) => ({ error })),
      pagedRest(client, pullRequestPath + "/files").then((value) => ({ value })).catch((error) => ({ error })),
      checksPath
        ? client.request(checksPath + "/check-runs?per_page=100").then((value) => ({ value })).catch((error) => ({ error }))
        : Promise.resolve({ error: new Error("PR head SHA is unavailable") }),
      checksPath
        ? client.request(checksPath + "/status?per_page=100").then((value) => ({ value })).catch((error) => ({ error }))
        : Promise.resolve({ error: new Error("PR head SHA is unavailable") }),
    ]);
    const checkRuns = checkRunsResult.value?.check_runs || [];
    const commitStatuses = statusesResult.value?.statuses || [];
    const checksComplete =
      !checkRunsResult.error &&
      !statusesResult.error &&
      (checkRunsResult.value?.total_count || 0) <= checkRuns.length &&
      (statusesResult.value?.total_count || 0) <= commitStatuses.length;
    return {
      ...pullRequest,
      independentReview: validateIndependentReview({
        pullRequestAuthor: pullRequest.author,
        headSha: pullRequest.headSha,
        reviews: reviewsResult.value || [],
        available: !reviewsResult.error,
      }),
      verification: summarizeGitHubChecks({
        checkRuns,
        statuses: commitStatuses,
        available: checksComplete,
        command: checksPath
          ? "GET " + checksPath + "/check-runs and GET " + checksPath + "/status"
          : "GitHub commit check-runs and commit status",
      }),
      releaseRequirements: buildReleaseRequirements(filesResult.value || [], {
        available: !filesResult.error,
      }),
      reviewReadError: reviewsResult.error?.message || null,
      filesReadError: filesResult.error?.message || null,
    };
  }));

  return {
    repository: `${client.owner}/${client.repo}`,
    project: {
      title: project.title,
      url: project.url,
      itemFound: Boolean(item),
      itemId: item?.id || null,
      archived: item?.isArchived ?? null,
      fields: projectItemFields(item),
      availableFields: project.fields.nodes.map((field) => ({
        name: field.name,
        type: field.__typename,
        options: field.options?.map((option) => option.name) || [],
      })),
    },
    issue: {
      ...issueSummary(issue),
      acceptanceCriteria: extractAcceptanceCriteria(issue.body || ""),
    },
    relationships: {
      parent: item?.content?.parent || null,
      subIssues: item?.content?.subIssues?.nodes || [],
      subIssuesHasMore: item?.content?.subIssues?.pageInfo?.hasNextPage || false,
      trackedIssues: item?.content?.trackedIssues?.nodes || [],
      trackedIssuesHasMore: item?.content?.trackedIssues?.pageInfo?.hasNextPage || false,
      trackedInIssues: item?.content?.trackedInIssues?.nodes || [],
      trackedInIssuesHasMore: item?.content?.trackedInIssues?.pageInfo?.hasNextPage || false,
    },
    comments: commentsResult.value?.map((comment) => ({
      author: comment.user?.login || null,
      createdAt: comment.created_at,
      url: comment.html_url,
      body: comment.body,
    })) || null,
    commentsReadError: commentsResult.error?.message || null,
    dependencies: {
      blockedBy,
      blocking,
      available: dependencyReadAvailable && !blockingResult.error,
      error: blockedByResult.error?.message || blockingResult.error?.message || null,
    },
    readiness,
    resume: {
      linkedPullRequests: timelineResult.error ? null : timelinePRs,
      relatedOpenPullRequests: prsResult.error ? null : relatedOpenPRs,
      candidateBranches: branchesResult.error ? null : candidateBranches,
      localGitContextError,
      recoveryPlan,
      pullRequestDetails: prsResult.error ? null : pullRequestDetails,
      ...localContext,
      checksComplete: resumeContextAvailable,
    },
  };
}

async function setSingleSelectField(client, issueNumber, fieldName, optionName) {
  if (fieldName === STATUS_FIELD && optionName === DONE_STATUS) {
    throw new Error("Do not set Done manually; issue closure or PR merge owns this transition.");
  }
  if (fieldName === STATUS_FIELD && ["Ready", "In Progress", "Review"].includes(optionName)) {
    const discovery = await inspectIssue(client, issueNumber);
    const linkedPullRequests = discovery.resume.relatedOpenPullRequests || [];
    const blockers = statusTransitionBlockers(
      optionName,
      discovery.readiness,
      linkedPullRequests,
      discovery.resume.recoveryPlan,
    );
    if (blockers.length) {
      throw new Error(`Cannot set ${optionName}: issue #${issueNumber} is not ready (${blockers.join("; ")}).`);
    }
  }
  const issue = await readIssue(client, issueNumber);
  const projectContext = await readProjectItem(client, issue);
  if (issue.state !== "open") throw new Error(`Issue #${issueNumber} is closed.`);
  const { project, fields, item } = projectContext;
  if (!item) throw new Error(`Issue #${issueNumber} is not on Project #${client.projectNumber}; run the add command first.`);
  if (item.isArchived) throw new Error(`Issue #${issueNumber} is archived on the Project; run add ${issueNumber} to restore its card first.`);
  const field = fields.find((candidate) => candidate.name === fieldName && candidate.options);
  if (!field) throw new Error(`Single-select field "${fieldName}" was not found on Project #${client.projectNumber}.`);
  const option = field.options.find((candidate) => candidate.name === optionName);
  if (!option) {
    throw new Error(`Option "${optionName}" was not found for ${fieldName}. Available: ${field.options.map((candidate) => candidate.name).join(", ")}`);
  }
  const currentValue = projectItemFields(item)[fieldName] || null;
  if (currentValue === optionName) {
    return { issue: issueNumber, field: fieldName, previous: currentValue, value: optionName, changed: false };
  }
  await client.graphql(UPDATE_FIELD_MUTATION, {
    input: {
      projectId: project.id,
      itemId: item.id,
      fieldId: field.id,
      value: { singleSelectOptionId: option.id },
    },
  });
  return { issue: issueNumber, field: fieldName, previous: currentValue, value: optionName, changed: true };
}

async function addIssue(client, issueNumber) {
  const issue = await readIssue(client, issueNumber);
  const projectContext = await readProjectItem(client, issue);
  if (projectContext.item) {
    if (!projectContext.item.isArchived) {
      return { issue: issueNumber, added: false, restored: false, itemId: projectContext.item.id };
    }
    const restored = await client.graphql(UNARCHIVE_ITEM_MUTATION, {
      input: { projectId: projectContext.project.id, itemId: projectContext.item.id },
    });
    return {
      issue: issueNumber,
      added: false,
      restored: !restored.unarchiveProjectV2Item.item.isArchived,
      itemId: restored.unarchiveProjectV2Item.item.id,
    };
  }
  const data = await client.graphql(ADD_ITEM_MUTATION, {
    input: { projectId: projectContext.project.id, contentId: issue.node_id },
  });
  return { issue: issueNumber, added: true, itemId: data.addProjectV2ItemById.item.id };
}

async function postIssueComment(client, issueNumber, body) {
  if (!body.trim()) throw new Error("Comment body cannot be empty.");
  const comment = await client.request(`/repos/${client.owner}/${client.repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
  return { issue: issueNumber, commentId: comment.id, url: comment.html_url };
}

function printUsage() {
  console.log(`Usage:
  node scripts/agent-harness.mjs inspect <issue>
  node scripts/agent-harness.mjs add <issue>
  node scripts/agent-harness.mjs status <issue> <Backlog|Ready|In Progress|Review|Blocked>
  node scripts/agent-harness.mjs field <issue> <Priority|Area> <value>
  node scripts/agent-harness.mjs comment <issue> --body-file <path>`);
}

async function main(args) {
  const [command, rawNumber, fieldOrStatus, value, ...extra] = args;
  if (!command || command === "--help" || command === "help") {
    printUsage();
    return;
  }
  const issueNumber = parseIssueNumber(rawNumber);
  const client = createClient();
  if (command === "inspect") {
    console.log(JSON.stringify(await inspectIssue(client, issueNumber), null, 2));
    return;
  }
  if (command === "add") {
    console.log(JSON.stringify(await addIssue(client, issueNumber), null, 2));
    return;
  }
  if (command === "status") {
    if (!fieldOrStatus) throw new Error("A Project Status value is required.");
    console.log(JSON.stringify(await setSingleSelectField(client, issueNumber, STATUS_FIELD, fieldOrStatus), null, 2));
    return;
  }
  if (command === "field") {
    if (!fieldOrStatus || !value) throw new Error("A field name and value are required.");
    console.log(JSON.stringify(await setSingleSelectField(client, issueNumber, fieldOrStatus, value), null, 2));
    return;
  }
  if (command === "comment") {
    if (fieldOrStatus !== "--body-file" || !value || extra.length) {
      throw new Error("Use comment <issue> --body-file <path>.");
    }
    const body = await readFile(resolve(value), "utf8");
    console.log(JSON.stringify(await postIssueComment(client, issueNumber, body), null, 2));
    return;
  }
  printUsage();
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
