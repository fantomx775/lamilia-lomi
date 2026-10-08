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
  const pending = outcomes.filter(({ state }) => !["success", "neutral", "skipped"].includes(state));
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

export function summarizeRequiredGitHubChecks({
  requiredChecks,
  checkRuns = [],
  statuses = [],
  available = true,
  headSha,
  command = "GitHub branch protection and effective branch rules",
}) {
  if (!available || !Array.isArray(requiredChecks)) {
    return verificationEvidence({
      status: "BLOCKED",
      command,
      details: "Required-check policy could not be read; merge requirements are unknown.",
    });
  }
  const normalized = [];
  let malformedPolicy = false;
  for (const check of requiredChecks) {
    if (typeof check === "string" && check.trim()) {
      normalized.push({ context: check.trim(), integrationId: null });
      continue;
    }
    if (!check || typeof check !== "object" || typeof check.context !== "string" || !check.context.trim()) {
      malformedPolicy = true;
      continue;
    }
    const rawIntegrationId = check.integration_id ?? check.app_id ?? null;
    const integrationId = rawIntegrationId === null ? null : Number(rawIntegrationId);
    if (integrationId !== null && (!Number.isSafeInteger(integrationId) || integrationId < 0)) {
      malformedPolicy = true;
      continue;
    }
    normalized.push({ context: check.context.trim(), integrationId });
  }
  const required = [...new Map(normalized.map((check) => [
    check.context + "\u0000" + (check.integrationId ?? "*"),
    check,
  ])).values()];
  if (malformedPolicy) {
    return verificationEvidence({
      status: "BLOCKED",
      command,
      details: "Required-check policy contains malformed names or provider identities.",
    });
  }
  if (!required.length) {
    return verificationEvidence({
      status: "NOT RUN",
      command,
      details: "No required GitHub status checks are configured; this is not passing CI evidence.",
    });
  }
  const missing = [];
  const pending = [];
  const failures = [];
  const accepted = [];
  for (const requiredCheck of required) {
    const { context: name, integrationId } = requiredCheck;
    const label = integrationId === null ? name : name + " (GitHub App " + integrationId + ")";
    const matchingRuns = checkRuns.filter((check) =>
      check.name === name &&
      (!headSha || !check.head_sha || (
        typeof check.head_sha === "string" && check.head_sha.toLowerCase() === headSha.toLowerCase()
      )) &&
      (integrationId === null || Number(check.app?.id) === integrationId),
    );
    const wrongShaRuns = checkRuns.filter((check) =>
      check.name === name && headSha && typeof check.head_sha === "string" &&
      check.head_sha.toLowerCase() !== headSha.toLowerCase(),
    );
    const matchingStatuses = integrationId === null
      ? statuses.filter((check) => check.context === name)
      : [];
    const wrongProviderRuns = integrationId !== null && checkRuns.some((check) =>
      check.name === name && check.head_sha?.toLowerCase?.() === headSha?.toLowerCase?.() &&
      Number(check.app?.id) !== integrationId,
    );
    const candidates = [
      ...matchingRuns.map((check) => ({
        state: check.status === "completed" ? check.conclusion : check.status,
        at: check.completed_at || check.started_at || check.created_at || "",
      })),
      ...matchingStatuses.map((check) => ({ state: check.state, at: check.updated_at || check.created_at || "" })),
    ].sort((left, right) => left.at.localeCompare(right.at));
    const latest = candidates.at(-1);
    if (!latest) {
      if (wrongShaRuns.length) missing.push(name + " (only a different SHA has a result)");
      else if (wrongProviderRuns || (integrationId !== null && statuses.some((check) => check.context === name))) {
        missing.push(label + " (no result from the required provider)");
      } else missing.push(label);
      continue;
    }
    const state = String(latest.state || "").toLowerCase();
    if (["success", "neutral", "skipped"].includes(state)) accepted.push(label);
    else if (["failure", "error", "cancelled", "timed_out", "action_required"].includes(state)) {
      failures.push(label + " (" + state + ")");
    } else {
      pending.push(label + " (" + (state || "unknown") + ")");
    }
  }
  if (failures.length) {
    return verificationEvidence({
      status: "FAIL",
      command,
      details: "Required checks failed: " + failures.join(", ") + ".",
    });
  }
  if (missing.length || pending.length) {
    return verificationEvidence({
      status: "BLOCKED",
      command,
      details: [
        missing.length ? "Missing required checks: " + missing.join(", ") + "." : "",
        pending.length ? "Required checks are pending or unknown: " + pending.join(", ") + "." : "",
      ].filter(Boolean).join(" "),
    });
  }
  return verificationEvidence({
    status: "PASS",
    command,
    details: "Required checks completed successfully: " + accepted.join(", ") + ".",
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

const REVIEW_SEVERITIES = Object.freeze(["Critical", "High", "Medium", "Low"]);
const AI_REVIEW_MARKER = "<!-- agent-harness-ai-review:v1 -->";
const VERIFICATION_MARKER = "<!-- agent-harness-verification:v1 -->";
const REQUIRED_LOCAL_CHECKS = Object.freeze(["diff", "lint", "tests"]);

function reviewFields(body) {
  const wanted = new Set([
    "reviewer",
    "reviewed sha",
    "critical",
    "high",
    "medium",
    "low",
    "fixes applied",
    "unresolved findings",
  ]);
  const fields = {};
  const duplicates = [];
  for (const line of (body || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:[-*]\s*)?([A-Za-z][A-Za-z ]*)\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    const label = match[1].trim().toLowerCase();
    if (!wanted.has(label)) continue;
    if (Object.hasOwn(fields, label)) duplicates.push(label);
    fields[label] = match[2].trim();
  }
  return { fields, duplicates };
}

function parseUnresolvedReviewFindings(value) {
  const text = (value || "").trim();
  if (/^(?:none|no findings?|0(?: findings?)?)$/i.test(text)) {
    return { known: true, severities: [] };
  }
  const severities = REVIEW_SEVERITIES.filter((severity) =>
    new RegExp("\\b" + severity + "\\b", "i").test(text),
  );
  return { known: severities.length > 0, severities };
}

export function validateGitHubReview({
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
  const submitted = reviews.filter((review) =>
    review.user?.login && !["PENDING", "DISMISSED"].includes(review.state),
  );
  if (!submitted.length) {
    return {
      status: "NOT RUN",
      reviewer: null,
      reviewedSha: null,
      findingsBySeverity: null,
      fixesApplied: null,
      unresolvedFindings: null,
      details: "No submitted GitHub pull request review is available; AI review evidence is reported separately.",
    };
  }
  const independent = submitted.filter(
    (review) => review.user.login.toLowerCase() !== (pullRequestAuthor || "").toLowerCase(),
  );
  if (!independent.length) {
    return {
      status: "NOT RUN",
      reviewer: null,
      reviewedSha: null,
      findingsBySeverity: null,
      fixesApplied: null,
      unresolvedFindings: null,
      details: "Only the PR author has submitted a GitHub review; formal independent GitHub review is NOT RUN.",
    };
  }
  const currentShaReviews = independent
    .filter((review) => review.commit_id?.toLowerCase() === headSha.toLowerCase())
    .sort((left, right) => (right.submitted_at || "").localeCompare(left.submitted_at || ""));
  if (!currentShaReviews.length) {
    return {
      status: "BLOCKED",
      reviewer: null,
      reviewedSha: null,
      findingsBySeverity: null,
      fixesApplied: null,
      unresolvedFindings: null,
      details: "Independent review exists only for a different commit; review the exact current PR head SHA.",
    };
  }
  const latest = currentShaReviews[0];
  const { fields, duplicates } = reviewFields(latest.body || "");
  const reviewer = fields.reviewer || null;
  const reviewedSha = fields["reviewed sha"] || null;
  const findingsBySeverity = Object.fromEntries(
    REVIEW_SEVERITIES.map((severity) => [severity, fields[severity.toLowerCase()] || null]),
  );
  const fixesApplied = fields["fixes applied"] || null;
  const unresolvedFindings = fields["unresolved findings"] || null;
  const unresolved = parseUnresolvedReviewFindings(unresolvedFindings);
  const reviewerMatches = reviewer?.replace(/^@/, "").toLowerCase() === latest.user.login.toLowerCase();
  const shaMatches = reviewedSha?.toLowerCase() === headSha.toLowerCase();
  const complete =
    reviewerMatches &&
    shaMatches &&
    Object.values(findingsBySeverity).every(Boolean) &&
    Boolean(fixesApplied) &&
    Boolean(unresolvedFindings) &&
    unresolved.known &&
    duplicates.length === 0;
  const requestedChanges = latest.state === "CHANGES_REQUESTED";
  const unresolvedHighOrCritical = unresolved.severities.some((severity) =>
    ["Critical", "High"].includes(severity),
  );
  const passed = complete && !requestedChanges && !unresolvedHighOrCritical &&
    ["APPROVED", "COMMENTED"].includes(latest.state);
  return {
    status: passed ? "PASS" : "FAIL",
    reviewer: latest.user.login,
    reviewedSha: reviewedSha || null,
    findingsBySeverity,
    fixesApplied,
    unresolvedFindings,
    unresolvedSeverity: unresolved.severities,
    requestedChanges,
    details: passed
      ? "Formal GitHub review by @" + latest.user.login + " covers the current head SHA."
      : unresolvedHighOrCritical
        ? "The current GitHub review reports unresolved Critical or High findings."
        : requestedChanges
          ? "The latest formal GitHub review requests changes."
          : "The current GitHub review is incomplete, ambiguous, or uses an unsupported review state.",
  };
}

// Retain the former helper name for callers while making its GitHub-review role explicit.
export const validateIndependentReview = validateGitHubReview;

function parseMarkedRecords(comments, marker) {
  const fence = String.fromCharCode(96).repeat(3);
  const recordPattern = new RegExp(marker + "\\s*" + fence + "json\\s*([\\s\\S]*?)\\s*" + fence, "i");
  const marked = [];
  for (const comment of comments || []) {
    const body = comment?.body || "";
    if (!body.includes(marker)) continue;
    const match = body.match(recordPattern);
    if (!match) {
      marked.push({ comment, record: null, error: "marker is present but the JSON record is missing" });
      continue;
    }
    try {
      marked.push({ comment, record: JSON.parse(match[1]), error: null });
    } catch {
      marked.push({ comment, record: null, error: "marker JSON could not be parsed" });
    }
  }
  return marked;
}

function validSha(value) {
  return /^[a-f0-9]{40}$/i.test(value || "");
}

function entriesForSeverity(record, fieldName) {
  const value = record?.[fieldName];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  for (const severity of REVIEW_SEVERITIES) {
    if (!Array.isArray(value[severity])) return null;
    result[severity] = value[severity];
  }
  return result;
}

function hasStructuredReviewItems(value) {
  return REVIEW_SEVERITIES.every((severity) =>
    value[severity].every((item) =>
      item && typeof item === "object" &&
      typeof item.summary === "string" && item.summary.trim() &&
      typeof item.requiredFix === "string" && item.requiredFix.trim(),
    ),
  );
}

export function validateAiReview({ headSha, comments = [], available = true }) {
  if (!available || !validSha(headSha)) {
    return {
      status: "BLOCKED",
      reviewedSha: null,
      reviewers: [],
      findings: null,
      unresolvedFindings: null,
      details: "AI review comments or the current PR head SHA could not be verified.",
    };
  }
  const marked = parseMarkedRecords(comments, AI_REVIEW_MARKER);
  if (!marked.length) {
    return {
      status: "NOT RUN",
      reviewedSha: null,
      reviewers: [],
      findings: null,
      unresolvedFindings: null,
      details: "No structured AI sub-agent review record is present.",
    };
  }
  const current = marked.filter(({ record, error }) =>
    !error && record && typeof record === "object" && !Array.isArray(record) &&
    typeof record.reviewedSha === "string" && record.reviewedSha.toLowerCase() === headSha.toLowerCase(),
  );
  if (!current.length) {
    const malformed = marked.some(({ record, error }) =>
      Boolean(error) || !record || typeof record !== "object" || Array.isArray(record) ||
      typeof record.reviewedSha !== "string" || !validSha(record.reviewedSha),
    );
    if (malformed) {
      return {
        status: "FAIL",
        reviewedSha: null,
        reviewers: [],
        findings: null,
        unresolvedFindings: null,
        details: "An AI review marker is malformed and no valid current-SHA record supersedes it.",
      };
    }
    return {
      status: "BLOCKED",
      reviewedSha: marked.at(-1)?.record?.reviewedSha || null,
      reviewers: [],
      findings: null,
      unresolvedFindings: null,
      details: "AI review evidence exists only for an outdated SHA; review the current PR head.",
    };
  }
  const invalid = current.filter(({ record }) => {
    const findings = entriesForSeverity(record, "findings");
    const unresolved = entriesForSeverity(record, "unresolvedFindings");
    const requiredScopes = ["correctness", "regressions", "testing", "scope"];
    return record.schemaVersion !== 1 ||
      record.reviewType !== "ai-subagent" ||
      typeof record.reviewerAgent !== "string" || !record.reviewerAgent.trim() ||
      record.independentlyTasked !== true ||
      record.taskGoalProvided !== true ||
      record.actualDiffRead !== true ||
      !Array.isArray(record.reviewScope) ||
      !requiredScopes.every((scope) => record.reviewScope.includes(scope)) ||
      !findings || !unresolved || !hasStructuredReviewItems(findings) ||
      !hasStructuredReviewItems(unresolved) ||
      !Array.isArray(record.fixesApplied) ||
      record.fixesApplied.some((fix) => typeof fix !== "string" || !fix.trim());
  });
  if (invalid.length) {
    return {
      status: "FAIL",
      reviewedSha: headSha,
      reviewers: current.map(({ record, comment }) => ({
        reviewerAgent: record.reviewerAgent || null,
        recordedBy: comment.user?.login || null,
      })),
      findings: null,
      unresolvedFindings: null,
      details: "The AI review record is missing required provenance, scope, or structured severity fields.",
    };
  }
  const unresolvedFindings = Object.fromEntries(REVIEW_SEVERITIES.map((severity) => [
    severity,
    current.flatMap(({ record }) => record.unresolvedFindings[severity]),
  ]));
  const findings = Object.fromEntries(REVIEW_SEVERITIES.map((severity) => [
    severity,
    current.flatMap(({ record }) => record.findings[severity]),
  ]));
  const unresolvedHighOrCritical =
    unresolvedFindings.Critical.length > 0 || unresolvedFindings.High.length > 0;
  return {
    status: unresolvedHighOrCritical ? "FAIL" : "PASS",
    reviewedSha: headSha,
    reviewers: current.map(({ record, comment }) => ({
      reviewerAgent: record.reviewerAgent,
      recordedBy: comment.user?.login || null,
    })),
    findings,
    unresolvedFindings,
    details: unresolvedHighOrCritical
      ? "AI sub-agent review reports unresolved Critical or High findings."
      : current.length + " independently tasked AI sub-agent review record(s) cover the current head SHA.",
  };
}

function latestMarkedRecord(comments, marker, headSha) {
  const marked = parseMarkedRecords(comments, marker);
  if (!marked.length) return { record: null, comment: null, stale: false, malformed: false };
  const current = marked
    .filter(({ record, error }) =>
      !error && record && typeof record === "object" && !Array.isArray(record) &&
      typeof record.headSha === "string" && record.headSha.toLowerCase() === headSha.toLowerCase(),
    )
    .sort((left, right) =>
      (left.comment.created_at || "").localeCompare(right.comment.created_at || ""),
    );
  if (!current.length) {
    const malformed = marked.some(({ record, error }) =>
      Boolean(error) || !record || typeof record !== "object" || Array.isArray(record) ||
      typeof record.headSha !== "string" || !validSha(record.headSha),
    );
    const stale = marked.some(({ record, error }) =>
      !error && record && typeof record === "object" && !Array.isArray(record) &&
      typeof record.headSha === "string" && validSha(record.headSha) &&
      record.headSha.toLowerCase() !== headSha.toLowerCase(),
    );
    return { record: null, comment: null, stale, malformed };
  }
  return { ...current.at(-1), stale: false, malformed: false };
}

function combineEvidenceStatuses(statuses) {
  if (statuses.includes("FAIL")) return "FAIL";
  if (statuses.includes("BLOCKED")) return "BLOCKED";
  if (statuses.includes("NOT RUN")) return "NOT RUN";
  if (statuses.some((status) => !VERIFICATION_STATES.includes(status))) return "BLOCKED";
  return statuses.length ? "PASS" : "NOT RUN";
}

export function validateLocalVerification({
  headSha,
  comments = [],
  available = true,
}) {
  if (!available || !validSha(headSha)) {
    return {
      status: "BLOCKED",
      reviewedSha: null,
      record: null,
      checks: {},
      uiBehavior: null,
      details: "Verification comments or the current PR head SHA could not be verified.",
    };
  }
  const selected = latestMarkedRecord(comments, VERIFICATION_MARKER, headSha);
  if (selected.malformed) {
    return {
      status: "FAIL",
      reviewedSha: null,
      record: null,
      checks: {},
      uiBehavior: null,
      details: "A verification marker is malformed; the evidence cannot be trusted.",
    };
  }
  if (!selected.record) {
    return {
      status: selected.stale ? "BLOCKED" : "NOT RUN",
      reviewedSha: null,
      record: null,
      checks: {},
      uiBehavior: null,
      details: selected.stale
        ? "Verification evidence exists only for an outdated SHA."
        : "No structured local verification record is present for the current SHA.",
    };
  }
  const record = selected.record;
  const checks = Array.isArray(record.checks) ? record.checks : [];
  const malformedCheck = checks.some((check) => !check || typeof check.kind !== "string");
  const kinds = checks.filter((check) => check && typeof check.kind === "string").map((check) => check.kind);
  const duplicateKinds = kinds.length !== new Set(kinds).size;
  const checksByKind = Object.fromEntries(
    checks.filter((check) => check && typeof check.kind === "string").map((check) => [check.kind, check]),
  );
  const missing = REQUIRED_LOCAL_CHECKS.filter((kind) => !checksByKind[kind]);
  const malformed = malformedCheck || duplicateKinds ||
    record.schemaVersion !== 1 ||
    record.headSha?.toLowerCase() !== headSha.toLowerCase() ||
    typeof record.uiBehavior !== "boolean" ||
    checks.some((check) =>
      !VERIFICATION_STATES.includes(check.status) ||
      typeof check.command !== "string" || !check.command.trim() ||
      typeof check.result !== "string" || !check.result.trim(),
    );
  const requiredStatuses = REQUIRED_LOCAL_CHECKS.map((kind) =>
    checksByKind[kind]?.status || "NOT RUN",
  );
  const optionalStatuses = checks
    .filter((check) => !REQUIRED_LOCAL_CHECKS.includes(check.kind))
    .map((check) => check.status);
  const status = malformed
    ? "FAIL"
    : combineEvidenceStatuses([...requiredStatuses, ...optionalStatuses]);
  return {
    status,
    reviewedSha: headSha,
    record,
    checks: Object.fromEntries(REQUIRED_LOCAL_CHECKS.map((kind) => [
      kind,
      checksByKind[kind]
        ? { status: checksByKind[kind].status, command: checksByKind[kind].command, result: checksByKind[kind].result }
        : { status: "NOT RUN", command: null, result: "Required local verification category is missing." },
    ])),
    uiBehavior: typeof record.uiBehavior === "boolean" ? record.uiBehavior : null,
    recordedBy: selected.comment.user?.login || null,
    details: malformed
      ? "The current-SHA local verification record is malformed."
      : missing.length
        ? "Missing required local check categories: " + missing.join(", ") + "."
        : status === "PASS"
          ? "Required local diff, lint, and test evidence covers the current head SHA."
          : "One or more required local checks are not passing.",
  };
}

function isUiBehaviorFile(filename) {
  return /^(?:src\/(?:app|components|ui|styles|messages)\/|(?:app|components|pages|public|messages)\/)/i.test(filename) ||
    /\.(?:css|scss|sass|less)$/i.test(filename);
}

function isVerificationScreenshot(filename) {
  return /^docs\/verification\/(?:issue-\d+|pr-\d+)\/.+\.(?:png|jpe?g|webp)$/i.test(filename);
}

function inspectBrowserProblems(items) {
  if (!Array.isArray(items)) return { status: "BLOCKED", details: "Browser error/network inspection evidence is missing." };
  const unresolved = items.filter((item) =>
    !item || item.disposition !== "unrelated" ||
    typeof item.reason !== "string" || !item.reason.trim(),
  );
  return unresolved.length
    ? { status: "FAIL", details: unresolved.length + " unresolved browser error or failed network request(s)." }
    : { status: "PASS", details: items.length
      ? items.length + " known unrelated browser issue(s) were inspected and classified."
      : "No browser errors or failed network requests were found." };
}

export function validateBrowserVerification({
  uiRequired,
  localVerification,
  files = [],
}) {
  if (!uiRequired) {
    return {
      status: "NOT RUN",
      required: false,
      screenshots: [],
      details: "Browser verification is not required for the detected change scope.",
    };
  }
  const record = localVerification?.record?.browser;
  if (!record) {
    return {
      status: "NOT RUN",
      required: true,
      screenshots: [],
      details: "UI behavior changed, but no current-SHA browser evidence was recorded.",
    };
  }
  const changedFiles = new Set(files.map((file) => typeof file === "string" ? file : file.filename));
  const screenshots = Array.isArray(record.screenshots) ? record.screenshots : [];
  const screenshotsValid = screenshots.length > 0 && screenshots.every((path) =>
    typeof path === "string" && isVerificationScreenshot(path) && changedFiles.has(path),
  );
  const console = inspectBrowserProblems(record.consoleErrors);
  const network = inspectBrowserProblems(record.failedNetworkRequests);
  const responsiveValid =
    (Array.isArray(record.responsiveLayouts) && record.responsiveLayouts.some((layout) => typeof layout === "string" && layout.trim())) ||
    (typeof record.responsiveNotApplicable === "string" && record.responsiveNotApplicable.trim());
  const persistenceValid = record.persistence &&
    ["PASS", "NOT APPLICABLE"].includes(record.persistence.status) &&
    typeof record.persistence.details === "string" && record.persistence.details.trim();
  const screenshotReviewValid = record.screenshotReview?.status === "PASS" &&
    typeof record.screenshotReview.details === "string" && record.screenshotReview.details.trim();
  const valid = record.status === "PASS" &&
    typeof record.tool === "string" && record.tool.trim() &&
    Array.isArray(record.flows) && record.flows.some((flow) => typeof flow === "string" && flow.trim()) &&
    screenshotsValid &&
    responsiveValid &&
    persistenceValid &&
    screenshotReviewValid &&
    record.retestedAfterFixes === true &&
    console.status === "PASS" &&
    network.status === "PASS";
  const failures = [];
  if (!screenshotsValid) failures.push("screenshots must be committed under docs/verification and listed in the PR files");
  if (!responsiveValid) failures.push("responsive layouts or a not-applicable reason must be recorded");
  if (!persistenceValid) failures.push("persistence behavior or a not-applicable reason must be recorded");
  if (!screenshotReviewValid) failures.push("post-implementation screenshot review is missing");
  if (record.retestedAfterFixes !== true) failures.push("final browser verification after fixes is not confirmed");
  if (console.status !== "PASS") failures.push(console.details);
  if (network.status !== "PASS") failures.push(network.details);
  if (record.status !== "PASS" || !record.tool || !record.flows?.length) {
    failures.push("browser tool, affected flow, or PASS result is missing");
  }
  return {
    status: valid
      ? "PASS"
      : record.status === "FAIL" || console.status === "FAIL" || network.status === "FAIL"
        ? "FAIL"
        : record.status === "NOT RUN"
          ? "NOT RUN"
          : "BLOCKED",
    required: true,
    screenshots,
    details: valid
      ? "Browser flow, screenshots, responsive checks, console/network inspection, and final retest are recorded."
      : failures.join("; "),
  };
}

export function validateReleaseEvidence({ files = [], filesAvailable = true, localVerification }) {
  const requirements = buildReleaseRequirements(files, { available: filesAvailable });
  if (!filesAvailable) return { ...requirements, status: "BLOCKED" };
  if (requirements.status === "PASS") {
    return {
      ...requirements,
      migrationCompatibility: { status: "PASS", details: "No database migration changed." },
      preMergeMigration: { status: "PASS", required: false, details: "No pre-merge migration action is required." },
      dependencyAudit: { status: "PASS", details: "No dependency manifest changed." },
    };
  }
  const record = localVerification?.record?.release || {};
  const results = [];
  const normalize = (evidence, fallback) => {
    if (!evidence) return fallback;
    if (
      !VERIFICATION_STATES.includes(evidence.status) ||
      typeof evidence.command !== "string" || !evidence.command.trim() ||
      typeof evidence.details !== "string" || !evidence.details.trim()
    ) {
      return {
        ...evidence,
        status: "BLOCKED",
        details: "Release evidence is missing a valid status, command, or result.",
      };
    }
    return evidence;
  };
  let migrationCompatibility = { status: "PASS", details: "No database migration changed." };
  let preMergeMigration = { status: "PASS", required: false, details: "No pre-merge migration action is required." };
  let dependencyAudit = { status: "PASS", details: "No dependency manifest changed." };
  if (requirements.migrationFiles.length) {
    migrationCompatibility = normalize(record.migrationCompatibility, {
      status: "NOT RUN",
      command: "migration compatibility review",
      details: "Migration compatibility evidence is missing for the current SHA.",
    });
    preMergeMigration = normalize(record.preMergeMigration, {
      status: "BLOCKED",
      required: null,
      command: "pre-merge migration assessment",
      details: "The pre-merge migration requirement has not been explicitly assessed.",
    });
    if (preMergeMigration.required === true && preMergeMigration.status !== "PASS") {
      preMergeMigration = {
        ...preMergeMigration,
        status: preMergeMigration.status === "FAIL" ? "FAIL" : "BLOCKED",
      };
    } else if (
      preMergeMigration.required === false &&
      preMergeMigration.status === "PASS" &&
      typeof preMergeMigration.details === "string" && preMergeMigration.details.trim()
    ) {
      preMergeMigration = { ...preMergeMigration, details: "Explicitly not required: " + preMergeMigration.details };
    } else if (preMergeMigration.required === false && preMergeMigration.status !== "FAIL") {
      preMergeMigration = { ...preMergeMigration, status: "BLOCKED" };
    } else if (preMergeMigration.required !== true && preMergeMigration.required !== false) {
      preMergeMigration = { ...preMergeMigration, status: "BLOCKED" };
    }
    results.push(migrationCompatibility.status, preMergeMigration.status);
  }
  if (requirements.dependencyManifests.length) {
    dependencyAudit = normalize(record.dependencyAudit, {
      status: "NOT RUN",
      command: "production dependency and lockfile assessment",
      details: "Production dependency and lockfile assessment is missing for the current SHA.",
    });
    results.push(dependencyAudit.status);
  }
  return {
    ...requirements,
    status: combineEvidenceStatuses(results),
    migrationCompatibility,
    preMergeMigration,
    dependencyAudit,
  };
}

function legacyVerificationSummary(pullRequest, headSha, files) {
  const body = pullRequest?.body || "";
  const fileNames = new Set(files.map((file) => typeof file === "string" ? file : file.filename));
  const screenshotReferences = [...body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => {
      try {
        const url = new URL(match[1]);
        const parts = url.pathname.match(/\/blob\/([a-f0-9]{7,40})\/(docs\/verification\/.+)$/i);
        if (!parts) return null;
        const path = decodeURIComponent(parts[2]);
        return {
          path,
          sourceSha: parts[1],
          includedInPullRequest: fileNames.has(path),
          sourceMatchesCurrentHead: headSha?.toLowerCase().startsWith(parts[1].toLowerCase()) || false,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return {
    verificationSectionPresent: /^##\s+Verification\b/im.test(body),
    browserEvidenceSectionPresent: /^##\s+Browser evidence\b/im.test(body),
    localPlaywrightClaim: /playwright[\s\S]{0,180}(?:passed|exit 0)|(?:passed|exit 0)[\s\S]{0,180}playwright/i.test(body),
    migrationApplicationClaim: /(?:applied[\s\S]{0,160}migration|migration[\s\S]{0,160}applied)/i.test(body),
    dependencyAuditClaim: /npm audit[\s\S]{0,180}(?:passed|vulnerabilities|0 production)/i.test(body),
    screenshotReferences,
    details: "PR-body statements are author-reported legacy evidence; only a structured record for the current SHA can satisfy the gate.",
  };
}

async function readGitHubMergePolicy(client, baseRef) {
  if (!baseRef) {
    return {
      available: false,
      requiredChecks: null,
      requiredApprovals: null,
      unassessedRules: [],
      details: "The PR base branch is unavailable.",
    };
  }
  const root = "/repos/" + client.owner + "/" + client.repo;
  const encodedBase = encodeURIComponent(baseRef);
  const [protectionResult, rulesResult] = await Promise.all([
    client.request(root + "/branches/" + encodedBase + "/protection")
      .then((value) => ({ value }))
      .catch((error) => ({ error })),
    client.request(root + "/rules/branches/" + encodedBase)
      .then((value) => ({ value }))
      .catch((error) => ({ error })),
  ]);
  const unprotected = protectionResult.error &&
    /\(404\): Branch not protected/i.test(protectionResult.error.message || "");
  if ((protectionResult.error && !unprotected) || rulesResult.error || !Array.isArray(rulesResult.value)) {
    return {
      available: false,
      requiredChecks: null,
      requiredApprovals: null,
      unassessedRules: [],
      details: "GitHub branch protection or effective branch rules could not be read.",
      error: protectionResult.error?.message || rulesResult.error?.message || "Branch rules response was malformed.",
    };
  }
  const protection = protectionResult.value || {};
  const requiredStatusChecks = protection.required_status_checks;
  const classicContexts = Array.isArray(requiredStatusChecks?.contexts)
    ? requiredStatusChecks.contexts
    : [];
  const classicChecks = Array.isArray(requiredStatusChecks?.checks)
    ? requiredStatusChecks.checks
    : [];
  const requiredChecks = classicChecks.length
    ? classicChecks.map((check) => typeof check === "string"
      ? check
      : { context: check?.context, app_id: check?.app_id ?? null })
    : [...classicContexts];
  const rawRequiredApprovals = protection.required_pull_request_reviews?.required_approving_review_count ?? 0;
  let requiredApprovals = Number(rawRequiredApprovals);
  const unassessedRules = [];
  if (!Number.isSafeInteger(requiredApprovals) || requiredApprovals < 0) {
    requiredApprovals = null;
    unassessedRules.push("classic required-approval count is malformed");
  }
  if (requiredStatusChecks && (
    (requiredStatusChecks.contexts !== undefined && !Array.isArray(requiredStatusChecks.contexts)) ||
    (requiredStatusChecks.checks !== undefined && !Array.isArray(requiredStatusChecks.checks))
  )) {
    unassessedRules.push("classic required-status-check configuration is malformed");
  }
  if (
    classicContexts.some((context) => typeof context !== "string" || !context.trim()) ||
    classicChecks.some((check) =>
      typeof check !== "string" &&
      (!check || typeof check.context !== "string" || !check.context.trim()),
    )
  ) {
    unassessedRules.push("classic required-status-check entries are malformed");
  }
  if (requiredStatusChecks?.strict && requiredChecks.length) {
    unassessedRules.push("classic branch protection requires the PR branch to be up to date with the base");
  }
  if (protection.required_signatures?.enabled) {
    unassessedRules.push("classic branch protection requires signed commits");
  }
  if (protection.required_linear_history?.enabled) {
    unassessedRules.push("classic branch protection requires linear history; the selected merge method is not verified");
  }
  if (protection.lock_branch?.enabled) {
    unassessedRules.push("classic branch protection locks the target branch");
  }
  if (protection.required_pull_request_reviews?.require_code_owner_reviews) {
    unassessedRules.push("classic branch protection requires code-owner review");
  }
  if (protection.required_pull_request_reviews?.require_last_push_approval) {
    unassessedRules.push("classic branch protection requires approval after the latest push");
  }
  if (protection.required_conversation_resolution?.enabled) {
    unassessedRules.push("classic branch protection requires review conversations to be resolved");
  }
  for (const rule of rulesResult.value) {
    if (!rule || typeof rule.type !== "string") {
      unassessedRules.push("an active branch rule has a missing or invalid type");
      continue;
    }
    const parameters = rule.parameters === undefined ? {} : rule.parameters;
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
      unassessedRules.push("branch rule parameters are malformed for " + rule.type);
      continue;
    }
    if (rule.type === "required_status_checks") {
      if (!Array.isArray(parameters.required_status_checks)) {
        unassessedRules.push("ruleset required-status-check parameters are malformed");
      } else {
        const validChecks = parameters.required_status_checks.filter((check) =>
          check && typeof check.context === "string" && check.context.trim(),
        );
        if (validChecks.length !== parameters.required_status_checks.length) {
          unassessedRules.push("ruleset required-status-check entries are malformed");
        }
        requiredChecks.push(...validChecks.map((check) => ({
          context: check.context,
          integration_id: check.integration_id ?? null,
        })));
        if (parameters.strict_required_status_checks_policy && validChecks.length) {
          unassessedRules.push("ruleset requires the PR branch to be up to date with the base");
        }
      }
    } else if (rule.type === "pull_request") {
      const ruleApprovals = Number(parameters.required_approving_review_count || 0);
      if (!Number.isSafeInteger(ruleApprovals) || ruleApprovals < 0) {
        unassessedRules.push("ruleset required-approval count is malformed");
      } else {
        requiredApprovals = Math.max(requiredApprovals, ruleApprovals);
      }
      if (parameters.require_code_owner_review) {
        unassessedRules.push("ruleset requires code-owner review");
      }
      if (parameters.require_last_push_approval) {
        unassessedRules.push("ruleset requires approval after the latest push");
      }
      if (parameters.required_reviewers?.length) {
        unassessedRules.push("ruleset has file-based required reviewers");
      }
      if (parameters.required_review_thread_resolution) {
        unassessedRules.push("ruleset requires review conversations to be resolved");
      }
    } else if (rule.type) {
      unassessedRules.push("active branch rule needs manual assessment: " + rule.type);
    }
  }
  const uniqueRequiredChecks = [...new Map(requiredChecks.map((check) => [
    typeof check === "string"
      ? check + "\u0000*"
      : check.context + "\u0000" + (check.integration_id ?? check.app_id ?? "*"),
    check,
  ])).values()];
  return {
    available: true,
    requiredChecks: uniqueRequiredChecks,
    requiredApprovals,
    unassessedRules: [...new Set(unassessedRules)],
    sources: [
      unprotected ? "no classic branch protection" : "classic branch protection",
      "effective branch rules",
    ],
    details: unprotected && rulesResult.value.length === 0
      ? "No classic branch protection or effective ruleset requirements were found."
      : "Required status checks and supported review-count rules were read from GitHub.",
  };
}

export function summarizeBranchReviewPolicy({
  policy,
  reviews = [],
  reviewsAvailable = true,
  pullRequestAuthor,
  headSha,
}) {
  if (!policy?.available || !reviewsAvailable || !validSha(headSha)) {
    return {
      status: "BLOCKED",
      approvalsRequired: policy?.requiredApprovals ?? null,
      approvalsPresent: null,
      unassessedRules: policy?.unassessedRules || [],
      details: "Branch review requirements or current-SHA reviews could not be verified.",
    };
  }
  if (policy.unassessedRules?.length) {
    return {
      status: "BLOCKED",
      approvalsRequired: policy.requiredApprovals,
      approvalsPresent: null,
      unassessedRules: policy.unassessedRules,
      details: "Additional mandatory branch rules are not evaluated: " + policy.unassessedRules.join("; ") + ".",
    };
  }
  const approvals = new Set(reviews
    .filter((review) =>
      review.state === "APPROVED" &&
      review.commit_id?.toLowerCase() === headSha.toLowerCase() &&
      review.user?.login &&
      review.user.login.toLowerCase() !== (pullRequestAuthor || "").toLowerCase(),
    )
    .map((review) => review.user.login.toLowerCase()));
  const required = Number(policy.requiredApprovals || 0);
  const enough = approvals.size >= required;
  return {
    status: enough ? "PASS" : "BLOCKED",
    approvalsRequired: required,
    approvalsPresent: approvals.size,
    unassessedRules: [],
    details: required
      ? approvals.size + " of " + required + " required current-SHA external approval(s) are present."
      : "No additional approval-count rule is configured; the separate project policy still requires an external GitHub review.",
  };
}

async function readAllCheckRuns(client, checksPath) {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await client.request(checksPath + "/check-runs?per_page=100&page=" + page);
    if (!Number.isSafeInteger(result?.total_count) || !Array.isArray(result.check_runs)) {
      throw new Error("GitHub check-run response was malformed.");
    }
    all.push(...result.check_runs);
    if (all.length >= result.total_count) return all;
    if (result.check_runs.length < 100) {
      throw new Error("GitHub check-run results were incomplete.");
    }
  }
  throw new Error("GitHub check-run pagination limit reached; results may be incomplete.");
}

function verificationReviewBlocker(review) {
  return review?.requestedChanges ||
    review?.unresolvedSeverity?.some((severity) => ["Critical", "High"].includes(severity));
}

export function assessPullRequestVerification({
  pullRequest,
  expectedBase = "main",
  files = [],
  reviews = [],
  comments = [],
  checkRuns = [],
  statuses = [],
  mergePolicy = { available: false, requiredChecks: null, requiredApprovals: null, unassessedRules: [] },
  available = {},
  headStable = true,
}) {
  const number = pullRequest?.number || null;
  const headSha = pullRequest?.head?.sha || null;
  const baseRef = pullRequest?.base?.ref || null;
  const filesAvailable = available.files !== false && Array.isArray(files);
  const fileList = filesAvailable ? files : [];
  const fileNames = fileList.map((file) => typeof file === "string" ? file : file.filename).filter(Boolean);
  const uiFiles = filesAvailable ? fileNames.filter(isUiBehaviorFile) : [];
  const localVerification = validateLocalVerification({
    headSha,
    comments,
    available: available.comments !== false,
  });
  const uiRequired = !filesAvailable || uiFiles.length > 0 || localVerification.uiBehavior === true;
  const browserVerification = validateBrowserVerification({
    uiRequired,
    localVerification,
    files: fileList,
  });
  const scopeMismatch = uiFiles.length > 0 && localVerification.uiBehavior === false;
  const implementationStatuses = [
    localVerification.status,
    uiRequired ? browserVerification.status : "PASS",
    scopeMismatch ? "FAIL" : "PASS",
    filesAvailable ? "PASS" : "BLOCKED",
  ];
  const implementationStatus = combineEvidenceStatuses(implementationStatuses);
  const aiReview = validateAiReview({
    headSha,
    comments,
    available: available.comments !== false,
  });
  const githubReview = validateGitHubReview({
    pullRequestAuthor: pullRequest?.user?.login,
    headSha,
    reviews,
    available: available.reviews !== false,
  });
  const branchReviewPolicy = summarizeBranchReviewPolicy({
    policy: mergePolicy,
    reviews,
    reviewsAvailable: available.reviews !== false,
    pullRequestAuthor: pullRequest?.user?.login,
    headSha,
  });
  const observedChecks = summarizeGitHubChecks({
    checkRuns,
    statuses,
    available:
      available.checkRuns !== false &&
      available.statuses !== false &&
      checkRuns.every((check) =>
        !check.head_sha || !validSha(headSha) || check.head_sha.toLowerCase() === headSha.toLowerCase(),
      ),
    command: headSha
      ? "GitHub check-runs and commit statuses for " + headSha
      : "GitHub check-runs and commit statuses for the current PR head",
  });
  const requiredChecks = summarizeRequiredGitHubChecks({
    requiredChecks: mergePolicy?.requiredChecks,
    checkRuns,
    statuses,
    available:
      mergePolicy?.available === true &&
      available.checkRuns !== false &&
      available.statuses !== false &&
      checkRuns.every((check) =>
        !check.head_sha || !validSha(headSha) || check.head_sha.toLowerCase() === headSha.toLowerCase(),
      ),
    headSha,
  });
  let ciPolicy;
  if (!mergePolicy?.available || mergePolicy.unassessedRules?.length) {
    ciPolicy = {
      status: "BLOCKED",
      details: mergePolicy?.unassessedRules?.length
        ? "Unassessed branch rules remain: " + mergePolicy.unassessedRules.join("; ") + "."
        : "Required check policy could not be read.",
    };
  } else if (mergePolicy.requiredChecks?.length) {
    const observedBlock = ["FAIL", "BLOCKED"].includes(observedChecks.status);
    const status = observedBlock
      ? observedChecks.status
      : requiredChecks.status;
    ciPolicy = {
      status,
      details: status === "PASS"
        ? "All configured required checks are green on the current SHA."
        : requiredChecks.details,
    };
  } else if (["FAIL", "BLOCKED"].includes(observedChecks.status)) {
    ciPolicy = {
      status: observedChecks.status,
      details: "A published current-SHA GitHub check is failing or pending.",
    };
  } else if (
    localVerification.status === "PASS" &&
    githubReview.status === "PASS" &&
    branchReviewPolicy.status === "PASS"
  ) {
    ciPolicy = {
      status: "PASS",
      details: "No required checks are configured; current-SHA local verification and formal external GitHub review satisfy the documented manual fallback.",
    };
  } else {
    ciPolicy = {
      status: "BLOCKED",
      details: "No required checks are configured. Local verification and formal external GitHub review must both pass before the manual fallback is satisfied.",
    };
  }
  const releaseRequirements = validateReleaseEvidence({
    files: fileList,
    filesAvailable,
    localVerification,
  });
  const prBlockers = [];
  if (!pullRequest) prBlockers.push("Pull request could not be read.");
  else if (pullRequest.state !== "open") {
    prBlockers.push(pullRequest.merged
      ? "Pull request is already merged."
      : "Pull request is not open.");
  }
  if (pullRequest?.draft) prBlockers.push("Pull request is still a draft.");
  if (baseRef !== expectedBase) {
    prBlockers.push("Pull request targets " + (baseRef || "an unknown branch") + "; expected " + expectedBase + ".");
  }
  if (!validSha(headSha)) prBlockers.push("Current PR head SHA is missing or invalid.");
  if (!headStable) prBlockers.push("PR head changed during verification; rerun against the new exact SHA.");
  const reviewBlockers = [];
  if (implementationStatus !== "PASS") {
    reviewBlockers.push("Implementation verification is " + implementationStatus + ": " +
      [
        localVerification.details,
        uiRequired ? browserVerification.details : "",
        scopeMismatch ? "UI files were declared as non-UI behavior." : "",
      ].filter(Boolean).join(" "));
  }
  if (aiReview.status !== "PASS") {
    reviewBlockers.push("Internal AI review is " + aiReview.status + ": " + aiReview.details);
  }
  if (verificationReviewBlocker(githubReview)) {
    reviewBlockers.push("The current formal GitHub review has unresolved high-severity findings or requests changes.");
  }
  const readyForExternalReview =
    prBlockers.length === 0 &&
    reviewBlockers.length === 0;
  const mergeBlockers = [...prBlockers, ...reviewBlockers];
  if (githubReview.status !== "PASS") {
    mergeBlockers.push("Formal GitHub review is " + githubReview.status + ": " + githubReview.details);
  }
  if (branchReviewPolicy.status !== "PASS") {
    mergeBlockers.push("Branch review policy is " + branchReviewPolicy.status + ": " + branchReviewPolicy.details);
  }
  if (ciPolicy.status !== "PASS") {
    mergeBlockers.push("GitHub check policy is " + ciPolicy.status + ": " + ciPolicy.details);
  }
  if (releaseRequirements.status !== "PASS") {
    mergeBlockers.push("Migration/dependency release obligations are " + releaseRequirements.status + ": " + releaseRequirements.details);
  }
  const readyForMerge = readyForExternalReview &&
    githubReview.status === "PASS" &&
    branchReviewPolicy.status === "PASS" &&
    ciPolicy.status === "PASS" &&
    releaseRequirements.status === "PASS";
  const decision = readyForMerge
    ? "READY_FOR_MERGE"
    : readyForExternalReview
      ? "READY_FOR_REVIEW"
      : "BLOCKED";
  return {
    decision,
    pullRequestNumber: number,
    currentSha: headSha,
    expectedBase,
    pullRequest: pullRequest
      ? {
          number,
          title: pullRequest.title,
          url: pullRequest.html_url,
          state: pullRequest.state,
          merged: Boolean(pullRequest.merged),
          draft: Boolean(pullRequest.draft),
          author: pullRequest.user?.login || null,
          baseRef,
          baseSha: pullRequest.base?.sha || null,
          headRef: pullRequest.head?.ref || null,
          headSha,
        }
      : { number, state: "unknown", baseRef: null, headSha: null },
    stages: {
      implementationComplete: implementationStatus === "PASS",
      implementationStatus,
      internalReviewComplete: aiReview.status === "PASS",
      readyForExternalReview,
      readyForMerge,
    },
    fileScope: {
      uiBehaviorRequired: uiRequired,
      uiFiles,
      migrationFiles: releaseRequirements.migrationFiles,
      dependencyManifests: releaseRequirements.dependencyManifests,
    },
    localVerification,
    browserVerification,
    aiReview,
    githubReview,
    checks: {
      observed: observedChecks,
      required: requiredChecks,
      branchReviewPolicy,
      policy: ciPolicy,
      policySources: mergePolicy.sources || [],
    },
    releaseRequirements,
    legacyEvidence: legacyVerificationSummary(pullRequest, headSha, fileList),
    mergeReadiness: {
      status: readyForMerge ? "PASS" : "BLOCKED",
      blockers: readyForMerge ? [] : [...new Set(mergeBlockers)],
    },
    reasons: readyForMerge ? [] : [...new Set(readyForExternalReview ? mergeBlockers : [...prBlockers, ...reviewBlockers])],
  };
}

export async function verifyPullRequest(client, pullRequestNumber, { expectedBase = "main" } = {}) {
  const number = parseIssueNumber(pullRequestNumber);
  const pullRequestPath = "/repos/" + client.owner + "/" + client.repo + "/pulls/" + number;
  let pullRequest;
  try {
    pullRequest = await client.request(pullRequestPath);
  } catch {
    return assessPullRequestVerification({
      pullRequest: null,
      expectedBase,
      available: {
        files: false,
        reviews: false,
        comments: false,
        checkRuns: false,
        statuses: false,
      },
      headStable: false,
    });
  }
  const headSha = pullRequest?.head?.sha;
  const baseRef = pullRequest?.base?.ref;
  const checksPath = validSha(headSha)
    ? "/repos/" + client.owner + "/" + client.repo + "/commits/" + headSha
    : null;
  const result = (promise) => promise.then((value) => ({ value })).catch((error) => ({ error }));
  const [
    reviewsResult,
    filesResult,
    commentsResult,
    checkRunsResult,
    statusesResult,
    mergePolicyResult,
  ] = await Promise.all([
    result(pagedRest(client, pullRequestPath + "/reviews")),
    result(pagedRest(client, pullRequestPath + "/files")),
    result(pagedRest(client, "/repos/" + client.owner + "/" + client.repo + "/issues/" + number + "/comments")),
    checksPath
      ? result(readAllCheckRuns(client, checksPath))
      : Promise.resolve({ error: new Error("Current PR head SHA is unavailable.") }),
    checksPath
      ? result(pagedRest(client, checksPath + "/statuses"))
      : Promise.resolve({ error: new Error("Current PR head SHA is unavailable.") }),
    baseRef
      ? result(readGitHubMergePolicy(client, baseRef))
      : Promise.resolve({ error: new Error("PR base branch is unavailable.") }),
  ]);
  const latestPullRequestResult = await result(client.request(pullRequestPath));
  const headStable = Boolean(
    latestPullRequestResult.value?.head?.sha &&
    latestPullRequestResult.value.head.sha.toLowerCase() === (headSha || "").toLowerCase(),
  );
  const mergePolicy = mergePolicyResult.value || {
    available: false,
    requiredChecks: null,
    requiredApprovals: null,
    unassessedRules: [],
    details: "GitHub merge policy could not be read.",
    error: mergePolicyResult.error?.message || latestPullRequestResult.error?.message || null,
  };
  return assessPullRequestVerification({
    pullRequest,
    expectedBase,
    files: filesResult.value || [],
    reviews: reviewsResult.value || [],
    comments: commentsResult.value || [],
    checkRuns: checkRunsResult.value || [],
    statuses: statusesResult.value || [],
    mergePolicy,
    available: {
      files: !filesResult.error,
      reviews: !reviewsResult.error,
      comments: !commentsResult.error,
      checkRuns: !checkRunsResult.error,
      statuses: !statusesResult.error,
    },
    headStable,
  });
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
      githubReview: validateGitHubReview({
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
  node scripts/agent-harness.mjs verify-pr <pull-request>
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
  if (command === "verify-pr") {
    if (fieldOrStatus || value || extra.length) {
      throw new Error("Use verify-pr <pull-request>.");
    }
    const verification = await verifyPullRequest(client, issueNumber);
    console.log(JSON.stringify(verification, null, 2));
    if (verification.decision !== "READY_FOR_MERGE") process.exitCode = 1;
    return;
  }
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
