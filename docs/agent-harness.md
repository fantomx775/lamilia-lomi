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
- Native `Item closed` sets closed issues and PRs to `Done`; `Pull request
  merged` also sets `Done`; linking an open PR to an issue sets `In Progress`.
  No open-PR workflow sets an issue to `Done`. Move an issue to `Review` when
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
5. When supabase/migrations files change, identify the exact migration, check
   compatibility with the deployed application and existing data, inspect
   relevant RLS/grants, and run focused migration tests when available. Use
   supabase migration list --linked and supabase db push --dry-run --linked
   when access is available. State the release order and remaining work before
   merge. When the app requires new schema, apply and verify the compatible
   migration before merge; main then triggers the normal Vercel Git
   Production deployment. Use expand/contract for breaking changes and do
   not follow the automatic deployment with vercel --prod.
6. When dependency manifests change, compare actual production dependency
   changes in dependencies (not only devDependencies), verify runtime/framework
   compatibility and lockfile alignment, and run focused checks/build as
   needed. Do not add unrelated full-release checks to an ordinary PR.
7. Ask an independently tasked AI sub-agent to read the actual diff and task
   goal, review correctness, regressions, tests, and scope, and report findings
   by severity, required fixes, and the exact 40-character SHA. Persist it as
   an explicitly labeled AI review comment using the v1 record below. Re-review
   meaningful fixes on the new SHA. AI review is internal evidence, not a
   GitHub review.
8. Request a submitted GitHub review from a different account than the PR
   author when an independent identity is available. Its body must include:
   `Reviewer`, `Reviewed SHA`, `Critical`, `High`, `Medium`, `Low`, `Fixes
   applied`, and `Unresolved findings`. Use `none` for an empty category and
   identify findings by severity. The submitted review commit and stated SHA
   must both match the current head. An author self-review does not count. If
   another GitHub identity is unavailable, report formal review as `NOT RUN`
   and continue preparing the PR for external review; never impersonate a
   reviewer. A High or Critical unresolved finding, any non-dismissed
   current-SHA `CHANGES_REQUESTED` review, or incomplete current-SHA evidence
   blocks merge readiness. A later review by another reviewer does not clear
   an outstanding change request; dismiss that review before merge readiness.
9. Open or update one PR referencing the issue. Include acceptance-criteria
   coverage, exact candidate SHA, verification results, and migration/
   production-dependency release order and remaining work when applicable.
   Run `node scripts/agent-harness.mjs verify-pr <pr-number>` and use its
   structured decision. `READY_FOR_REVIEW` requires complete current-SHA local
   checks and AI review; `READY_FOR_MERGE` additionally requires the formal
   GitHub review, configured branch checks/rules, and applicable release
   obligations. The verifier only assesses state; it never merges or deploys.
   Set the issue to `Review` once a legitimate open, non-draft PR is linked;
   merge readiness is not required for that Project transition.
10. Keep progress and blockers in issue comments. If a new agent resumes, rerun
   inspect, read the latest comments and PR state, and continue from the
   existing branch and exact candidate.

## Durable review and verification records

The harness reads records from PR issue comments, while formal GitHub reviews
remain in the PR Reviews API. Keep one JSON object immediately after each
marker, inside a fenced `json` block. A new commit requires new records with
the new exact head SHA. The harness ignores author-written review summaries
when checking formal reviewer identity.

An AI review record has this shape; each finding object needs a `summary` and
`requiredFix`. Empty arrays mean no findings at that severity.

````text
<!-- agent-harness-ai-review:v1 -->
```json
{
  "schemaVersion": 1,
  "reviewType": "ai-subagent",
  "reviewerAgent": "correctness-reviewer",
  "independentlyTasked": true,
  "taskGoalProvided": true,
  "actualDiffRead": true,
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
  "checks": [
    {"kind": "diff", "status": "PASS", "command": "git diff --check", "result": "clean"},
    {"kind": "lint", "status": "PASS", "command": "npm run lint -- <changed-files>", "result": "clean"},
    {"kind": "tests", "status": "PASS", "command": "npm test -- <focused-test>", "result": "<count> passed"}
  ]
}
```
````

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

For changed migrations, `release` must record `migrationCompatibility` and an
explicit `preMergeMigration` decision. If pre-merge application is required,
it must be `PASS` with the command and result; if not required, record
`required: false` and the reason. For changed dependency manifests, record a
`dependencyAudit` command and result. Missing or stale release evidence keeps
merge readiness blocked.

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
release ordering, AI and GitHub review identity/SHA semantics, required and
missing checks, UI browser evidence, migration obligations, and the PR gate.
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
files, exact-SHA GitHub reviews, issue comments, check runs/statuses, classic
branch protection, and every page of effective branch rules. Required checks
retain any configured GitHub App or integration identity; an explicit
"any app" setting remains provider-agnostic. Unsupported, incomplete, or
unreadable active rules block the merge decision. If no
required status checks are configured, the output says so and uses
current-SHA local evidence plus an external formal GitHub review as the manual
fallback. This absence is never reported as green CI. It prints structured
JSON and exits successfully only for `READY_FOR_MERGE`; both
`READY_FOR_REVIEW` and `BLOCKED` return a nonzero exit code so a shell gate
cannot mistake them for merge approval.
