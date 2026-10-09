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
const VERCEL_DEPLOYMENT_BOT = "vercel[bot]";
const VERCEL_PROJECT_DEPLOYMENT_HOST = /^lamilia-lomi-[a-z0-9]{9}-fantomxs-projects\.vercel\.app$/i;

function isVercelActor(actor) {
  return actor?.login?.toLowerCase() === VERCEL_DEPLOYMENT_BOT ||
    actor?.slug?.toLowerCase() === "vercel";
}

function isExpectedVercelProductionUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      url.pathname === "/" && !url.search && !url.hash &&
      VERCEL_PROJECT_DEPLOYMENT_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

function commentAuthoredBy(comment, expectedAuthor) {
  return typeof expectedAuthor !== "string" || !expectedAuthor.trim() ||
    comment?.user?.login?.toLowerCase() === expectedAuthor.trim().toLowerCase();
}

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
  const value = String(remoteUrl || "").trim();
  const scpRemote = value.match(/^git@github\.com:([^/]+)\/([^/?#]+?)(?:\.git)?$/i);
  if (scpRemote) return { owner: scpRemote[1], repo: scpRemote[2] };

  let url;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (!url || !["https:", "http:", "ssh:", "git:"].includes(url.protocol) ||
    url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Could not parse a GitHub owner/repository from origin.");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) throw new Error("Could not parse a GitHub owner/repository from origin.");
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, "");
  if (!owner || !repo) throw new Error("Could not parse a GitHub owner/repository from origin.");
  return { owner, repo };
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
    const parsedIntegrationId = rawIntegrationId === null ? null : Number(rawIntegrationId);
    const integrationId = parsedIntegrationId === -1 ? null : parsedIntegrationId;
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
const DELIVERY_MARKER = "<!-- agent-harness-delivery:v1 -->";
const ISSUE_DELIVERY_MARKER = "<!-- agent-harness-issue-delivery:v1 -->";
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
  const latestByReviewer = new Map();
  for (const review of currentShaReviews) {
    const reviewerKey = review.user.login.toLowerCase();
    if (!latestByReviewer.has(reviewerKey)) latestByReviewer.set(reviewerKey, review);
  }
  const reviewerAssessments = [...latestByReviewer.values()].map((review) => {
    const { fields, duplicates } = reviewFields(review.body || "");
    const reviewer = fields.reviewer || null;
    const reviewedSha = fields["reviewed sha"] || null;
    const findingsBySeverity = Object.fromEntries(
      REVIEW_SEVERITIES.map((severity) => [severity, fields[severity.toLowerCase()] || null]),
    );
    const unresolvedFindings = fields["unresolved findings"] || null;
    const unresolved = parseUnresolvedReviewFindings(unresolvedFindings);
    const complete =
      reviewer?.replace(/^@/, "").toLowerCase() === review.user.login.toLowerCase() &&
      reviewedSha?.toLowerCase() === headSha.toLowerCase() &&
      Object.values(findingsBySeverity).every(Boolean) &&
      Boolean(fields["fixes applied"]) &&
      Boolean(unresolvedFindings) &&
      unresolved.known &&
      duplicates.length === 0;
    return {
      review,
      fields,
      findingsBySeverity,
      fixesApplied: fields["fixes applied"] || null,
      unresolvedFindings,
      unresolved,
      complete,
      requestedChanges: review.state === "CHANGES_REQUESTED",
    };
  });
  const latest = currentShaReviews[0];
  const latestAssessment = reviewerAssessments.find(({ review }) => review === latest);
  const findingsBySeverity = latestAssessment.findingsBySeverity;
  const reviewedSha = latestAssessment.fields["reviewed sha"] || null;
  const fixesApplied = latestAssessment.fixesApplied;
  const outstandingChangeRequests = currentShaReviews
    .filter((review) => review.state === "CHANGES_REQUESTED")
    .map((review) => ({ reviewer: review.user.login, reviewedSha: review.commit_id }));
  const requestedChanges = outstandingChangeRequests.length > 0;
  const unresolvedSeverity = [...new Set(reviewerAssessments.flatMap((assessment) =>
    assessment.unresolved.severities,
  ))];
  const unresolvedHighOrCritical = unresolvedSeverity.some((severity) =>
    ["Critical", "High"].includes(severity),
  );
  const unresolvedFindings = reviewerAssessments.length === 1
    ? latestAssessment.unresolvedFindings
    : reviewerAssessments
        .filter((assessment) => assessment.unresolvedFindings)
        .map((assessment) => "@" + assessment.review.user.login + ": " + assessment.unresolvedFindings)
        .join("\n") || "none";
  const passed = latestAssessment.complete && !unresolvedHighOrCritical &&
    ["APPROVED", "COMMENTED", "CHANGES_REQUESTED"].includes(latest.state);
  return {
    status: passed ? "PASS" : "FAIL",
    reviewer: latest.user.login,
    reviewers: reviewerAssessments.map((assessment) => ({
      reviewer: assessment.review.user.login,
      state: assessment.review.state,
      reviewedSha: assessment.fields["reviewed sha"] || null,
      requestedChanges: assessment.requestedChanges,
      unresolvedSeverity: assessment.unresolved.severities,
    })),
    outstandingChangeRequests,
    reviewedSha: reviewedSha || null,
    findingsBySeverity,
    fixesApplied,
    unresolvedFindings,
    unresolvedSeverity,
    requestedChanges,
    details: passed
      ? requestedChanges
        ? "A current-SHA GitHub review requests changes, but it reports no unresolved Critical or High finding; only effective GitHub branch rules can require a formal review decision."
        : "Formal GitHub review by @" + latest.user.login + " covers the current head SHA."
      : unresolvedHighOrCritical
        ? "One or more current-SHA GitHub reviews report unresolved Critical or High findings."
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

export function validateAiReview({
  headSha,
  baseSha = null,
  comments = [],
  available = true,
  expectedAuthor = null,
}) {
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
  const currentForHead = marked.filter(({ record, error }) =>
    !error && record && typeof record === "object" && !Array.isArray(record) &&
    typeof record.reviewedSha === "string" && record.reviewedSha.toLowerCase() === headSha.toLowerCase(),
  );
  const currentForSha = currentForHead.filter(({ record }) =>
    !validSha(baseSha) || record.reviewedBaseSha?.toLowerCase?.() === baseSha.toLowerCase(),
  );
  const observedReviewedBaseShas = [...new Set(currentForHead
    .map(({ record }) => validSha(record.reviewedBaseSha) ? record.reviewedBaseSha.toLowerCase() : null)
    .filter(Boolean))];
  const observedReviewedBaseSha = observedReviewedBaseShas.length === 1 ? observedReviewedBaseShas[0] : null;
  const current = currentForSha.filter(({ comment }) => commentAuthoredBy(comment, expectedAuthor));
  if (!current.length && currentForHead.length && validSha(baseSha) && !currentForSha.length) {
    return {
      status: "BLOCKED",
      reviewedSha: headSha,
      reviewedBaseSha: observedReviewedBaseSha,
      reviewedBaseShaVerified: false,
      reviewers: [],
      findings: null,
      unresolvedFindings: null,
      details: "AI review records were prepared against a different or unrecorded base SHA.",
    };
  }
  if (!current.length && currentForSha.length) {
    return {
      status: "BLOCKED",
      reviewedSha: headSha,
      reviewedBaseSha: observedReviewedBaseSha,
      reviewedBaseShaVerified: false,
      reviewers: [],
      findings: null,
      unresolvedFindings: null,
      details: "Current-SHA AI review records were not posted by the pull request author.",
    };
  }
  if (!current.length) {
    const malformed = marked.some(({ record, error }) =>
      Boolean(error) || !record || typeof record !== "object" || Array.isArray(record) ||
      typeof record.reviewedSha !== "string" || !validSha(record.reviewedSha),
    );
    if (malformed) {
      return {
        status: "FAIL",
        reviewedSha: null,
        reviewedBaseSha: observedReviewedBaseSha,
        reviewedBaseShaVerified: false,
        reviewers: [],
        findings: null,
        unresolvedFindings: null,
        details: "An AI review marker is malformed and no valid current-SHA record supersedes it.",
      };
    }
    return {
      status: "BLOCKED",
      reviewedSha: marked.at(-1)?.record?.reviewedSha || null,
      reviewedBaseSha: observedReviewedBaseSha,
      reviewedBaseShaVerified: false,
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
      reviewedBaseSha: observedReviewedBaseSha,
      reviewedBaseShaVerified: false,
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
  const reviewerAgents = current.map(({ record }) => record.reviewerAgent.trim().toLowerCase());
  const distinctReviewerAgents = new Set(reviewerAgents);
  const duplicateReviewerAgents = distinctReviewerAgents.size !== reviewerAgents.length;
  const enoughIndependentReviews = distinctReviewerAgents.size >= 2;
  const status = unresolvedHighOrCritical || duplicateReviewerAgents
    ? "FAIL"
    : enoughIndependentReviews
      ? "PASS"
      : "BLOCKED";
  return {
    status,
    reviewedSha: headSha,
    reviewedBaseSha: validSha(baseSha) ? baseSha.toLowerCase() : null,
    reviewedBaseShaVerified: validSha(baseSha),
    requiredReviewCount: 2,
    independentReviewCount: distinctReviewerAgents.size,
    reviewers: current.map(({ record, comment }) => ({
      reviewerAgent: record.reviewerAgent,
      recordedBy: comment.user?.login || null,
    })),
    findings,
    unresolvedFindings,
    details: unresolvedHighOrCritical
      ? "AI sub-agent review reports unresolved Critical or High findings."
      : duplicateReviewerAgents
        ? "AI review records reuse a reviewer-agent identity; two distinct independent agents are required."
        : !enoughIndependentReviews
          ? distinctReviewerAgents.size + " of 2 required independent AI sub-agent reviews cover the current head SHA."
          : distinctReviewerAgents.size + " distinct independently tasked AI sub-agent reviews cover the current head SHA.",
  };
}

function latestMarkedRecord(comments, marker, headSha, expectedAuthor = null) {
  const marked = parseMarkedRecords(comments, marker);
  if (!marked.length) return { record: null, comment: null, stale: false, malformed: false };
  const currentForSha = marked
    .filter(({ record, error }) =>
      !error && record && typeof record === "object" && !Array.isArray(record) &&
      typeof record.headSha === "string" && record.headSha.toLowerCase() === headSha.toLowerCase(),
    );
  const current = currentForSha
    .filter(({ comment }) => commentAuthoredBy(comment, expectedAuthor))
    .sort((left, right) =>
      (left.comment.created_at || "").localeCompare(right.comment.created_at || ""),
    );
  if (!current.length) {
    if (currentForSha.length) {
      return { record: null, comment: null, stale: false, malformed: false, authorMismatch: true };
    }
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
  expectedAuthor = null,
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
  const selected = latestMarkedRecord(comments, VERIFICATION_MARKER, headSha, expectedAuthor);
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
  if (selected.authorMismatch) {
    return {
      status: "BLOCKED",
      reviewedSha: null,
      record: null,
      checks: {},
      uiBehavior: null,
      details: "Current-SHA verification evidence was not posted by the pull request author.",
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
  if (/(?:^|\/)__tests__\/|(?:^|\/)[^/]+\.(?:test|spec)\.[^.]+$/i.test(filename)) return false;
  const appSource = /^(?:src\/.*|app\/.*|components\/.*|pages\/.*|lib\/.*|messages\/.*|middleware\.[cm]?[jt]sx?|proxy\.[cm]?[jt]sx?)$/i;
  const appSourceExtension = /\.(?:[cm]?[jt]sx?|json|mdx?|svg|css|scss|sass|less)$/i;
  return (appSource.test(filename) && appSourceExtension.test(filename)) ||
    /^public\/.+$/i.test(filename) ||
    /^(?:tailwind|postcss|next)\.config\.[cm]?[jt]sx?$/i.test(filename) ||
    /\.(?:css|scss|sass|less)$/i.test(filename);
}

function isApplicationFlowFile(filename) {
  return (/^(?:src\/(?:app|pages|components|lib)|app|components|pages|lib)\//.test(filename) ||
      /^(?:src\/)?(?:middleware|proxy)\.[cm]?[jt]sx?$/i.test(filename) ||
      /^next\.config\.[cm]?[jt]sx?$/i.test(filename)) &&
    !/\.(?:test|spec)\.[^.]+$/i.test(filename);
}

function isValidProductionSmokePath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return false;
  try {
    const url = new URL(path, "https://agent-harness.invalid");
    return url.origin === "https://agent-harness.invalid" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function routePatternForFile(filename) {
  const normalized = filename.replace(/^src\//, "");
  const appMatch = normalized.match(/^app\/(?:(.*)\/)?(?:page|route)\.[^/]+$/i);
  const pagesMatch = normalized.match(/^pages\/(.+)\.[^/]+$/i);
  if (!appMatch && !pagesMatch) return null;
  const route = appMatch ? (appMatch[1] || "") : pagesMatch[1].replace(/(?:^|\/)index$/i, "");
  if (!appMatch && /(?:^|\/)_/.test(route)) return null;
  const segments = route.split("/").filter(Boolean)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")) && !segment.startsWith("@"))
    .map((segment) => {
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) return "(?:.+)?";
      if (/^\[\.\.\..+\]$/.test(segment)) return ".+";
      if (/^\[.+\]$/.test(segment)) return "[^/]+";
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
  return new RegExp("^/" + segments.join("/") + "/?$");
}

export function validateProductionSmokePlan({ files = [], localVerification }) {
  const changedFiles = files.map((file) => typeof file === "string" ? file : file.filename).filter(Boolean);
  const affectedFiles = changedFiles.filter(isApplicationFlowFile);
  if (!affectedFiles.length) {
    return {
      status: "PASS",
      required: false,
      paths: [],
      expectations: [],
      flows: [],
      details: "No application-flow files changed; the root Production health smoke is sufficient.",
    };
  }
  const plan = localVerification?.record?.productionSmokePlan;
  if (!plan || plan.status !== "PASS" || !Array.isArray(plan.flows) || !plan.flows.length) {
    return {
      status: "BLOCKED",
      required: true,
      paths: [],
      expectations: [],
      flows: [],
      details: "Application-flow changes require a current-SHA Production smoke plan that maps each changed file to its affected route and expected response content.",
    };
  }
  const affectedSet = new Set(affectedFiles);
  const covered = new Set();
  const paths = [];
  const expectations = [];
  const failures = [];
  for (const flow of plan.flows) {
    if (!flow || typeof flow.name !== "string" || !flow.name.trim() ||
      !Array.isArray(flow.affectedFiles) || !flow.affectedFiles.length ||
      !Array.isArray(flow.paths) || !flow.paths.length) {
      failures.push("Each smoke flow needs a name, changed-file mapping, and at least one expected route response.");
      continue;
    }
    const routePatterns = [];
    const validPathNames = [];
    for (const filename of flow.affectedFiles) {
      if (typeof filename !== "string" || !affectedSet.has(filename)) {
        failures.push("Smoke flow " + flow.name + " references a file that is not an application-flow change in this PR.");
        continue;
      }
      covered.add(filename);
      const routePattern = routePatternForFile(filename);
      if (routePattern) routePatterns.push({ filename, routePattern });
    }
    if (flow.routeFiles !== undefined && !Array.isArray(flow.routeFiles)) {
      failures.push("Smoke flow " + flow.name + " has an invalid routeFiles list.");
    } else {
      for (const filename of flow.routeFiles || []) {
        if (typeof filename !== "string" || !routePatternForFile(filename)) {
          failures.push("Smoke flow " + flow.name + " must map routeFiles to supported Next.js page or route modules.");
          continue;
        }
        if (!routePatterns.some((route) => route.filename === filename)) {
          routePatterns.push({ filename, routePattern: routePatternForFile(filename) });
        }
      }
    }
    if (!routePatterns.length) {
      failures.push("Smoke flow " + flow.name + " must identify a matching route module in affectedFiles or routeFiles.");
    }
    for (const expectation of flow.paths) {
      if (!expectation || !isValidProductionSmokePath(expectation.path) ||
        typeof expectation.expectedText !== "string" || !expectation.expectedText.trim()) {
        failures.push("Smoke flow " + flow.name + " has an invalid absolute path or missing expected response text.");
        continue;
      }
      const pathName = new URL(expectation.path, "https://agent-harness.invalid").pathname;
      if (!routePatterns.some(({ routePattern }) => routePattern.test(pathName))) {
        failures.push("Smoke path " + expectation.path + " does not match the changed route file(s) in flow " + flow.name + ".");
        continue;
      }
      validPathNames.push(pathName);
      paths.push(expectation.path);
      expectations.push({ path: expectation.path, expectedText: expectation.expectedText.trim(), flow: flow.name });
    }
    for (const { filename, routePattern } of routePatterns) {
      if (!validPathNames.some((pathName) => routePattern.test(pathName))) {
        failures.push("Smoke flow " + flow.name + " does not include an expected route response for " + filename + ".");
      }
    }
  }
  const uncovered = affectedFiles.filter((filename) => !covered.has(filename));
  if (uncovered.length) failures.push("Smoke plan does not map changed file(s): " + uncovered.join(", ") + ".");
  const uniquePaths = [...new Set(paths)];
  return {
    status: failures.length ? "BLOCKED" : "PASS",
    required: true,
    paths: uniquePaths,
    expectations,
    flows: plan.flows,
    details: failures.length
      ? failures.join(" ")
      : affectedFiles.length + " changed application-flow file(s) map to " + uniquePaths.length + " Production route(s) with expected response content.",
  };
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
  const changedFiles = new Map(files.map((file) => typeof file === "string"
    ? [file, null]
    : [file.filename, file.status]));
  const screenshots = Array.isArray(record.screenshots) ? record.screenshots : [];
  const testedSha = typeof record.testedSha === "string" ? record.testedSha : "";
  const runId = typeof record.runId === "string" ? record.runId.trim() : "";
  const screenshotsValid = validSha(testedSha) &&
    testedSha.toLowerCase() === localVerification.reviewedSha?.toLowerCase() &&
    Boolean(runId) && screenshots.length > 0 && screenshots.every((screenshot) =>
      screenshot && typeof screenshot === "object" &&
      typeof screenshot.path === "string" &&
      isVerificationScreenshot(screenshot.path) && changedFiles.has(screenshot.path) &&
      changedFiles.get(screenshot.path) !== "removed" &&
      screenshot.testedSha?.toLowerCase?.() === testedSha.toLowerCase() &&
      screenshot.runId === runId,
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
  if (!screenshotsValid) failures.push("screenshots must be listed in the PR files and bound to the current-SHA browser run ID");
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
    screenshots: screenshots.map((screenshot) => screenshot?.path).filter(Boolean),
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
  const migrationIds = requirements.migrationFiles.map((filename) =>
    filename.split("/").at(-1).replace(/\.sql$/i, "").toLowerCase(),
  );
  const namesEveryMigration = (evidence) =>
    Array.isArray(evidence?.migrationIds) &&
    evidence.migrationIds.length === migrationIds.length &&
    new Set(evidence.migrationIds.map((recordedId) => typeof recordedId === "string" ? recordedId.toLowerCase() : "")).size === migrationIds.length &&
    migrationIds.every((migrationId) => evidence.migrationIds.some((recordedId) =>
      typeof recordedId === "string" && recordedId.toLowerCase() === migrationId,
    ));
  const exactMigrationIds = (recordedIds, expectedIds) =>
    Array.isArray(recordedIds) && recordedIds.length === expectedIds.length &&
    new Set(recordedIds.map((recordedId) => typeof recordedId === "string" ? recordedId.toLowerCase() : "")).size === expectedIds.length &&
    expectedIds.every((migrationId) => recordedIds.some((recordedId) =>
      typeof recordedId === "string" && recordedId.toLowerCase() === migrationId,
    ));
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
  let stageMigration = { status: "PASS", required: false, details: "No Stage/local migration validation is required." };
  let preMergeMigration = { status: "PASS", required: false, details: "No pre-merge migration action is required." };
  let dependencyAudit = { status: "PASS", details: "No dependency manifest changed." };
  if (requirements.migrationFiles.length) {
    migrationCompatibility = normalize(record.migrationCompatibility, {
      status: "NOT RUN",
      command: "migration compatibility review",
      details: "Migration compatibility evidence is missing for the current SHA.",
    });
    const strategy = record.migrationCompatibility?.strategy;
    const sequence = record.migrationCompatibility?.deploymentSequence;
    if (!["compatible", "expand-contract"].includes(strategy)) {
      migrationCompatibility = {
        ...migrationCompatibility,
        status: migrationCompatibility.status === "FAIL" ? "FAIL" : "BLOCKED",
        details: "Migration strategy must explicitly be compatible or expand-contract.",
      };
    } else if (strategy === "expand-contract" && (
      !Array.isArray(sequence) ||
      sequence.length !== 3 ||
      sequence.some((step, index) => step !== ["expand", "compatible-deploy", "contract"][index])
    )) {
      migrationCompatibility = {
        ...migrationCompatibility,
        status: migrationCompatibility.status === "FAIL" ? "FAIL" : "BLOCKED",
        details: "A breaking migration must record deploymentSequence in the exact order: expand, compatible-deploy, contract.",
      };
    }
    const expandMigrationIds = record.migrationCompatibility?.expandMigrationIds;
    const contractMigrationIds = record.migrationCompatibility?.contractMigrationIds;
    if (migrationCompatibility.status === "PASS" && strategy === "expand-contract") {
      const normalizedExpand = Array.isArray(expandMigrationIds)
        ? expandMigrationIds.map((id) => typeof id === "string" ? id.toLowerCase() : "")
        : [];
      const normalizedContract = Array.isArray(contractMigrationIds)
        ? contractMigrationIds.map((id) => typeof id === "string" ? id.toLowerCase() : "")
        : [];
      const phaseIds = [...normalizedExpand, ...normalizedContract];
      const uniquePhaseIds = new Set(phaseIds);
      if (!normalizedExpand.length || !normalizedContract.length ||
        normalizedExpand.some((id) => !id) || normalizedContract.some((id) => !id) ||
        uniquePhaseIds.size !== phaseIds.length || phaseIds.length !== migrationIds.length ||
        migrationIds.some((id) => !uniquePhaseIds.has(id))) {
        migrationCompatibility = {
          ...migrationCompatibility,
          status: "BLOCKED",
          details: "Expand-contract evidence must assign every changed migration ID exactly once to non-empty expandMigrationIds and contractMigrationIds phases.",
        };
      }
    }
    if (migrationCompatibility.status === "PASS" && !namesEveryMigration(migrationCompatibility)) {
      migrationCompatibility = {
        ...migrationCompatibility,
        status: "BLOCKED",
        details: "Migration compatibility evidence must list the exact changed migration IDs.",
      };
    }
    stageMigration = normalize(record.stageMigration, {
      status: "BLOCKED",
      required: true,
      command: "Stage/local database migration validation",
      details: "Stage/local migration validation evidence is missing for the current SHA.",
    });
    if (stageMigration.status === "PASS" && stageMigration.required !== true) {
      stageMigration = {
        ...stageMigration,
        status: "BLOCKED",
        details: "Stage/local migration validation cannot be marked optional for a changed migration.",
      };
    }
    if (stageMigration.status === "PASS" && (
      !namesEveryMigration(stageMigration) ||
      !["stage", "local"].includes(String(stageMigration.environment || "").toLowerCase())
    )) {
      stageMigration = {
        ...stageMigration,
        status: "BLOCKED",
        details: "Stage/local migration evidence must name its environment and every changed migration ID.",
      };
    }
    preMergeMigration = normalize(record.preMergeMigration, {
      status: "BLOCKED",
      required: null,
      command: "pre-merge migration assessment",
      details: "The pre-merge migration requirement has not been explicitly assessed.",
    });
    if (strategy === "expand-contract" && preMergeMigration.required !== true) {
      preMergeMigration = {
        ...preMergeMigration,
        status: preMergeMigration.status === "FAIL" ? "FAIL" : "BLOCKED",
        details: "Expand-contract delivery requires the Production expand phase to pass before merge.",
      };
    } else if (preMergeMigration.required === true && preMergeMigration.status !== "PASS") {
      preMergeMigration = {
        ...preMergeMigration,
        status: preMergeMigration.status === "FAIL" ? "FAIL" : "BLOCKED",
      };
    } else if (preMergeMigration.required === true && (
      String(preMergeMigration.environment || "").toLowerCase() !== "production" ||
      (strategy === "expand-contract"
        ? preMergeMigration.phase !== "expand" || !exactMigrationIds(preMergeMigration.migrationIds, expandMigrationIds)
        : !namesEveryMigration(preMergeMigration))
    )) {
      preMergeMigration = {
        ...preMergeMigration,
        status: "BLOCKED",
        details: strategy === "expand-contract"
          ? "Required pre-merge migration evidence must confirm the Production expand phase and list exactly the expansion migration IDs."
          : "Required pre-merge migration evidence must confirm Production and list every changed migration ID.",
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
    results.push(migrationCompatibility.status, stageMigration.status, preMergeMigration.status);
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
    stageMigration,
    preMergeMigration,
    dependencyAudit,
  };
}

export function validatePostDeploymentMigrationEvidence({ files = [], filesAvailable = true, localVerification }) {
  const requirements = buildReleaseRequirements(files, { available: filesAvailable });
  if (!filesAvailable) return { status: "BLOCKED", required: null, details: "Changed files could not be read after deployment." };
  if (!requirements.migrationFiles.length) {
    return { status: "PASS", required: false, details: "No database migration changed." };
  }
  const release = localVerification?.record?.release || {};
  const strategy = release.migrationCompatibility?.strategy;
  if (strategy !== "expand-contract") {
    return { status: "PASS", required: false, details: "No post-deployment contract migration is required." };
  }
  const evidence = release.postDeployMigration;
  const migrationIds = requirements.migrationFiles.map((filename) =>
    filename.split("/").at(-1).replace(/\.sql$/i, "").toLowerCase(),
  );
  const contractIds = release.migrationCompatibility?.contractMigrationIds;
  const normalizedContractIds = Array.isArray(contractIds)
    ? contractIds.map((migrationId) => typeof migrationId === "string" ? migrationId.toLowerCase() : "")
    : [];
  const namesEveryMigration = normalizedContractIds.length > 0 &&
    normalizedContractIds.every(Boolean) &&
    Array.isArray(evidence?.migrationIds) && evidence.migrationIds.length === contractIds.length &&
    new Set(evidence.migrationIds.map((recordedId) => typeof recordedId === "string" ? recordedId.toLowerCase() : "")).size === contractIds.length &&
    normalizedContractIds.every((migrationId) => migrationIds.includes(migrationId) &&
      evidence.migrationIds.some((recordedId) =>
        typeof recordedId === "string" && recordedId.toLowerCase() === migrationId,
      ));
  if (!evidence || evidence.status !== "PASS" ||
    typeof evidence.command !== "string" || !evidence.command.trim() ||
    typeof evidence.details !== "string" || !evidence.details.trim() ||
    String(evidence.environment || "").toLowerCase() !== "production" ||
    evidence.phase !== "contract" ||
    !namesEveryMigration) {
    return {
      status: evidence?.status === "FAIL" ? "FAIL" : "BLOCKED",
      required: true,
      details: "The expand-contract sequence requires verified Production contract-phase evidence naming exactly the contract migration IDs.",
    };
  }
  return { status: "PASS", required: true, command: evidence.command, details: evidence.details };
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
      strictRequiredChecks: false,
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
    pagedRest(client, root + "/rules/branches/" + encodedBase)
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
      strictRequiredChecks: false,
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
  let strictRequiredChecks = false;
  let dismissStaleReviews = protection.required_pull_request_reviews?.dismiss_stale_reviews === true;
  let requireLastPushApproval = protection.required_pull_request_reviews?.require_last_push_approval === true;
  if (!Number.isSafeInteger(requiredApprovals) || requiredApprovals < 0) {
    requiredApprovals = null;
    unassessedRules.push("classic required-approval count is malformed");
  }
  for (const [key, value] of [
    ["dismiss_stale_reviews", protection.required_pull_request_reviews?.dismiss_stale_reviews],
    ["require_last_push_approval", protection.required_pull_request_reviews?.require_last_push_approval],
  ]) {
    if (value !== undefined && typeof value !== "boolean") {
      unassessedRules.push("classic pull-request review setting " + key + " is malformed");
    }
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
    strictRequiredChecks = true;
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
          strictRequiredChecks = true;
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
        requireLastPushApproval = true;
      } else if (parameters.require_last_push_approval !== undefined && typeof parameters.require_last_push_approval !== "boolean") {
        unassessedRules.push("ruleset latest-push approval setting is malformed");
      }
      if (parameters.dismiss_stale_reviews === true) {
        dismissStaleReviews = true;
      } else if (parameters.dismiss_stale_reviews !== undefined && typeof parameters.dismiss_stale_reviews !== "boolean") {
        unassessedRules.push("ruleset stale-review dismissal setting is malformed");
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
    strictRequiredChecks,
    dismissStaleReviews,
    requireLastPushApproval,
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
  pullRequestMergeableState = null,
  latestPushReviewDecision = null,
  latestPushReviewDecisionAvailable = false,
}) {
  if (!policy?.available || !reviewsAvailable || !validSha(headSha)) {
    return {
      status: "BLOCKED",
      approvalsRequired: policy?.requiredApprovals ?? null,
      approvalsPresent: null,
      waitingForApproval: false,
      unassessedRules: policy?.unassessedRules || [],
      details: "Branch review requirements or current-SHA reviews could not be verified.",
    };
  }
  if (policy.unassessedRules?.length) {
    return {
      status: "BLOCKED",
      approvalsRequired: policy.requiredApprovals,
      approvalsPresent: null,
      waitingForApproval: false,
      unassessedRules: policy.unassessedRules,
      details: "Additional mandatory branch rules are not evaluated: " + policy.unassessedRules.join("; ") + ".",
    };
  }
  if (policy.strictRequiredChecks === true &&
    !["clean", "unstable"].includes(String(pullRequestMergeableState || "").toLowerCase())) {
    const behind = String(pullRequestMergeableState || "").toLowerCase() === "behind";
    return {
      status: "BLOCKED",
      approvalsRequired: policy.requiredApprovals,
      approvalsPresent: null,
      waitingForApproval: false,
      unassessedRules: [],
      details: behind
        ? "GitHub reports that the PR branch is behind its base and the enforced up-to-date requirement is not satisfied."
        : "The enforced up-to-date requirement cannot be verified from GitHub's current PR merge state.",
    };
  }
  const latestReviewByUser = new Map();
  for (const review of reviews) {
    const login = review.user?.login?.toLowerCase();
    if (!login || login === (pullRequestAuthor || "").toLowerCase() ||
      ["PENDING", "DISMISSED"].includes(review.state)) continue;
    const previous = latestReviewByUser.get(login);
    if (!previous || (review.submitted_at || "") > (previous.submitted_at || "")) {
      latestReviewByUser.set(login, review);
    }
  }
  const approvals = new Set([...latestReviewByUser.entries()]
    .filter(([, review]) => review.state === "APPROVED" && (
      (policy.dismissStaleReviews !== true && policy.requireLastPushApproval !== true) ||
      review.commit_id?.toLowerCase() === headSha.toLowerCase()
    ))
    .map(([login]) => login));
  const required = Number(policy.requiredApprovals || 0);
  const enough = approvals.size >= required;
  const latestPushApproved = policy.requireLastPushApproval !== true ||
    (latestPushReviewDecisionAvailable && latestPushReviewDecision === "APPROVED");
  const waitingForLatestPushApproval = policy.requireLastPushApproval === true &&
    latestPushReviewDecisionAvailable && latestPushReviewDecision === "REVIEW_REQUIRED";
  return {
    status: enough && latestPushApproved ? "PASS" : "BLOCKED",
    approvalsRequired: required,
    approvalsPresent: approvals.size,
    waitingForApproval: !enough || waitingForLatestPushApproval,
    latestPushApprovalRequired: policy.requireLastPushApproval === true,
    latestPushReviewDecision: latestPushReviewDecisionAvailable ? latestPushReviewDecision : null,
    unassessedRules: [],
    details: !latestPushApproved
      ? "GitHub has not confirmed approval of the most recent reviewable push; the enforced latest-push approval rule remains unsatisfied or unreadable."
      : required
        ? approvals.size + " of " + required + " required current-SHA external approval(s) are present."
        : "No enforced external GitHub approval-count requirement is configured.",
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
  return review?.unresolvedSeverity?.some((severity) => ["Critical", "High"].includes(severity));
}

export function assessPullRequestVerification({
  pullRequest,
  repository = null,
  expectedBase = "main",
  files = [],
  reviews = [],
  comments = [],
  commitMessages = [],
  checkRuns = [],
  statuses = [],
  mergePolicy = { available: false, requiredChecks: null, requiredApprovals: null, unassessedRules: [] },
  latestPushReviewDecision = null,
  latestPushReviewDecisionAvailable = false,
  available = {},
  allowAlreadyMerged = false,
  snapshotStable = true,
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
    expectedAuthor: pullRequest?.user?.login || null,
  });
  const productionSmokePlan = validateProductionSmokePlan({
    files: fileList,
    localVerification,
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
    productionSmokePlan.status,
    uiRequired ? browserVerification.status : "PASS",
    scopeMismatch ? "FAIL" : "PASS",
    filesAvailable ? "PASS" : "BLOCKED",
  ];
  const implementationStatus = combineEvidenceStatuses(implementationStatuses);
  const aiReview = validateAiReview({
    headSha,
    baseSha: pullRequest?.base?.sha || null,
    comments,
    available: available.comments !== false,
    expectedAuthor: pullRequest?.user?.login || null,
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
    pullRequestMergeableState: pullRequest?.mergeable_state || null,
    latestPushReviewDecision,
    latestPushReviewDecisionAvailable,
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
    const status = requiredChecks.status;
    ciPolicy = {
      status,
      details: status === "PASS"
        ? "All configured required checks are green on the current SHA."
        : requiredChecks.details,
    };
  } else if (
    localVerification.status === "PASS" &&
    aiReview.status === "PASS"
  ) {
    ciPolicy = {
      status: "PASS",
      details: "No required checks are configured; current-SHA local verification and two independent AI reviews satisfy the CI fallback. Optional GitHub checks are informational.",
    };
  } else {
    ciPolicy = {
      status: "BLOCKED",
      details: "No required checks are configured; current-SHA local verification and two independent AI reviews must pass.",
    };
  }
  const releaseRequirements = validateReleaseEvidence({
    files: fileList,
    filesAvailable,
    localVerification,
  });
  const prBlockers = [];
  const closingIssueReferences = repository && !allowAlreadyMerged
    ? findClosingIssueReferences(pullRequest?.body || "", repository)
    : [];
  const closingCommitReferences = repository && !allowAlreadyMerged
    ? [...new Set(commitMessages.flatMap((message) => findClosingIssueReferences(message, repository)))]
    : [];
  if (!allowAlreadyMerged && available.commits === false) {
    prBlockers.push("PR commit history could not be read, so GitHub auto-close issue references could not be ruled out.");
  }
  if (closingIssueReferences.length) {
    prBlockers.push("PR body uses GitHub auto-close issue references (" +
      closingIssueReferences.map((issue) => "#" + issue).join(", ") +
      "); use non-closing references so issues remain open until Production verification.");
  }
  if (closingCommitReferences.length) {
    prBlockers.push("PR commit message(s) use GitHub auto-close issue references (" +
      closingCommitReferences.map((issue) => "#" + issue).join(", ") +
      "); rewrite the messages or squash them with non-closing wording before merge.");
  }
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
  if (!snapshotStable) {
    prBlockers.push("PR state, draft status, base, or head changed during verification; rerun against the current snapshot.");
  }
  const reviewBlockers = [];
  if (implementationStatus !== "PASS") {
    reviewBlockers.push("Implementation verification is " + implementationStatus + ": " +
      [
        localVerification.details,
        productionSmokePlan.required ? productionSmokePlan.details : "",
        uiRequired ? browserVerification.details : "",
        scopeMismatch ? "UI files were declared as non-UI behavior." : "",
      ].filter(Boolean).join(" "));
  }
  if (aiReview.status !== "PASS") {
    reviewBlockers.push("Internal AI review is " + aiReview.status + ": " + aiReview.details);
  }
  if (verificationReviewBlocker(githubReview)) {
    reviewBlockers.push("The current formal GitHub review reports unresolved Critical or High findings.");
  }
  const qualityGatesComplete =
    prBlockers.length === 0 &&
    reviewBlockers.length === 0;
  const mergeBlockers = [...prBlockers, ...reviewBlockers];
  if (branchReviewPolicy.status !== "PASS") {
    mergeBlockers.push("Branch review policy is " + branchReviewPolicy.status + ": " + branchReviewPolicy.details);
  }
  if (ciPolicy.status !== "PASS") {
    mergeBlockers.push("GitHub check policy is " + ciPolicy.status + ": " + ciPolicy.details);
  }
  if (releaseRequirements.status !== "PASS") {
    mergeBlockers.push("Migration/dependency release obligations are " + releaseRequirements.status + ": " + releaseRequirements.details);
  }
  const mergeability = pullRequest?.mergeable === true
    ? { status: "PASS", details: "GitHub reports that the PR can merge without conflicts." }
    : pullRequest?.mergeable === false
      ? {
          status: "FAIL",
          details: "GitHub reports the PR is not mergeable" +
            (pullRequest.mergeable_state ? " (" + pullRequest.mergeable_state + ")" : "") + ".",
        }
      : { status: "BLOCKED", details: "GitHub mergeability is unknown; rerun after GitHub computes the merge result." };
  if (mergeability.status !== "PASS") {
    mergeBlockers.push("GitHub mergeability is " + mergeability.status + ": " + mergeability.details);
  }
  const mergeReadyExceptRequiredApproval = qualityGatesComplete &&
    mergeability.status === "PASS" &&
    ciPolicy.status === "PASS" &&
    releaseRequirements.status === "PASS";
  const readyForMerge = mergeReadyExceptRequiredApproval &&
    branchReviewPolicy.status === "PASS";
  const waitingForEnforcedApproval = mergeReadyExceptRequiredApproval &&
    branchReviewPolicy.status === "BLOCKED" &&
    branchReviewPolicy.waitingForApproval === true;
  const decision = readyForMerge
    ? "READY_FOR_MERGE"
    : waitingForEnforcedApproval
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
          mergeable: typeof pullRequest.mergeable === "boolean" ? pullRequest.mergeable : null,
          mergeableState: pullRequest.mergeable_state || null,
        }
      : { number, state: "unknown", baseRef: null, headSha: null },
    stages: {
      implementationComplete: implementationStatus === "PASS",
      implementationStatus,
      internalReviewComplete: aiReview.status === "PASS",
      qualityGatesComplete,
      waitingForEnforcedApproval,
      readyForMerge,
    },
    fileScope: {
      files: fileNames,
      uiBehaviorRequired: uiRequired,
      uiFiles,
      productionSmokePlan,
      migrationFiles: releaseRequirements.migrationFiles,
      dependencyManifests: releaseRequirements.dependencyManifests,
    },
    localVerification,
    browserVerification,
    productionSmokePlan,
    aiReview,
    githubReview,
    mergeability,
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
    reasons: readyForMerge ? [] : [...new Set(mergeBlockers)],
  };
}

async function readPullRequestReviewDecision(client, pullRequestNumber) {
  if (typeof client.graphql !== "function") {
    throw new Error("GitHub GraphQL review decision is unavailable.");
  }
  const data = await client.graphql(`
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) { reviewDecision }
      }
    }
  `, { owner: client.owner, repo: client.repo, number: pullRequestNumber });
  const pullRequest = data.repository?.pullRequest;
  if (!pullRequest || !Object.prototype.hasOwnProperty.call(pullRequest, "reviewDecision")) {
    throw new Error("GitHub returned no pull-request review decision.");
  }
  const decision = pullRequest.reviewDecision;
  if (decision !== null && !["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"].includes(decision)) {
    throw new Error("GitHub returned an unknown pull-request review decision.");
  }
  return decision;
}

export async function verifyPullRequest(client, pullRequestNumber, {
  expectedBase = "main",
  allowMerged = false,
} = {}) {
  const number = parseIssueNumber(pullRequestNumber);
  const pullRequestPath = "/repos/" + client.owner + "/" + client.repo + "/pulls/" + number;
  let pullRequest;
  try {
    pullRequest = await client.request(pullRequestPath);
  } catch {
    return assessPullRequestVerification({
      pullRequest: null,
      repository: client.owner + "/" + client.repo,
      expectedBase,
      available: {
        files: false,
        reviews: false,
        comments: false,
        commits: false,
        checkRuns: false,
        statuses: false,
      },
      snapshotStable: false,
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
    commitsResult,
    checkRunsResult,
    statusesResult,
    mergePolicyResult,
  ] = await Promise.all([
    result(pagedRest(client, pullRequestPath + "/reviews")),
    result(pagedRest(client, pullRequestPath + "/files")),
    result(pagedRest(client, "/repos/" + client.owner + "/" + client.repo + "/issues/" + number + "/comments")),
    result(readPullRequestCommitMessages(client, number)),
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
  const latestPullRequest = latestPullRequestResult.value;
  const isMergedRecovery = allowMerged && Boolean(pullRequest?.merged) && Boolean(latestPullRequest?.merged);
  const snapshotStable = Boolean(
    latestPullRequest &&
    latestPullRequest.head?.sha === pullRequest.head?.sha &&
    latestPullRequest.state === pullRequest.state &&
    Boolean(latestPullRequest.merged) === Boolean(pullRequest.merged) &&
    Boolean(latestPullRequest.draft) === Boolean(pullRequest.draft) &&
    latestPullRequest.base?.ref === pullRequest.base?.ref &&
    (isMergedRecovery
      ? latestPullRequest.merge_commit_sha?.toLowerCase() === pullRequest.merge_commit_sha?.toLowerCase()
      : latestPullRequest.base?.sha === pullRequest.base?.sha),
  );
  const assessmentPullRequest = latestPullRequest || pullRequest;
  const mergePolicy = mergePolicyResult.value || {
    available: false,
    requiredChecks: null,
    requiredApprovals: null,
    unassessedRules: [],
    details: "GitHub merge policy could not be read.",
    error: mergePolicyResult.error?.message || latestPullRequestResult.error?.message || null,
  };
  const latestPushReviewDecisionResult = mergePolicy.requireLastPushApproval === true
    ? await result(readPullRequestReviewDecision(client, number))
    : { value: null };
  const validateAsMergedDelivery = allowMerged && Boolean(assessmentPullRequest?.merged);
  let mergedBaseSha = null;
  if (validateAsMergedDelivery && validSha(assessmentPullRequest.merge_commit_sha)) {
    const mergeCommitResult = await result(client.request(
      "/repos/" + client.owner + "/" + client.repo + "/commits/" + assessmentPullRequest.merge_commit_sha,
    ));
    const parents = mergeCommitResult.value?.parents;
    if (Array.isArray(parents) && parents.length >= 2 && validSha(parents[0]?.sha)) {
      mergedBaseSha = parents[0].sha.toLowerCase();
    }
  }
  const mergedBaseUnavailable = validateAsMergedDelivery && !validSha(mergedBaseSha);
  const verificationPullRequest = validateAsMergedDelivery
    ? {
        ...assessmentPullRequest,
        base: {
          ...assessmentPullRequest.base,
          sha: validSha(mergedBaseSha) ? mergedBaseSha : assessmentPullRequest.base?.sha,
        },
        state: "open",
        merged: false,
        mergeable: true,
        mergeable_state: "clean",
      }
    : assessmentPullRequest;
  const verification = assessPullRequestVerification({
    pullRequest: verificationPullRequest,
    repository: client.owner + "/" + client.repo,
    expectedBase,
    files: filesResult.value || [],
    reviews: reviewsResult.value || [],
    comments: commentsResult.value || [],
    commitMessages: commitsResult.value || [],
    checkRuns: checkRunsResult.value || [],
    statuses: statusesResult.value || [],
    mergePolicy,
    latestPushReviewDecision: latestPushReviewDecisionResult.value ?? null,
    latestPushReviewDecisionAvailable: !latestPushReviewDecisionResult.error,
    available: {
      files: !filesResult.error,
      reviews: !reviewsResult.error,
      comments: !commentsResult.error,
      commits: !commitsResult.error,
      checkRuns: !checkRunsResult.error,
      statuses: !statusesResult.error,
    },
    allowAlreadyMerged: validateAsMergedDelivery,
    snapshotStable,
  });
  if (mergedBaseUnavailable) {
    return {
      ...verification,
      decision: "BLOCKED",
      mergeBase: {
        status: "BLOCKED",
        sha: null,
        reviewedBaseSha: verification.aiReview?.reviewedBaseSha || null,
        reviewedBaseShaVerified: verification.aiReview?.reviewedBaseShaVerified === true,
        details: "The merged PR's first parent could not be verified against current-SHA AI review evidence.",
      },
      reasons: [...new Set([
        ...(verification.reasons || []),
        "The merged PR's reviewed base SHA could not be verified from the immutable merge commit's first parent.",
      ])],
    };
  }
  const mergeBaseMatchesReview = verification.aiReview?.reviewedBaseShaVerified === true &&
    verification.aiReview.reviewedBaseSha?.toLowerCase() === mergedBaseSha;
  const mergeBaseEvidence = {
    status: mergeBaseMatchesReview ? "PASS" : "BLOCKED",
    sha: mergedBaseSha,
    reviewedBaseSha: verification.aiReview?.reviewedBaseSha || null,
    reviewedBaseShaVerified: verification.aiReview?.reviewedBaseShaVerified === true,
    details: mergeBaseMatchesReview
      ? "The immutable first parent matches the base SHA bound to valid current-SHA AI reviews."
      : "Current-SHA AI review evidence does not verify the immutable first parent as its reviewed base.",
  };
  if (validateAsMergedDelivery && verification.decision === "READY_FOR_MERGE") {
    return {
      ...verification,
      decision: "VERIFIED_MERGE",
      mergeBase: mergeBaseEvidence,
      pullRequest: {
        ...verification.pullRequest,
        state: "closed",
        merged: true,
        mergeCommitSha: assessmentPullRequest.merge_commit_sha || null,
      },
    };
  }
  return validateAsMergedDelivery
    ? { ...verification, mergeBase: mergeBaseEvidence }
    : verification;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export async function waitForProductionDeployment(client, mergeSha, {
  timeoutMs = 10 * 60 * 1000,
  pollIntervalMs = 15 * 1000,
  sleep = delay,
  now = Date.now,
} = {}) {
  if (!validSha(mergeSha)) {
    return { status: "BLOCKED", deployment: null, details: "The verified merge commit SHA is missing or invalid." };
  }
  const deploymentsPath = "/repos/" + client.owner + "/" + client.repo +
    "/deployments?sha=" + encodeURIComponent(mergeSha) + "&environment=Production";
  const deadline = now() + timeoutMs;
  let lastObserved = null;
  let lastReadError = null;
  do {
    let deployments;
    try {
      deployments = await pagedRest(client, deploymentsPath);
    } catch (error) {
      lastReadError = "GitHub Production deployment records could not be read: " + error.message;
      if (now() >= deadline) break;
      await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
      continue;
    }
    const exactShaDeployments = deployments
      .filter((deployment) =>
        deployment?.sha?.toLowerCase() === mergeSha.toLowerCase() &&
        deployment.environment?.toLowerCase() === "production",
      )
      .sort((left, right) => (right.created_at || "").localeCompare(left.created_at || ""));
    const vercelDeployments = exactShaDeployments.filter((deployment) =>
      (isVercelActor(deployment.creator) || isVercelActor(deployment.performed_via_github_app)) &&
      deployment.task === "deploy" &&
      deployment.ref?.toLowerCase() === mergeSha.toLowerCase(),
    );
    if (!vercelDeployments.length && exactShaDeployments.length) {
      lastReadError = "Exact-SHA Production deployment records exist, but none are verifiable as a Vercel Git deployment for this project.";
    }
    if (vercelDeployments.length) {
      const deployment = vercelDeployments[0];
      let statuses;
      try {
        statuses = await pagedRest(
          client,
          "/repos/" + client.owner + "/" + client.repo + "/deployments/" + deployment.id + "/statuses",
        );
      } catch (error) {
        lastReadError = "The Production deployment exists, but its readiness status could not be read: " + error.message;
        if (now() >= deadline) break;
        await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
        continue;
      }
      const latest = [...statuses].sort((left, right) =>
        (right.created_at || "").localeCompare(left.created_at || ""),
      )[0];
      lastObserved = {
        id: deployment.id,
        sha: deployment.sha,
        ref: deployment.ref,
        environment: deployment.environment,
        createdAt: deployment.created_at || null,
        state: latest?.state?.toLowerCase() || "pending",
        environmentUrl: latest?.environment_url || null,
        statusUrl: latest?.target_url || null,
        logUrl: latest?.log_url || null,
        description: latest?.description || null,
        provider: "Vercel Git integration",
        providerActor: deployment.creator?.login || deployment.performed_via_github_app?.slug || null,
        statusActor: latest?.creator?.login || latest?.performed_via_github_app?.slug || null,
      };
      if (lastObserved.state === "success") {
        if (!isVercelActor(latest?.creator) && !isVercelActor(latest?.performed_via_github_app)) {
          return {
            status: "BLOCKED",
            deployment: lastObserved,
            details: "GitHub reports success, but the status was not authored by the Vercel Git integration.",
          };
        }
        if (!lastObserved.environmentUrl) {
          return {
            status: "BLOCKED",
            deployment: lastObserved,
            details: "GitHub reports the deployment ready but did not provide its Production environment URL.",
          };
        }
        if (!isExpectedVercelProductionUrl(lastObserved.environmentUrl)) {
          return {
            status: "BLOCKED",
            deployment: lastObserved,
            details: "The Vercel deployment URL does not identify this repository's expected Production project.",
          };
        }
        return {
          status: "PASS",
          deployment: lastObserved,
          details: "Vercel's Git integration reports a successful Production deployment for the exact merge SHA and expected project origin.",
        };
      }
      if (["failure", "error", "inactive"].includes(lastObserved.state)) {
        if (!isVercelActor(latest?.creator) && !isVercelActor(latest?.performed_via_github_app)) {
          lastReadError = "The latest deployment status is not authored by the Vercel Git integration.";
        } else {
          return {
            status: "FAIL",
            deployment: lastObserved,
            details: "The exact-SHA Production deployment ended in state " + lastObserved.state +
              (lastObserved.description ? ": " + lastObserved.description : ".") +
              (lastObserved.logUrl ? " Logs: " + lastObserved.logUrl : "") +
              (lastObserved.statusUrl ? " Deployment details: " + lastObserved.statusUrl : ""),
          };
        }
      }
    }
    if (now() >= deadline) break;
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
  } while (now() <= deadline);
  return {
    status: "BLOCKED",
    deployment: lastObserved,
    details: lastReadError
      ? lastReadError + " The exact-SHA Production check will need a fresh retry."
      : lastObserved
        ? "Timed out waiting for the exact-SHA Production deployment; latest state is " + lastObserved.state + "."
        : "No Production deployment for the exact merge SHA appeared before the wait timed out.",
  };
}

export async function runProductionSmoke(environmentUrl, {
  paths = (process.env.AGENT_HARNESS_PRODUCTION_SMOKE_PATHS || "/")
    .split(",").map((path) => path.trim()).filter(Boolean),
  expectations = [],
  fetchImpl = fetch,
  timeoutMs = 15_000,
} = {}) {
  let baseUrl;
  try {
    baseUrl = new URL(environmentUrl);
  } catch {
    return { status: "BLOCKED", checks: [], details: "Production environment URL is missing or invalid." };
  }
  if (baseUrl.protocol !== "https:") {
    return { status: "BLOCKED", checks: [], details: "Production smoke requires an HTTPS environment URL." };
  }
  if (!paths.length || paths.some((path) => !isValidProductionSmokePath(path))) {
    return { status: "BLOCKED", checks: [], details: "Production smoke paths must be non-empty same-origin absolute paths." };
  }
  if (!Array.isArray(expectations) || expectations.some((expectation) =>
    !expectation || !paths.includes(expectation.path) ||
    typeof expectation.expectedText !== "string" || !expectation.expectedText.trim(),
  )) {
    return { status: "BLOCKED", checks: [], details: "Production smoke expectations must name an included path and non-empty expected content." };
  }
  const checks = [];
  for (const path of paths) {
    const url = new URL(path, baseUrl);
    if (url.origin !== baseUrl.origin) {
      return { status: "BLOCKED", checks, details: "Production smoke paths must stay on the deployed environment origin." };
    }
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.text();
      const finalUrl = new URL(response.url || url.href);
      const check = {
        path,
        statusCode: response.status,
        contentType: response.headers?.get?.("content-type") || null,
        responseBytes: Buffer.byteLength(body),
        finalUrl: finalUrl.href,
      };
      const expectedForPath = expectations.filter((expectation) => expectation.path === path);
      const expectedTextMatched = expectedForPath.every((expectation) => body.includes(expectation.expectedText));
      if (expectedForPath.length) {
        check.expectedText = expectedForPath.map((expectation) => expectation.expectedText);
        check.expectedTextMatched = expectedTextMatched;
      }
      checks.push(check);
      if (!response.ok || finalUrl.origin !== baseUrl.origin || !body.trim() || !expectedTextMatched) {
        return {
          status: "FAIL",
          checks,
          details: "Production smoke failed for " + path + " (HTTP " + response.status +
            (finalUrl.origin !== baseUrl.origin ? ", redirected outside the deployment origin" : "") +
            (!body.trim() ? ", empty response body" : "") +
            (!expectedTextMatched ? ", expected content was not present" : "") + ").",
        };
      }
    } catch (error) {
      return {
        status: "FAIL",
        checks,
        details: "Production smoke request failed for " + path + ": " + error.message,
      };
    }
  }
  return { status: "PASS", checks, details: checks.length + " focused Production smoke path(s) returned non-empty successful responses." };
}

function formatDeliveryComment(record) {
  return DELIVERY_MARKER + "\n```json\n" + JSON.stringify(record, null, 2) + "\n```";
}

function formatIssueDeliveryComment(record) {
  return ISSUE_DELIVERY_MARKER + "\n```json\n" + JSON.stringify(record, null, 2) + "\n```";
}

async function readVerifiedIssueDelivery(client, issueNumber, pullRequest) {
  const mergeSha = pullRequest.merge_commit_sha?.toLowerCase();
  const candidateSha = pullRequest.head?.sha?.toLowerCase();
  const expectedAuthor = pullRequest.user?.login;
  if (!validSha(mergeSha) || !validSha(candidateSha)) return null;
  if (typeof expectedAuthor !== "string" || !expectedAuthor.trim()) {
    throw new Error("The merged PR author could not be verified for prior delivery evidence.");
  }
  const comments = await pagedRest(client, "/repos/" + client.owner + "/" + client.repo + "/issues/" + issueNumber + "/comments");
  return parseMarkedRecords(comments, ISSUE_DELIVERY_MARKER)
    .filter(({ record, error, comment }) => commentAuthoredBy(comment, expectedAuthor) && !error && record && record.schemaVersion === 1 &&
      record.status === "PASS" && record.issueNumber === issueNumber &&
      record.pullRequestNumber === pullRequest.number &&
      record.candidateSha?.toLowerCase?.() === candidateSha &&
      record.mergeSha?.toLowerCase?.() === mergeSha &&
      record.productionDeployment?.status === "PASS" &&
      record.productionDeployment?.deployment?.sha?.toLowerCase?.() === mergeSha &&
      record.productionSmoke?.status === "PASS" &&
      record.postDeploymentMigration?.status === "PASS",
    )
    .sort((left, right) => (right.comment.created_at || "").localeCompare(left.comment.created_at || ""))[0]?.record || null;
}

export function closesIssueReference(text = "", issueNumber, repository) {
  const number = parseIssueNumber(issueNumber);
  return findClosingIssueReferences(text, repository).includes(number);
}

export function findClosingIssueReferences(text = "", repository) {
  const [owner, repo] = (repository || "").split("/");
  if (!owner || !repo) throw new Error("A repository in owner/name form is required to match issue references.");
  const escapedRepository = `${owner}/${repo}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reference = `(?:${escapedRepository}#(\\d+)|(?<![\\w/])#(\\d+)|https?://github\\.com/${escapedRepository}/issues/(\\d+)(?:[?#/.,;:]|$))`;
  const matcher = new RegExp(`\\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\\s*:?[\\t\\r\\n ]+${reference}(?=$|\\W)`, "gi");
  const found = [];
  for (const match of String(text).matchAll(matcher)) {
    const number = Number(match[1] || match[2] || match[3]);
    if (Number.isSafeInteger(number) && !found.includes(number)) found.push(number);
  }
  return found;
}

async function readPullRequestCommitsViaGraphql(client, pullRequestNumber) {
  if (typeof client.graphql !== "function") {
    throw new Error("GitHub REST commit history reached its 250-commit limit and GraphQL is unavailable.");
  }
  let after = null;
  const seenCursors = new Set();
  const commits = [];
  for (let page = 0; page < 100; page += 1) {
    const data = await client.graphql(`
      query($owner: String!, $repo: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            commits(first: 100, after: $after) {
              nodes { commit { oid message } }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    `, { owner: client.owner, repo: client.repo, number: pullRequestNumber, after });
    const connection = data.repository?.pullRequest?.commits;
    if (!Array.isArray(connection?.nodes) || !connection.pageInfo ||
      typeof connection.pageInfo.hasNextPage !== "boolean") {
      throw new Error("GitHub returned incomplete GraphQL pull-request commit history.");
    }
    for (const node of connection.nodes) {
      const sha = node?.commit?.oid;
      const message = node?.commit?.message;
      if (!validSha(sha) || typeof message !== "string") {
        throw new Error("GitHub returned an incomplete GraphQL pull-request commit SHA/message list.");
      }
      commits.push({ sha, commit: { message } });
    }
    if (!connection.pageInfo.hasNextPage) break;
    const cursor = connection.pageInfo.endCursor;
    if (typeof cursor !== "string" || !cursor || seenCursors.has(cursor)) {
      throw new Error("GitHub returned an invalid GraphQL commit-history pagination cursor.");
    }
    seenCursors.add(cursor);
    after = cursor;
    if (page === 99) throw new Error("GraphQL pull-request commit-history pagination limit reached.");
  }
  if (!commits.length) throw new Error("GitHub returned no GraphQL pull-request commits to validate.");
  return commits;
}

async function readPullRequestCommits(client, pullRequestNumber) {
  const commits = await pagedRest(
    client,
    "/repos/" + client.owner + "/" + client.repo + "/pulls/" + pullRequestNumber + "/commits",
  );
  if (!Array.isArray(commits) || !commits.length) {
    throw new Error("GitHub returned no pull-request commits to validate.");
  }
  if (commits.length >= 250) {
    return readPullRequestCommitsViaGraphql(client, pullRequestNumber);
  }
  if (commits.some((commit) => !validSha(commit?.sha) || typeof commit?.commit?.message !== "string")) {
    throw new Error("GitHub returned an incomplete pull-request commit SHA/message list.");
  }
  return commits;
}

async function readPullRequestCommitMessages(client, pullRequestNumber) {
  const commits = await readPullRequestCommits(client, pullRequestNumber);
  return commits.map((commit) => commit.commit.message);
}

async function issueWasClosedByPullRequest(client, issueNumber, pullRequest, pullRequestCommitShas) {
  let after = null;
  let issue;
  const closeEvents = [];
  for (let page = 0; page < 10; page += 1) {
    const data = await client.graphql(`
      query($owner: String!, $repo: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            closedAt
            timelineItems(first: 100, after: $after, itemTypes: [CLOSED_EVENT]) {
              nodes {
                ... on ClosedEvent {
                  createdAt
                  closer {
                    __typename
                    ... on PullRequest { number mergeCommit { oid } }
                    ... on Commit { oid }
                  }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    `, { owner: client.owner, repo: client.repo, number: issueNumber, after });
    issue = data.repository?.issue;
    if (!issue) return false;
    const connection = issue.timelineItems;
    if (!Array.isArray(connection?.nodes)) throw new Error("GitHub returned no issue closure timeline evidence.");
    if (!connection.pageInfo || typeof connection.pageInfo.hasNextPage !== "boolean") {
      throw new Error("GitHub returned incomplete issue closure timeline pagination evidence.");
    }
    closeEvents.push(...connection.nodes.filter((event) => event?.createdAt));
    if (!connection.pageInfo?.hasNextPage) break;
    if (!connection.pageInfo.endCursor) throw new Error("Issue closure timeline has an invalid pagination cursor.");
    after = connection.pageInfo.endCursor;
    if (page === 9) throw new Error("Issue closure timeline pagination limit reached; closure source is unknown.");
  }
  const closedAt = Date.parse(issue.closedAt || "");
  if (!Number.isFinite(closedAt)) throw new Error("GitHub returned no valid issue close time.");
  const latestCloseTime = Math.max(...closeEvents.map((event) => Date.parse(event.createdAt)).filter(Number.isFinite));
  if (!Number.isFinite(latestCloseTime) || Math.abs(latestCloseTime - closedAt) > 5_000) return false;
  const mergedAt = Date.parse(pullRequest.merged_at || "");
  if (!Number.isFinite(mergedAt) || latestCloseTime < mergedAt) return false;
  const latestCloseEvents = closeEvents.filter((event) => Date.parse(event.createdAt) === latestCloseTime);
  if (latestCloseEvents.length !== 1) return false;
  const closer = latestCloseEvents[0].closer;
  const exactPullRequest = closer?.__typename === "PullRequest" &&
    closer.number === pullRequest.number &&
    closer.mergeCommit?.oid?.toLowerCase() === pullRequest.merge_commit_sha?.toLowerCase();
  const exactPullRequestCommit = closer?.__typename === "Commit" &&
    pullRequestCommitShas?.has(closer.oid?.toLowerCase());
  return exactPullRequest || exactPullRequestCommit;
}

async function prepareTrackedIssueForProduction(client, issueNumber, pullRequest, pullRequestCommitShas) {
  let issue = await readIssue(client, issueNumber);
  if (issue.state === "closed") {
    let previouslyVerified;
    try {
      previouslyVerified = await readVerifiedIssueDelivery(client, issueNumber, pullRequest);
    } catch (error) {
      return {
        status: "BLOCKED",
        state: issue.state,
        details: "The closed issue's prior exact-SHA Production evidence could not be read; it remains untouched: " + error.message,
      };
    }
    if (previouslyVerified) {
      const projectContext = await readProjectItem(client, issue);
      const projectStatus = projectItemFields(projectContext.item)[STATUS_FIELD] || null;
      if (!projectContext.item || projectContext.item.isArchived) {
        return {
          status: "BLOCKED",
          state: issue.state,
          projectStatus,
          details: "A prior Production verification exists, but the active Project card could not be verified for retry.",
        };
      }
      return {
        status: "PASS",
        state: issue.state,
        projectStatus,
        previouslyVerified: true,
        details: "The closed issue has exact-merge-SHA Production evidence; delivery tracking can safely resume.",
      };
    }
    let closedByPullRequest = false;
    try {
      closedByPullRequest = await issueWasClosedByPullRequest(client, issueNumber, pullRequest, pullRequestCommitShas);
    } catch (error) {
      return {
        status: "BLOCKED",
        state: issue.state,
        details: "The tracked issue is closed and GitHub could not verify whether this exact PR merge closed it: " + error.message,
      };
    }
    if (!closedByPullRequest) {
      return {
        status: "BLOCKED",
        state: issue.state,
        details: "The tracked issue was closed independently; no issue or Project state was changed.",
      };
    }
    await client.request("/repos/" + client.owner + "/" + client.repo + "/issues/" + issueNumber, {
      method: "PATCH",
      body: JSON.stringify({ state: "open" }),
    });
    issue = await readIssue(client, issueNumber);
  }
  if (issue.state !== "open") {
    return { status: "BLOCKED", state: issue.state, details: "The tracked issue is not open for Production verification." };
  }
  const previouslyVerified = await readVerifiedIssueDelivery(client, issueNumber, pullRequest);
  if (previouslyVerified) {
    const projectContext = await readProjectItem(client, issue);
    const projectStatus = projectItemFields(projectContext.item)[STATUS_FIELD] || null;
    if (!projectContext.item || projectContext.item.isArchived) {
      return {
        status: "BLOCKED",
        state: issue.state,
        projectStatus,
        details: "Prior exact-SHA Production evidence exists, but the active Project card could not be verified for retry.",
      };
    }
    if (projectStatus === DONE_STATUS) {
      return {
        status: "PASS",
        state: issue.state,
        projectStatus,
        previouslyVerified: true,
        details: "The open issue has exact-merge-SHA Production evidence and Project is Done; delivery tracking can safely resume.",
      };
    }
  }
  try {
    if (issue.state === "open") await setSingleSelectField(client, issueNumber, STATUS_FIELD, "Blocked");
    const projectContext = await readProjectItem(client, issue);
    const projectStatus = projectItemFields(projectContext.item)[STATUS_FIELD] || null;
    if (!projectContext.item || projectContext.item.isArchived ||
      (issue.state === "open" && projectStatus !== "Blocked")) {
      return {
        status: "BLOCKED",
        state: issue.state,
        projectStatus,
        details: "Production verification is pending, but the active Project card could not be held at Blocked.",
      };
    }
  } catch (error) {
    return {
      status: "BLOCKED",
      state: issue.state,
      details: "Production verification is pending, but the Project card could not be held at Blocked: " + error.message,
    };
  }
  return {
    status: "PASS",
    state: issue.state,
    projectStatus: issue.state === "open" ? "Blocked" : "Done",
    details: issue.state === "open"
      ? "The linked issue remains open and the Project card stays Blocked until Production verification finishes."
      : "The closed, previously verified issue remains closed while the exact Production result is rechecked.",
  };
}

async function updateTrackedIssueAfterDelivery(client, issueNumber, {
  status,
  details,
  trackingPrepared,
  pullRequest,
  pullRequestCommitShas,
  deliveryEvidence,
}) {
  if (!issueNumber) return { status: "NOT RUN", issue: null, details: "No issue number was provided." };
  if (trackingPrepared?.status !== "PASS") {
    return {
      status: "BLOCKED",
      issue: issueNumber,
      state: trackingPrepared?.state || null,
      details: trackingPrepared?.details || "Issue and Project tracking was not verified before Production delivery.",
    };
  }
  let issue = await readIssue(client, issueNumber);
  if (issue.state === "closed") {
    let previouslyVerified;
    try {
      previouslyVerified = await readVerifiedIssueDelivery(client, issueNumber, pullRequest);
    } catch (error) {
      return { status: "BLOCKED", issue: issueNumber, state: issue.state, details: "The closed issue's prior Production evidence could not be read: " + error.message };
    }
    if (previouslyVerified && status !== "PASS") {
      let projectStatus = null;
      try {
        const projectContext = await readProjectItem(client, issue);
        projectStatus = projectItemFields(projectContext.item)[STATUS_FIELD] || null;
      } catch {
        // Keep the closed issue untouched if Project state cannot be re-read.
      }
      return {
        status: "BLOCKED",
        issue: issueNumber,
        state: issue.state,
        projectStatus,
        details: "A prior exact-merge-SHA Production pass is recorded; this failed retry did not reopen or downgrade the completed issue.",
      };
    }
    let closedByPullRequest = false;
    if (!previouslyVerified) {
      try {
        closedByPullRequest = await issueWasClosedByPullRequest(client, issueNumber, pullRequest, pullRequestCommitShas);
      } catch (error) {
        return { status: "BLOCKED", issue: issueNumber, state: issue.state, details: "The tracked issue was closed during Production verification and its closure source is unknown: " + error.message };
      }
    }
    if (!previouslyVerified && !closedByPullRequest) {
      return { status: "BLOCKED", issue: issueNumber, state: issue.state, details: "The tracked issue was closed independently during Production verification; no issue or Project state was changed." };
    }
    if (status !== "PASS") {
      await client.request("/repos/" + client.owner + "/" + client.repo + "/issues/" + issueNumber, {
        method: "PATCH",
        body: JSON.stringify({ state: "open" }),
      });
      issue = await readIssue(client, issueNumber);
    }
  }
  if (status === "PASS") {
    const currentVerified = await readVerifiedIssueDelivery(client, issueNumber, pullRequest);
    const deliveryRecord = currentVerified || {
      schemaVersion: 1,
      status: "PASS",
      issueNumber,
      pullRequestNumber: pullRequest.number,
      candidateSha: deliveryEvidence?.candidateSha || pullRequest.head?.sha,
      mergeSha: deliveryEvidence?.mergeSha || pullRequest.merge_commit_sha,
      productionDeployment: deliveryEvidence?.productionDeployment || { status: "NOT RUN" },
      productionSmoke: deliveryEvidence?.productionSmoke || { status: "NOT RUN" },
      postDeploymentMigration: deliveryEvidence?.postDeploymentMigration || { status: "NOT RUN" },
      mergeBaseVerification: deliveryEvidence?.mergeBaseVerification || { status: "NOT RUN" },
      recordedAt: new Date().toISOString(),
    };
    const exactProductionEvidence = deliveryRecord.status === "PASS" &&
      deliveryRecord.issueNumber === issueNumber &&
      deliveryRecord.pullRequestNumber === pullRequest.number &&
      deliveryRecord.candidateSha?.toLowerCase?.() === pullRequest.head?.sha?.toLowerCase?.() &&
      deliveryRecord.mergeSha?.toLowerCase?.() === pullRequest.merge_commit_sha?.toLowerCase?.() &&
      deliveryRecord.productionDeployment?.status === "PASS" &&
      deliveryRecord.productionDeployment?.deployment?.sha?.toLowerCase?.() === pullRequest.merge_commit_sha?.toLowerCase?.() &&
      deliveryRecord.productionSmoke?.status === "PASS" &&
      deliveryRecord.postDeploymentMigration?.status === "PASS";
    if (!exactProductionEvidence) {
      return { status: "BLOCKED", issue: issueNumber, state: issue.state, details: "Production passed, but exact-merge-SHA deployment, smoke, or migration evidence is incomplete; the issue was not marked Done." };
    }
    if (!currentVerified) {
      await postIssueComment(client, issueNumber,
        "Production delivery verified.\n\n" + details + "\n\n" + formatIssueDeliveryComment(deliveryRecord));
      const recordedDelivery = await readVerifiedIssueDelivery(client, issueNumber, pullRequest);
      if (!recordedDelivery) {
        return {
          status: "BLOCKED",
          issue: issueNumber,
          state: issue.state,
          details: "Production passed, but GitHub did not confirm a trusted exact-SHA issue-delivery record; the issue and Project were not marked Done.",
        };
      }
    }
    await setSingleSelectField(client, issueNumber, STATUS_FIELD, DONE_STATUS, {
      productionVerified: true,
      allowClosed: true,
    });
    let projectContext = await readProjectItem(client, await readIssue(client, issueNumber));
    let projectStatus = projectItemFields(projectContext.item)[STATUS_FIELD] || null;
    if (!projectContext.item || projectContext.item.isArchived || projectStatus !== DONE_STATUS) {
      return {
        status: "BLOCKED",
        issue: issueNumber,
        state: issue.state,
        projectStatus,
        details: "Production passed and exact evidence is recorded, but Project Status did not reach Done; delivery can be retried safely.",
      };
    }
    if (issue.state === "open") {
      try {
        await client.request("/repos/" + client.owner + "/" + client.repo + "/issues/" + issueNumber, {
          method: "PATCH",
          body: JSON.stringify({ state: "closed", state_reason: "completed" }),
        });
      } catch (error) {
        const stillOpen = await readIssue(client, issueNumber);
        if (stillOpen.state === "open") {
          await setSingleSelectField(client, issueNumber, STATUS_FIELD, "Blocked").catch(() => {});
        }
        return { status: "BLOCKED", issue: issueNumber, state: stillOpen.state, projectStatus, details: "Production passed and Project is Done, but GitHub did not close the issue: " + error.message };
      }
    }
    const closed = await readIssue(client, issueNumber);
    projectContext = await readProjectItem(client, closed);
    projectStatus = projectItemFields(projectContext.item)[STATUS_FIELD] || null;
    return {
      status: closed.state === "closed" && projectStatus === DONE_STATUS ? "PASS" : "BLOCKED",
      issue: issueNumber,
      state: closed.state,
      projectStatus,
      details: closed.state === "closed" && projectStatus === DONE_STATUS
        ? "Production was verified; the issue is closed and its Project status is Done."
        : "Production passed, but issue closure or Project Done could not be verified; exact-SHA evidence was recorded for a safe retry.",
    };
  }

  await postIssueComment(client, issueNumber, "Production delivery is not complete.\n\n" + details);
  let currentIssue = issue.state === "open" ? await readIssue(client, issueNumber) : issue;
  if (currentIssue.state === "open") {
    try {
      await setSingleSelectField(client, issueNumber, STATUS_FIELD, "Blocked");
      const projectContext = await readProjectItem(client, currentIssue);
      if (projectItemFields(projectContext.item)[STATUS_FIELD] !== "Blocked") {
        return {
          status: "BLOCKED",
          issue: issueNumber,
          state: currentIssue.state,
          details: "Production failed; the issue remains open but Project Status did not reach Blocked.",
        };
      }
    } catch (error) {
      return {
        status: "BLOCKED",
        issue: issueNumber,
        state: currentIssue.state,
        details: "Production failed; the issue remains open. Project Status could not be set to Blocked: " + error.message,
      };
    }
  }
  return {
    status: "PASS",
    issue: issueNumber,
    state: currentIssue.state,
    projectStatus: currentIssue.state === "open" ? "Blocked" : null,
    details: currentIssue.state === "open"
      ? "Production did not pass; the issue remains open and Project Status is Blocked."
      : "Production did not pass; the issue was not marked complete.",
  };
}

export async function deliverPullRequest(client, pullRequestNumber, {
  issueNumber = null,
  productionSmokePaths = null,
  verify = verifyPullRequest,
  waitForDeployment = waitForProductionDeployment,
  smoke = runProductionSmoke,
} = {}) {
  const number = parseIssueNumber(pullRequestNumber);
  const issue = issueNumber === null ? null : parseIssueNumber(issueNumber);
  const configuredSmokePaths = productionSmokePaths === null
    ? (process.env.AGENT_HARNESS_PRODUCTION_SMOKE_PATHS || "").split(",").map((path) => path.trim()).filter(Boolean)
    : (Array.isArray(productionSmokePaths) ? productionSmokePaths : String(productionSmokePaths))
        .flatMap((value) => String(value).split(",")).map((path) => path.trim()).filter(Boolean);
  let effectiveSmokePaths = ["/"];
  let effectiveSmokeExpectations = [];
  const resolveSmokePlan = (verification) => {
    const changedFiles = verification?.fileScope?.files || [];
    const plan = verification?.productionSmokePlan || verification?.fileScope?.productionSmokePlan ||
      validateProductionSmokePlan({
        files: changedFiles,
        localVerification: { record: verification?.localVerification?.record },
      });
    if (plan.status !== "PASS") return { status: "BLOCKED", details: plan.details || "Production smoke plan is not passing." };
    const paths = plan.required ? plan.paths : configuredSmokePaths.length ? configuredSmokePaths : ["/"];
    const expectations = plan.required ? plan.expectations : [];
    if (!Array.isArray(paths) || !paths.length || paths.some((path) => !isValidProductionSmokePath(path))) {
      return { status: "BLOCKED", details: "Production smoke plan contains an invalid same-origin absolute path." };
    }
    if (plan.required && (!Array.isArray(expectations) || !expectations.length)) {
      return { status: "BLOCKED", details: "Application-flow Production smoke plan must include expected response content." };
    }
    if (plan.required && configuredSmokePaths.length && (
      new Set(configuredSmokePaths).size !== new Set(paths).size ||
      configuredSmokePaths.some((path) => !paths.includes(path))
    )) {
      return { status: "BLOCKED", details: "AGENT_HARNESS_PRODUCTION_SMOKE_PATHS must exactly match the current-SHA affected-flow smoke plan." };
    }
    if (expectations.some((expectation) =>
      !expectation || !paths.includes(expectation.path) ||
      typeof expectation.expectedText !== "string" || !expectation.expectedText.trim(),
    )) {
      return { status: "BLOCKED", details: "Production smoke expectations must name an included path and non-empty expected content." };
    }
    return { status: "PASS", paths, expectations, details: plan.details };
  };
  const pullRequestPath = "/repos/" + client.owner + "/" + client.repo + "/pulls/" + number;
  let pullRequest = await client.request(pullRequestPath);
  let candidateSha = pullRequest.head?.sha || null;
  let mergeSha = pullRequest.merge_commit_sha || null;
  let verifiedBaseSha = null;
  let mergeBaseVerification = { status: "NOT RUN", sha: null, details: "Merge base has not been checked." };
  let mergeResult = { merged: Boolean(pullRequest.merged), alreadyMerged: Boolean(pullRequest.merged) };
  let verification = null;
  let reviewGatesPassed = false;
  let productionSmokePlanVerification = { status: "NOT RUN", details: "Production smoke plan has not been checked." };
  let issueBeforeMerge = null;
  let pullRequestCommitShas = new Set();
  const trackingPreparations = new Map();

  let closingIssues = findClosingIssueReferences(
    pullRequest.body || "",
    client.owner + "/" + client.repo,
  );
  if (pullRequest.merged) {
    try {
      const commits = await readPullRequestCommits(client, number);
      pullRequestCommitShas = new Set(commits.map((commit) => commit.sha.toLowerCase()));
      closingIssues = [...new Set([
        ...closingIssues,
        ...commits.flatMap((commit) =>
          findClosingIssueReferences(commit.commit.message, client.owner + "/" + client.repo),
        ),
      ])];
    } catch (error) {
      return {
        status: "BLOCKED",
        decision: "BLOCKED",
        stage: "commit-history",
        merged: true,
        candidateSha,
        mergeSha,
        reasons: ["The merged PR's closing issue references could not be determined because its complete commit history is unavailable: " + error.message],
      };
    }
  }
  let trackedIssueNumbers = [...new Set([
    ...(issue === null ? [] : [issue]),
    ...(pullRequest.merged ? closingIssues : []),
  ])];
  if (!pullRequest.merged && closingIssues.length) {
    return {
      status: "BLOCKED",
      decision: "BLOCKED",
      stage: "issue-preflight",
      merged: Boolean(pullRequest.merged),
      candidateSha,
      mergeSha,
      reasons: ["PR body would auto-close issue(s) " + closingIssues.map((value) => "#" + value).join(", ") + "; use non-closing references until Production verification passes."],
    };
  }

  if (issue !== null && !referencesIssue(
    pullRequest.body || "",
    issue,
    client.owner + "/" + client.repo,
  )) {
    return {
      status: "BLOCKED",
      decision: "BLOCKED",
      stage: "issue-preflight",
      merged: Boolean(pullRequest.merged),
      candidateSha,
      mergeSha,
      reasons: ["The supplied issue is not referenced by this PR; no issue or Project state will be changed."],
    };
  }

  if (!pullRequest.merged) {
    verification = await verify(client, number);
    if (verification.decision !== "READY_FOR_MERGE") {
      return {
        status: "BLOCKED",
        decision: "BLOCKED",
        stage: "pre-merge-gates",
        merged: false,
        candidateSha: verification.currentSha || candidateSha,
        verification,
        reasons: verification.reasons || ["All merge gates must pass before the GitHub merge endpoint is called."],
      };
    }
    reviewGatesPassed = true;
    candidateSha = verification.currentSha;
    verifiedBaseSha = validSha(verification.pullRequest?.baseSha)
      ? verification.pullRequest.baseSha.toLowerCase()
      : pullRequest.base?.sha?.toLowerCase();
    if (!validSha(verifiedBaseSha)) {
      return {
        status: "BLOCKED",
        decision: "BLOCKED",
        stage: "base-snapshot",
        merged: false,
        candidateSha,
        reasons: ["The exact base SHA used for gate verification could not be verified; no merge was attempted."],
      };
    }
    const smokePlan = resolveSmokePlan(verification);
    productionSmokePlanVerification = { status: smokePlan.status, details: smokePlan.details || "Production smoke plan is valid." };
    if (smokePlan.status !== "PASS") {
      return {
        status: "BLOCKED",
        decision: "BLOCKED",
        stage: "production-smoke-plan",
        merged: false,
        candidateSha,
        reasons: [smokePlan.details],
      };
    }
    effectiveSmokePaths = smokePlan.paths;
    effectiveSmokeExpectations = smokePlan.expectations;
    pullRequest = await client.request(pullRequestPath);
    if (pullRequest.state !== "open" || pullRequest.merged || pullRequest.draft ||
      pullRequest.base?.ref !== "main" || pullRequest.base?.sha?.toLowerCase() !== verifiedBaseSha ||
      pullRequest.head?.sha !== candidateSha) {
      return {
        status: "BLOCKED",
        decision: "BLOCKED",
        stage: "pre-merge-snapshot",
        merged: false,
        candidateSha,
        reasons: ["PR state, draft status, base ref/SHA, or head changed after gate verification; no merge was attempted."],
      };
    }
    const freshClosingIssues = findClosingIssueReferences(
      pullRequest.body || "",
      client.owner + "/" + client.repo,
    );
    if (freshClosingIssues.length) {
      return {
        status: "BLOCKED",
        decision: "BLOCKED",
        stage: "issue-preflight",
        merged: false,
        candidateSha,
        reasons: ["PR body would auto-close issue(s) " + freshClosingIssues.map((value) => "#" + value).join(", ") + "; use non-closing references until Production verification passes."],
      };
    }
    let freshCommitMessages;
    try {
      freshCommitMessages = await readPullRequestCommitMessages(client, number);
    } catch (error) {
      return {
        status: "BLOCKED",
        decision: "BLOCKED",
        stage: "commit-history",
        merged: false,
        candidateSha,
        reasons: ["PR commit history could not be read immediately before merge: " + error.message],
      };
    }
    const freshCommitClosers = [...new Set(freshCommitMessages.flatMap((message) =>
      findClosingIssueReferences(message, client.owner + "/" + client.repo),
    ))];
    if (freshCommitClosers.length) {
      return {
        status: "BLOCKED",
        decision: "BLOCKED",
        stage: "commit-history",
        merged: false,
        candidateSha,
        reasons: ["PR commit message(s) would auto-close issue(s) " + freshCommitClosers.map((value) => "#" + value).join(", ") + "; rewrite or squash with non-closing wording before merge."],
      };
    }
    if (issue !== null) {
      issueBeforeMerge = await readIssue(client, issue);
      if (issueBeforeMerge.state !== "open") {
        return {
          status: "BLOCKED",
          decision: "BLOCKED",
          stage: "issue-preflight",
          merged: false,
          candidateSha,
          reasons: ["The tracked issue is already closed; merge was not attempted."],
        };
      }
    }
    // The GitHub merge endpoint can pin the PR head SHA but has no base-SHA
    // precondition. Re-read the PR immediately before merge to minimize the
    // remaining race window and refuse any drift observed at that point.
    pullRequest = await client.request(pullRequestPath);
    if (pullRequest.state !== "open" || pullRequest.merged || pullRequest.draft ||
      pullRequest.base?.ref !== "main" || pullRequest.base?.sha?.toLowerCase() !== verifiedBaseSha ||
      pullRequest.head?.sha !== candidateSha) {
      return {
        status: "BLOCKED",
        decision: "BLOCKED",
        stage: "final-merge-snapshot",
        merged: false,
        candidateSha,
        reasons: ["PR state, draft status, base ref/SHA, or head changed immediately before merge; no merge was attempted."],
      };
    }
    const finalClosingIssues = findClosingIssueReferences(
      pullRequest.body || "",
      client.owner + "/" + client.repo,
    );
    if (finalClosingIssues.length) {
      return {
        status: "BLOCKED",
        decision: "BLOCKED",
        stage: "final-merge-snapshot",
        merged: false,
        candidateSha,
        reasons: ["PR body now contains closing reference(s) " + finalClosingIssues.map((value) => "#" + value).join(", ") + "; no merge was attempted."],
      };
    }
    try {
      mergeResult = await client.request(pullRequestPath + "/merge", {
        method: "PUT",
        body: JSON.stringify({ sha: candidateSha, merge_method: "merge" }),
      });
    } catch (error) {
      return {
        status: "BLOCKED",
        decision: "BLOCKED",
        stage: "merge",
        merged: false,
        candidateSha,
        reasons: ["GitHub rejected the normal merge request; no protection bypass was attempted: " + error.message],
      };
    }
    if (mergeResult?.merged !== true || !validSha(mergeResult.sha)) {
      return {
        status: "BLOCKED",
        decision: "BLOCKED",
        stage: "merge",
        merged: false,
        candidateSha,
        mergeResult,
        reasons: ["GitHub did not confirm a successful merge commit."],
      };
    }
    mergeSha = mergeResult.sha;
    pullRequest = await client.request(pullRequestPath);
    if (!pullRequest.merged || pullRequest.merge_commit_sha?.toLowerCase() !== mergeSha.toLowerCase()) {
      return {
        status: "BLOCKED",
        decision: "BLOCKED",
        stage: "merge-confirmation",
        merged: true,
        candidateSha,
        mergeSha,
        reasons: ["GitHub accepted the merge request but the PR merge commit could not be confirmed."],
      };
    }
  } else {
    verification = await verify(client, number, { allowMerged: true });
    reviewGatesPassed = verification.decision === "VERIFIED_MERGE";
    candidateSha = verification.currentSha || candidateSha;
    if (verification.mergeBase?.reviewedBaseShaVerified === true && validSha(verification.mergeBase?.reviewedBaseSha)) {
      verifiedBaseSha = verification.mergeBase.reviewedBaseSha.toLowerCase();
    } else if (verification.mergeBase?.status === "BLOCKED") {
      verifiedBaseSha = null;
    } else {
      verifiedBaseSha = validSha(verification.pullRequest?.baseSha)
        ? verification.pullRequest.baseSha.toLowerCase()
        : null;
    }
    const smokePlan = resolveSmokePlan(verification);
    productionSmokePlanVerification = {
      status: smokePlan.status,
      details: smokePlan.details || "Production smoke plan is valid.",
    };
    if (smokePlan.status === "PASS") {
      effectiveSmokePaths = smokePlan.paths;
      effectiveSmokeExpectations = smokePlan.expectations;
    }
    if (!validSha(mergeSha)) {
      return {
        status: "BLOCKED",
        decision: "BLOCKED",
        stage: "merge-confirmation",
        merged: true,
        candidateSha,
        reasons: ["The already-merged PR does not expose a valid merge commit SHA."],
      };
    }
  }

  let closingReferenceError = null;
  try {
    const confirmedMergedPullRequest = await client.request(pullRequestPath);
    if (!confirmedMergedPullRequest.merged ||
      confirmedMergedPullRequest.merge_commit_sha?.toLowerCase() !== mergeSha?.toLowerCase() ||
      confirmedMergedPullRequest.head?.sha?.toLowerCase() !== candidateSha?.toLowerCase()) {
      throw new Error("The merged PR no longer matches the verified head and merge commit.");
    }
    pullRequest = confirmedMergedPullRequest;
    const confirmedBodyClosers = findClosingIssueReferences(
      pullRequest.body || "",
      client.owner + "/" + client.repo,
    );
    const confirmedCommits = await readPullRequestCommits(client, number);
    pullRequestCommitShas = new Set(confirmedCommits.map((commit) => commit.sha.toLowerCase()));
    const confirmedCommitClosers = confirmedCommits.flatMap((commit) =>
      findClosingIssueReferences(commit.commit.message, client.owner + "/" + client.repo),
    );
    trackedIssueNumbers = [...new Set([
      ...trackedIssueNumbers,
      ...confirmedBodyClosers,
      ...confirmedCommitClosers,
    ])];
  } catch (error) {
    closingReferenceError = "After merge, the complete closing-issue references could not be reconciled; delivery cannot be marked complete: " + error.message;
  }

  try {
    const mergeCommit = await client.request(
      "/repos/" + client.owner + "/" + client.repo + "/commits/" + mergeSha,
    );
    const mergeParents = mergeCommit?.parents;
    const actualBaseSha = Array.isArray(mergeParents) && mergeParents.length >= 2 && validSha(mergeParents[0]?.sha)
      ? mergeParents[0].sha.toLowerCase()
      : null;
    if (!validSha(verifiedBaseSha) || !validSha(actualBaseSha)) {
      mergeBaseVerification = {
        status: "BLOCKED",
        sha: actualBaseSha,
        expectedSha: validSha(verifiedBaseSha) ? verifiedBaseSha : null,
        details: "The merge commit's first parent or the base SHA used for review could not be verified.",
      };
    } else if (actualBaseSha !== verifiedBaseSha) {
      mergeBaseVerification = {
        status: "BLOCKED",
        sha: actualBaseSha,
        expectedSha: verifiedBaseSha,
        details: "The merge commit's first parent differs from the base SHA used for review.",
      };
    } else {
      mergeBaseVerification = {
        status: "PASS",
        sha: actualBaseSha,
        expectedSha: verifiedBaseSha,
        details: "The merge commit's first parent matches the exact base SHA used for review.",
      };
    }
  } catch (error) {
    mergeBaseVerification = {
      status: "BLOCKED",
      sha: null,
      expectedSha: validSha(verifiedBaseSha) ? verifiedBaseSha : null,
      details: "The merge commit's first parent could not be verified: " + error.message,
    };
  }

  for (const trackedIssue of trackedIssueNumbers) {
    try {
      trackingPreparations.set(trackedIssue, await prepareTrackedIssueForProduction(
        client,
        trackedIssue,
        pullRequest,
        pullRequestCommitShas,
      ));
    } catch (error) {
      trackingPreparations.set(trackedIssue, {
        status: "BLOCKED",
        state: null,
        details: "The issue and Project state could not be prepared for Production verification: " + error.message,
      });
    }
  }

  let productionDeployment;
  let productionSmoke;
  let postDeploymentMigration;
  try {
    productionDeployment = await waitForDeployment(client, mergeSha);
    if (productionDeployment.status === "PASS") {
      productionSmoke = await smoke(productionDeployment.deployment.environmentUrl, {
        paths: effectiveSmokePaths,
        expectations: effectiveSmokeExpectations,
      });
      if (productionSmoke.status === "PASS") {
        const files = await pagedRest(client, "/repos/" + client.owner + "/" + client.repo + "/pulls/" + number + "/files");
        const comments = await pagedRest(client, "/repos/" + client.owner + "/" + client.repo + "/issues/" + number + "/comments");
        const localVerification = validateLocalVerification({
          headSha: candidateSha,
          comments,
          expectedAuthor: pullRequest.user?.login || null,
        });
        postDeploymentMigration = validatePostDeploymentMigrationEvidence({
          files,
          filesAvailable: true,
          localVerification,
        });
      }
    }
  } catch (error) {
    productionDeployment ||= { status: "BLOCKED", deployment: null, details: error.message };
  }

  const postDeploymentPass = reviewGatesPassed &&
    productionSmokePlanVerification.status === "PASS" &&
    mergeBaseVerification.status === "PASS" &&
    productionDeployment?.status === "PASS" &&
    productionSmoke?.status === "PASS" &&
    postDeploymentMigration?.status === "PASS";
  const status = postDeploymentPass ? "PASS" :
    productionDeployment?.status === "FAIL" || productionSmoke?.status === "FAIL" || postDeploymentMigration?.status === "FAIL"
      ? "FAIL"
      : "BLOCKED";
  const details = [
    "Candidate SHA: " + (candidateSha || "unknown"),
    "Merge SHA: " + mergeSha,
    "Reviewed gates: " + (reviewGatesPassed ? "PASS" : "BLOCKED") +
      (verification?.reasons?.length ? " — " + verification.reasons.join("; ") : ""),
    "Production smoke plan: " + productionSmokePlanVerification.status + " — " + productionSmokePlanVerification.details,
    "Reviewed merge base: " + mergeBaseVerification.status + " — " + mergeBaseVerification.details,
    "Production deployment: " + (productionDeployment?.status || "NOT RUN") + " — " + (productionDeployment?.details || "not verified"),
    "Production smoke: " + (productionSmoke?.status || "NOT RUN") + " — " + (productionSmoke?.details || "not run"),
    "Post-deployment migration: " + (postDeploymentMigration?.status || "NOT RUN") + " — " + (postDeploymentMigration?.details || "not run"),
    ...(closingReferenceError ? [closingReferenceError] : []),
  ].join("\n");
  const issueOutcomes = [];
  for (const trackedIssue of trackedIssueNumbers) {
    try {
      issueOutcomes.push(await updateTrackedIssueAfterDelivery(client, trackedIssue, {
        status,
        details,
        trackingPrepared: trackingPreparations.get(trackedIssue),
        pullRequest,
        pullRequestCommitShas,
        deliveryEvidence: {
          candidateSha,
          mergeSha,
          productionDeployment,
          productionSmoke,
          postDeploymentMigration,
          mergeBaseVerification,
        },
      }));
    } catch (error) {
      issueOutcomes.push({ status: "BLOCKED", issue: trackedIssue, details: "Issue/Project tracking update failed: " + error.message });
    }
  }
  if (closingReferenceError) {
    issueOutcomes.push({ status: "BLOCKED", issue: null, details: closingReferenceError });
  }
  const issueOutcome = issueOutcomes.length === 0
    ? { status: "NOT RUN", issue: null, details: "No issue number was provided or inferred from a merged closing reference." }
    : issueOutcomes.length === 1
      ? issueOutcomes[0]
      : {
          status: issueOutcomes.every((outcome) => outcome.status === "PASS") ? "PASS" : "BLOCKED",
          issues: issueOutcomes,
          details: issueOutcomes.map((outcome) =>
            (outcome.issue === null ? "Closing issue references" : "#" + outcome.issue) + ": " + outcome.status + " — " + outcome.details,
          ).join("\n"),
        };
  const issuePreparationValues = trackedIssueNumbers.map((trackedIssue) => ({
    issue: trackedIssue,
    ...(trackingPreparations.get(trackedIssue) || { status: "BLOCKED", details: "Issue preparation did not produce a result." }),
  }));
  const trackingPreparation = issuePreparationValues.length === 0
    ? { status: "NOT RUN", state: null, details: "No issue number was provided or inferred from a merged closing reference." }
    : issuePreparationValues.length === 1
      ? issuePreparationValues[0]
      : {
          status: issuePreparationValues.every((preparation) => preparation.status === "PASS") ? "PASS" : "BLOCKED",
          issues: issuePreparationValues,
        };
  const completed = status === "PASS" && !closingReferenceError &&
    (trackedIssueNumbers.length === 0 || issueOutcome.status === "PASS");
  const record = {
    schemaVersion: 1,
    status: completed ? "PASS" : status === "PASS" ? "BLOCKED" : status,
    candidateSha,
    mergeSha,
    merged: true,
    productionDeployment: productionDeployment || { status: "NOT RUN" },
    productionSmoke: productionSmoke || { status: "NOT RUN" },
    postDeploymentMigration: postDeploymentMigration || { status: "NOT RUN" },
    productionSmokePlan: productionSmokePlanVerification,
    mergeBaseVerification,
    issue: issueOutcome,
    completed,
    recordedAt: new Date().toISOString(),
  };
  const comment = await postIssueComment(client, number, formatDeliveryComment(record));
  return {
    status: record.status,
    decision: completed ? "DELIVERED" : status === "PASS" ? "BLOCKED" : status === "FAIL" ? "DELIVERY_FAILED" : "BLOCKED",
    stage: completed ? "complete" : "post-merge-verification",
    merged: true,
    candidateSha,
    mergeSha,
    productionDeployment: record.productionDeployment,
    productionSmoke: record.productionSmoke,
    productionSmokePlan: record.productionSmokePlan,
    postDeploymentMigration: record.postDeploymentMigration,
    mergeBaseVerification: record.mergeBaseVerification,
    trackingPreparation,
    issue: issueOutcome,
    issues: issueOutcomes,
    deliveryComment: comment.url,
    completed,
    reasons: completed ? [] : [details, ...(issueOutcome.status === "BLOCKED" ? [issueOutcome.details] : [])],
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

async function setSingleSelectField(client, issueNumber, fieldName, optionName, {
  productionVerified = false,
  allowClosed = false,
} = {}) {
  if (fieldName === STATUS_FIELD && optionName === DONE_STATUS && !productionVerified) {
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
  if (issue.state !== "open" && !(allowClosed && issue.state === "closed")) {
    throw new Error(`Issue #${issueNumber} is closed.`);
  }
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
  node scripts/agent-harness.mjs deliver-pr <pull-request> [--issue <issue>]
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
  if (command === "deliver-pr") {
    const trackedIssueNumber = fieldOrStatus === "--issue" && value && !extra.length
      ? parseIssueNumber(value)
      : null;
    if ((fieldOrStatus && trackedIssueNumber === null) || (!fieldOrStatus && value) || extra.length) {
      throw new Error("Use deliver-pr <pull-request> [--issue <issue>].");
    }
    const delivery = await deliverPullRequest(client, issueNumber, {
      issueNumber: trackedIssueNumber,
    });
    console.log(JSON.stringify(delivery, null, 2));
    if (!delivery.completed) process.exitCode = 1;
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
