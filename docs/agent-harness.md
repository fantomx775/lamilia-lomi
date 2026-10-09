# GitHub issue-driven agent harness

This repository uses [GitHub Project #1](https://github.com/users/fantomx775/projects/1)
as the shared work board. Issues and pull requests hold the durable task record;
the Project holds workflow status and planning fields.

## Start from an issue number

Run the read-only discovery command before editing:

```powershell
node scripts/agent-harness.mjs inspect 29
```

It reports the issue body and acceptance criteria, project card and field
values, comments, parent/sub-issue/tracked-issue relationships,
blocked-by/blocking relationships, linked and likely related open PRs,
likely remote and local branches (including linked Git worktrees), and a
readiness and recovery result. It matches a card by the
issue's repository-specific node ID, so another repository's issue with the
same number cannot be mistaken for this one. `ready: true` means the issue is
open, present and unarchived on the Project, dependencies were readable with
no open blocker, and acceptance criteria are present. Missing comments are a
warning, not an automatic blocker. The `recoveryPlan` separately reports
whether it is safe to resume an existing PR/branch or create new work. If PR or
branch history is unavailable, do not create a branch until discovery
succeeds. The agent still checks that criteria are clear and work is
authorized. Local branches in separate Git clones are not visible.

If the card is missing, run `add <issue>` and inspect again. `add` is safe to
repeat; it leaves an active card alone and restores an archived card.

The command uses `GITHUB_PAT_CLASSIC_CODEX`, `GH_TOKEN`, or `GITHUB_TOKEN` when
available, then tries `gh auth token` from the existing `gh auth login` session,
and finally `git credential fill`. Credentials stay in memory and are never
printed. `inspect` needs Issues, Projects, Pull requests, and Contents read
access to retrieve the issue and comments, board card, linked PRs, review
records, changed files, CI checks, and branch names. `add`, `status`, and
`field` also need Projects write access. `comment` needs Issues write access.
REST lookups stop after 1,000 records and report incomplete results instead of
silently treating a partial history as complete. Missing essential dependency
data blocks readiness. Missing comments warn; missing PR/branch history blocks
only starting a new branch, while already found work can still be resumed.

## Project contract

- `Status`: `Backlog`, `Ready`, `In Progress`, `Review`, `Blocked`, `Done`.
- `Priority`: `P0`, `P1`, `P2`.
- `Area`: `Media`, `Admin`, `Content`, `Catalog`, `Auth`, `Premium`.
- `Owner`: use the built-in `Assignees` field.
- Native `Auto-add to project` is enabled for repository issues (`is:issue`).
  It adds future new or updated issues that match the filter; it is not a bulk
  import of all existing matches.
- Native `Item closed` sets closed issues and PRs to `Done`; linking an open
  PR to an issue sets `In Progress`. The native `Pull request merged` workflow
  is disabled because Production verification occurs after merge and must pass
  before an issue can close and become `Done`. No open-PR workflow sets an issue
  to `Done`. Move an issue to `Review` when
  its PR is ready for review. The CLI requires an open, non-draft PR tied to
  the issue before allowing `Review`, and refuses to set `Done` manually.

Use these idempotent updates when needed:

```powershell
node scripts/agent-harness.mjs add 29
node scripts/agent-harness.mjs status 29 Ready
node scripts/agent-harness.mjs status 29 "In Progress"
node scripts/agent-harness.mjs field 29 Priority P2
node scripts/agent-harness.mjs field 29 Area Catalog
```

`add` does nothing when the issue is already active on the Project and
unarchives it when needed. The issue reference and Project number can be
overridden for another repository with `AGENT_HARNESS_PROJECT_OWNER` and
`AGENT_HARNESS_PROJECT_NUMBER`; this implementation expects a user-owned
Project V2 board. Setting `Ready` or `In Progress` reruns essential readiness
checks. Missing acceptance criteria, unreadable dependencies, or an open
blocker prevents starting; missing comments alone does not. `inspect` reports
a `recoveryPlan`: resume an existing PR or branch, resolve ambiguous matches,
retry incomplete history, or start new work only after the search completed.
The CLI preserves the current Project status when an open PR exists. Setting
`Review` requires an open, non-draft PR tied to the issue. Once a `Blocked`
condition is resolved, readiness can be reevaluated and the issue moved back
to `Ready`.

## Execution and recovery

1. Inspect the issue, its parent/related issues, comments, dependencies,
   project metadata, branches, linked PRs, review evidence, CI status, and PR
   release files. Resume existing work when it belongs to the issue. Do not
   create a duplicate branch or reset valid progress.
2. Confirm the issue is open, acceptance criteria are understood, and every
   blocker is closed. If a blocker or required product decision prevents work,
   set Blocked and record the reason on the issue. Retry noncritical read
   failures or inspect alternate context; state any remaining limitation.
3. Set Ready, then In Progress when implementation starts. Follow the inspect
   recovery plan: resume an open PR or matching branch; create a branch only
   when PR and branch searches completed with no match. Use an isolated
   codex/<short-slug> worktree for substantial changes and preserve the
   primary checkout.
4. Plan from the acceptance criteria. Implement only the requested issue. Run
   changed-file lint and focused tests where supported, plus conditional
   typecheck/build/browser checks from AGENTS.md.
5. When `supabase/migrations` files change, identify each migration, check
   compatibility with the deployed application and existing data, inspect
   relevant RLS/grants, and validate on Stage or a local database. Record the
   exact command, migration IDs, and result. If deployed code needs the schema,
   apply and verify a compatible migration in Production before merge. For a
   breaking change, record and follow the exact
   `deploymentSequence: ["expand", "compatible-deploy", "contract"]`; keep
   the issue open until the contract step is verified.
   Main triggers the normal Vercel Git Production deployment; do not follow it
   with `vercel --prod`.
6. When dependency manifests change, compare actual production dependency
   changes in dependencies (not only devDependencies), verify runtime/framework
   compatibility and lockfile alignment, and run focused checks/build as
   needed. Do not add unrelated full-release checks to an ordinary PR.
7. Have two independently tasked AI sub-agents each read the task goal and
   actual diff, review correctness, regressions, tests, and scope, and report
   severity, required fixes, unresolved findings, and the full 40-character
   SHA. Persist two records with distinct reviewer-agent identities using the
   v1 marker below. The same GitHub account may post both records. Re-review
   meaningful fixes on the new SHA. Do not fabricate GitHub approvals.
8. Fix and retest confirmed findings, then repeat both reviews on the final
   candidate SHA. Any unresolved Critical/High finding or incomplete/stale
   evidence blocks merging. A GitHub review state alone is informational unless
   an effective branch rule requires approval. A formal approval from another
   account is required only when an effective GitHub branch rule enforces it.
9. Open or update one PR referencing the issue. Include acceptance-criteria
   coverage, exact candidate SHA, verification results, and migration/
   production-dependency release order when applicable. Run
   `node scripts/agent-harness.mjs verify-pr <pr-number>`. `READY_FOR_MERGE`
   means every quality gate, enforced GitHub rule, and release obligation
   passes; missing optional CI does not block when no checks are required.
   `READY_FOR_REVIEW` is only for an approval required by GitHub rules. Set the
   Project issue to `Review` when an open non-draft PR is linked.
10. Run `node scripts/agent-harness.mjs deliver-pr <pr-number> --issue
    <issue-number>` for a fully resolved work item. Use a non-closing issue
    reference such as `Part of #29`: before merge, any local-repository
    `Closes`, `Fixes`, or `Resolves` reference in the PR body or a PR commit
    message blocks delivery, even without `--issue`, because GitHub can close
    the issue before Production is checked. Unreadable or incomplete PR commit
    history fails closed; rewrite or squash closing messages before merging.
    The command reruns the gate, merges with the verified head SHA through
    GitHub's normal merge API, confirms the merge commit, sets the issue to
    `Blocked` during Production verification, waits for its GitHub Production
    deployment, and runs HTTPS smoke paths. The default `/` is a health check.
    Application-flow changes require a current-SHA `productionSmokePlan` that
    maps each changed flow file to its matching route and expected response
    text; delivery requests those routes and checks the text in each response.
    Include route-affecting `middleware`, `proxy`, and `next.config.*` changes
    in that plan, with `routeFiles` identifying every affected route module.
    `AGENT_HARNESS_PRODUCTION_SMOKE_PATHS`, if set, must exactly match those
    affected paths. UI changes also need browser E2E and screenshots. The Git
    merge remains subject to branch protection. It records exact deployment,
    smoke, and migration evidence in PR and issue comments, sets Project Status
    to `Done`, and closes the issue only after all Production gates pass. Native
    Project `Pull request merged` automation stays disabled; `Item closed` may
    mirror the final issue closure. If Project propagation or issue closure is
    delayed, exact-SHA evidence makes the operation safe to retry. A previously
    completed exact-SHA delivery stays closed if a later recheck fails. If Production
    fails or cannot be verified, the command records available deployment log
    and target URLs, investigates through the normal fix/review/merge path when
    safe, and keeps the issue `Blocked`. Recovery of an already-merged PR
    infers every local issue closed by the PR body or complete commit history;
    missing history fails closed. It reopens only issues GitHub proves this
    exact PR merge closed, holds each at `Blocked` through Production, and
    updates each only after verification. Independently closed issues remain
    untouched. Do not pass an unfinished parent epic as the issue to close. If
    a new agent resumes, rerun inspect and continue from the existing branch.

## Durable review and verification records

The harness reads AI-review, verification, and delivery records from PR issue
comments. It reads the GitHub Reviews API to honor enforced approval rules;
formal review state alone is informational when no rule enforces it. Keep one JSON object
immediately after each marker, inside a fenced `json` block. A new commit
requires new AI-review and verification records with the exact new head SHA.
Never fabricate a formal GitHub approval.

Each PR needs two genuinely independent AI reviews. The records must use
distinct `reviewerAgent` values containing the actual independent agent task
IDs, both must state that each agent was tasked independently and read the
actual diff, and both must name the same full head SHA and base SHA. Check the
records against the two real orchestration reports before posting them. The
GitHub identity that posts the comments may be the same.
Each finding object needs a `summary` and `requiredFix`. Empty arrays mean no
findings at that severity.

The harness accepts current-SHA review and local-verification records only
when the PR author posted them. This keeps evidence on the existing PR identity;
it does not require a second GitHub account or create a formal GitHub approval.
Post these records only after receiving the actual independent sub-agent
reviews and running the recorded checks.

````text
<!-- agent-harness-ai-review:v1 -->
```json
{
  "schemaVersion": 1,
  "reviewType": "ai-subagent",
  "reviewerAgent": "<actual-independent-agent-task-id>",
  "independentlyTasked": true,
  "taskGoalProvided": true,
  "actualDiffRead": true,
  "reviewedBaseSha": "<full-current-base-40-character-sha>",
  "reviewedSha": "<full-current-40-character-sha>",
  "reviewScope": ["correctness", "regressions", "testing", "scope"],
  "findings": {"Critical": [], "High": [], "Medium": [], "Low": []},
  "unresolvedFindings": {"Critical": [], "High": [], "Medium": [], "Low": []},
  "fixesApplied": []
}
```
````

A verification record captures actual commands and outcomes. `diff`, `lint`,
and `tests` are required. Add `browser` for UI behavior and `release` when a
migration or dependency manifest changes.

````text
<!-- agent-harness-verification:v1 -->
```json
{
  "schemaVersion": 1,
  "headSha": "<full-current-40-character-sha>",
  "uiBehavior": false,
  "productionSmokePlan": {
    "status": "PASS",
    "flows": [{
      "name": "localized products page",
      "affectedFiles": ["src/app/[locale]/products/page.tsx"],
      "paths": [{"path": "/pl/products", "expectedText": "Produkty"}]
    }]
  },
  "checks": [
    {"kind": "diff", "status": "PASS", "command": "git diff --check", "result": "clean"},
    {"kind": "lint", "status": "PASS", "command": "npm run lint -- <changed-files>", "result": "clean"},
    {"kind": "tests", "status": "PASS", "command": "npm test -- <focused-test>", "result": "<count> passed"}
  ]
}
```
````

If an affected component or helper has no changed route module in the PR, add
`routeFiles` to that flow with the Next.js page or route module that renders or
uses it. The harness checks that every flow path matches one of its route
modules and that every listed route module has a matching expected response.
Routing controls such as `middleware.*`, `proxy.*`, and `next.config.*` also
require one or more affected `routeFiles`.
The independent reviewers must confirm that the named route actually exercises
the changed component or helper; a generic successful route is insufficient.

For UI changes, the verification record's `browser` object must include
`status: "PASS"`, the tool and affected flows, the exact `testedSha`, a
non-empty `runId`, and committed screenshot records,
responsive layouts or a reason they do not apply, persistence results or a
reason they do not apply, `screenshotReview` with `status: "PASS"`,
`retestedAfterFixes: true`, and inspected `consoleErrors` and
`failedNetworkRequests` arrays. Each known unrelated error/request must have
`disposition: "unrelated"` and a reason. Screenshots must be under
`docs/verification/issue-<number>/` or `docs/verification/pr-<number>/` and
listed among the changed PR files. Every screenshot record contains `path`,
`testedSha`, and `runId`; both provenance fields must match the parent browser
record, and `testedSha` must match the current PR head SHA. Do not reuse
screenshots from another commit or unrelated flow. The detector conservatively
treats application source under `src/`, plus root `app/`, `components/`,
`pages/`, `lib/`, `public/`, `messages/`, `middleware.*`, `proxy.*`, and
`tailwind.config.*`, `postcss.config.*`, and `next.config.*` files as
potentially UI-affecting. Test and spec files are excluded.

Example browser evidence fields:

```json
{
  "status": "PASS",
  "tool": "Playwright",
  "testedSha": "<same full SHA as the verification record>",
  "runId": "pr-52-catalog-run-1",
  "screenshots": [{
    "path": "docs/verification/pr-52/catalog-mobile.png",
    "testedSha": "<same full SHA as testedSha>",
    "runId": "pr-52-catalog-run-1"
  }]
}
```

For changed migrations, `release` must record `migrationCompatibility` with a
`strategy` of `compatible` or `expand-contract`, all changed `migrationIds`,
and `stageMigration` with `environment: "Stage"` or `"local"`, a verified
command, and result. A breaking migration must include the ordered
`deploymentSequence: ["expand", "compatible-deploy", "contract"]` and assign
every changed migration ID exactly once across non-empty `expandMigrationIds`
and `contractMigrationIds`. Record an explicit `preMergeMigration` decision:
if deployed code needs a compatible migration's schema, apply that migration
in Production before merge and record `required: true`, `status: "PASS"`, and
the exact migration IDs. Otherwise record `required: false` and explain why.
An expand-contract plan always requires its exact expansion IDs in Production with
`phase: "expand"` before merge. After the compatible application deployment,
apply and verify only the contract IDs; its `postDeployMigration` must name
`environment: "Production"`, `phase: "contract"`, those exact contract IDs,
and `PASS` before delivery is complete. Never treat the whole migration list
as evidence that both phases ran. Record each command and result. For changed
dependency manifests, record a `dependencyAudit` command and result. Missing
or stale release evidence keeps merge readiness blocked.

`deliver-pr` first places a linked open issue in `Blocked` during Production
verification. It writes a delivery record after merge. It binds the verified PR
head SHA to the GitHub merge SHA, exact-SHA Production deployment, smoke
results, migration follow-up, and issue/Project state. It records an issue
completion marker containing the same exact-SHA evidence, sets Project Status
to `Done`, then closes the issue. It marks delivery complete only when
Production is ready, focused smoke succeeds, required post-deployment migration
evidence passes, and the issue is closed with Project Status `Done`. If
Project or issue updates are delayed, the marker supports a safe retry without
pretending an unverified deployment succeeded. A failed retry will not reopen
or downgrade an issue that already has exact-SHA successful Production evidence.
If Production fails or cannot
be read, the command records `FAIL` or `BLOCKED`, leaves the issue open/Blocked,
and does not report delivery complete.

Smoke requests use HTTPS and must return a non-empty successful response on
the Production deployment origin. The default `/` path is a health check. If
application-flow files change, the current-SHA `productionSmokePlan` must map
each changed source file to its affected route and expected response content;
the pre-merge gate blocks on a missing file, mismatched route, or absent text.
If `AGENT_HARNESS_PRODUCTION_SMOKE_PATHS` is set, it must exactly match the
plan's affected paths. On deployment failure, inspect the recorded Vercel
target/log URLs and recover through the ordinary implementation, test,
independent-review, and merge path. Never use a manual Vercel production deploy
as a substitute for Git integration.

The deployment gate requires a Vercel Git integration deployment and success
status for the exact merge SHA, and checks that the environment URL belongs to
the `lamilia-lomi` Production project. A matching GitHub `Production` label
from another deployment provider is insufficient. The application-flow
detector includes `src/pages/**` as well as the App Router. After merge, the
harness rereads the merged PR body and full commit history to catch closing
references added during the merge race. It reopens an issue only when its latest
GitHub close event identifies this exact PR merge or one of its commits, aligned
with the issue's close time; unreadable prior delivery evidence and later
independent closures fail closed. Prior issue-delivery records must be authored
by the PR author. Commit histories that hit the 250-commit REST limit are read
through GraphQL pagination rather than assumed complete. Before merge, the
current base SHA must still match the one used for gate verification. When
GitHub enforces approval of the latest reviewable push, the harness also checks
GitHub's current `reviewDecision` before reporting merge readiness. The
generated Vercel URL must match this project's exact name, nine-character
commit hash, and team scope.

Post a concise issue update from a file when durable progress is useful:

```powershell
node scripts/agent-harness.mjs comment 29 --body-file .\progress.md
```

## Verification

The harness unit tests use the repository's Vitest runner, matching npm test:

```powershell
npm test -- scripts/agent-harness.test.mjs --maxWorkers=1
```

They cover GitHub authentication fallback, exact repository-to-card matching,
acceptance criteria, issue references, readiness and recovery, migration-aware
release ordering, two distinct AI reviewers, actual branch approval rules,
optional and required CI, exact-SHA evidence, UI browser evidence, migration
obligations, automatic merge, Production readiness/smoke, and issue completion
only after successful Production verification.
Do not use a requested live issue as a temporary test fixture. Prefer unit tests;
when live transition coverage is essential, use a dedicated test issue and
restore every changed Project field before finishing.

For every PR, report each relevant check as PASS, FAIL, NOT RUN, or BLOCKED,
with the exact command (or named GitHub check source) and a concise
result/limitation. For example: PASS — npm test -- scripts/agent-harness.test.mjs --maxWorkers=1 — <count> tests passed.
Missing CI checks are NOT RUN, never PASS. Report local checks separately
from GitHub checks. If a tool is unavailable, retry through a reasonable
alternative and report any remaining limitation rather than silently omitting
the check.

`verify-pr <pr-number>` checks that the PR is open, non-draft, targets `main`,
and has a stable current head, base, and PR state across the assessment. It
requires GitHub to report `mergeable: true` before `READY_FOR_MERGE`; a
conflict or unknown mergeability blocks merge readiness. It reads changed
files, commit messages, exact-SHA AI review evidence, issue comments,
check runs/statuses, classic branch protection,
and every page of effective branch rules. Required checks
retain any configured GitHub App or integration identity; an explicit
"any app" setting remains provider-agnostic. Unsupported, incomplete, or
unreadable active rules block the merge decision. If no
  required status checks are configured, the output says so and uses passing
  current-SHA local evidence plus two independent AI reviews as the fallback.
  Optional CI may be missing and remains `NOT RUN`; it does not block delivery.
  A different GitHub account is required only when enforced branch rules demand
  an approval. The absence of CI is never reported as green CI. It prints structured
JSON and exits successfully only for `READY_FOR_MERGE`; both
`READY_FOR_REVIEW` and `BLOCKED` return a nonzero exit code so a shell gate
cannot mistake them for merge approval. A local-repository GitHub closing
reference in the PR body or any PR commit message blocks delivery; unreadable
commit history also blocks until it can be verified.
