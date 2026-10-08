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
readiness result. It matches a card by the
issue's repository-specific node ID, so another repository's issue with the
same number cannot be mistaken for this one. `ready: true` means the issue is
open, present and unarchived on the Project, no open blocker was found, and
blocker/comment/PR/branch history was readable and acceptance criteria are
present. The agent still checks that the criteria are clear and the requested
work is authorized. Local branches in separate Git clones are not visible.

If the card is missing, run `add <issue>` and inspect again. `add` is safe to
repeat; it leaves an active card alone and restores an archived card.

The command uses `GITHUB_PAT_CLASSIC_CODEX`, `GH_TOKEN`, or `GITHUB_TOKEN` when
available, then falls back to `git credential fill`. Credentials are held in
memory and never printed. `inspect` needs Issues, Projects, Pull requests, and
Contents read access to retrieve the issue and comments, board card, linked
PRs, and branch names. `add`, `status`, and `field` also need Projects write
access. `comment` needs Issues write access.
REST lookups stop after 1,000 records and report incomplete results instead of
silently treating a partial history as complete; incomplete blocker, comment,
or PR/branch context makes the issue not ready.

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
Project V2 board. Setting `Ready` or `In Progress` reruns discovery and refuses
the transition when criteria, blocker, comment, or PR/branch context is
incomplete. Setting `Review` requires an open, non-draft PR tied to the issue.
Once a Blocked condition is resolved, readiness can be reevaluated and the
issue moved back to `Ready`.

## Execution and recovery

1. Inspect the issue, its parent/related issues, comments, dependencies,
   project metadata, branches, and linked PRs. Resume an existing branch or PR
   when it belongs to the issue.
2. Confirm the issue is open, acceptance criteria are understood, and every
   blocker is closed. If a blocker or required product decision prevents work,
   set `Blocked` and record the reason on the issue.
3. Set `Ready`, then `In Progress` when implementation starts. Use an isolated
   `codex/<short-slug>` worktree for substantial changes and preserve the
   primary checkout.
4. Plan from the acceptance criteria. Implement only the requested issue. Run
   changed-file lint and focused tests where supported, plus conditional
   typecheck/build/browser checks from `AGENTS.md`.
5. Delegate independent slices when they can proceed without overlapping
   edits. Ask for an independent review when useful and resolve meaningful
   findings.
6. Open one PR referencing the issue. Include the summary, acceptance-criteria
   coverage, exact candidate SHA, and check results. Move the issue to `Review`.
7. Keep progress and blockers in issue comments. If a new agent resumes, rerun
   `inspect`, read the latest comments and PR state, and continue from the
   existing branch and exact candidate.

Post a concise issue update from a file when durable progress is useful:

```powershell
node scripts/agent-harness.mjs comment 29 --body-file .\progress.md
```

## Verification

The harness has dependency-free unit tests using Node's built-in test runner:

```powershell
node --test scripts/agent-harness.test.mjs
```

They cover GitHub remote parsing, exact repository-to-card matching,
acceptance criteria extraction, issue references, branch-resume hints, and
readiness/blocker/archive decisions. Do not use a requested live issue as a
temporary test fixture. Prefer the unit tests; when live transition coverage
is essential, use a dedicated test issue and restore every changed Project
field before finishing.
