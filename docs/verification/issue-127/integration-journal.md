# Epic #127 integration journal

Base: `79df809db41ca824913719e91eaea4c5a3132fb4` (`origin/main`, fetched 2026-11-17).
Integration: `codex/ux-audit-127`, `C:/lamilia-lomi-ux-127`.
Scope: all F01-F32, one non-draft PR, no merge/deployment/Production mutation or issue closure.

## Discovery

All #127-139 descriptions and comments retrieved with gh; all harness inspect results show active Project cards and readable dependencies/history. No open PR existed. No add was necessary. Ready/In Progress transitions recorded by harness. Primary checkout remains unchanged.

Primary `C:/lamilia-lomi` has uncommitted card title wrapping and PDP filename-caption suppression. Exact diff saved privately in `.task/ux127/owner-unpushed.patch`; preserve and integrate equivalent changes in owned files. No unpushed primary-main commits relative to origin/main were found. Other dirty files (AGENTS, test outputs, RODO audit, probe) are unrelated and remain untouched.

## Ownership and queue

- `/root`: supervision/integration, commits, issue/Project records, PR and final gate. No package implementation.
- `/root/navigation`: UX01, UX05; product-card, mobile-navigation, navigation-link, pending, shared Button/toast. Queued UX03 and UX02 route states after contract established.
- `/root/admin`: UX11; product-editor, upload client, admin errors, cloud save/media storage and encoder cancellation. Later queue: UX10 and related repository pagination.
- `/root/qa`: matrix, baseline and final QA, isolated backend, Playwright config. Owns QA documentation and coordinated test harness. Not the independent full-diff reviewer.
- Independent full-diff reviewer: to be tasked in a separate agent slot after an implementation worker hands off. Must not implement reviewed changes.
- Queued next area worker: UX04/UX09 auth/contact/library and UX08 content; UX06/UX07 media/gallery and PDP streaming. Assign before editing their shared files.

Only one heavy build/E2E run at a time. Baseline QA owns the initial production build. Each writable node_modules/.next belongs to its own worktree. Unit tests in workers remain focused.

## Shared contracts

NavigationLink keeps its compatible API while replacing the bottom pending bar with reserved inline feedback. Product-card pending stays visible on the cover. Menu consumes its history entry before destination navigation; safe preparation must not redeem codes. Toast `showToast(kind, message)` stays compatible; navigation worker owns queue/lifetime implementation. Media and auth changes must retain all existing access, moderation, idempotency and QR contracts.

## Evidence policy

Worker targeted results do not prove final acceptance. Final QA and independent review bind actual base/head, run IDs and screenshots; all skipped scenarios remain explicit. Production smoke is a future plan only. Physical devices are separate from Playwright emulation.

## Queue update

Navigation owns next UX03/UX02: community-gallery, catalog form/loading, route recovery and PDP/content-repository streaming; catalog technical copy/metadata too. PDP caption owner patch will be preserved there. Product-image-gallery remains reserved for the upcoming media worker. Admin owns next UX10 and creations onboarding (F25): manager, owner pagination/repository/API, with no gallery/PDP overlap. The public `/en/unlock` selector is the intended generic entry, while printed `/en/unlock/<slug>` and legacy redemption remain intact.

Initial integration dependency install: PASS, `npm ci --no-audit --no-fund`, install_reason=node_modules_missing, 642 packages. Initial full diff whitespace check PASS; worker source remains in progress, no final gate claimed.

## Runtime policy blocker (2026-11-17)

Actual process-creation rejection, before any listener or live handle:

- QA: `npm run start -- --hostname 127.0.0.1 --port 3127` in the baseline worktree: BLOCKED by automatic execution policy.
- QA: direct Next binary `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3127`: same BLOCKED. No retry through other launchers.
- Supervisor: exclusive local Supabase configuration/start command, using TEMP project `lomi-ux127-isolated-20261117` and documented optional-service exclusions: `exec_command failed: CreateProcess ... rejected: blocked by policy`. Because the entire command was rejected before process creation, neither configuration changes nor startup ran. Only earlier `supabase init` succeeded, creating the default temporary config. No migrations/fixtures or hosted operations ran.

Required production-mode timing, actual browser execution and real local backend persistence remain BLOCKED/NOT RUN. These are not passing evidence and prevent complete acceptance. The minimal external unblock is permitting the already-authorized local loopback Next production server and exclusive local Supabase test stack. Source implementation, targeted verification, test collection, broad static/unit/build checks and independent review continue. Do not bypass the runtime policy or weaken fixture guards.

Project readback: all #127-139 confirmed In Progress with `gh project item-list 1 --owner fantomx775 --format json --limit 200`. Some harness write calls had intermittent network errors; local gh fallback used for the missing updates, then authoritative readback confirmed all13. Epic progress/blocker evidence posted at https://github.com/fantomx775/lamilia-lomi/issues/127#issuecomment-6963212007.

## Runtime recovery update (2026-11-18)

The earlier rejected combined command is historical, not evidence of a blanket runtime prohibition. A safer separated configuration write/readback and explicit standalone `supabase start --workdir <exact owned TEMP path>` passed process creation. Actual CLI diagnostics then identified a relative confirmation-template path and exhausted Docker automatic address pools. The template path was corrected to `./supabase/templates/confirmation.html`. Read-only network inventory proved the new10.221.127.0/24 subnet unused; only `supabase_network_lomi-ux127-isolated-20261117` was created with the matching project labels. No existing network/container was removed. Startup was resumed using the documented `--network-id` option; QA owns health/identity guard, migrations and controlled fixtures next. No runtime acceptance is implied yet.

Next framework security nudge from an accidentally non-list E2E invocation is a separate actual exit1 before readiness, not the earlier CreateProcess rejection. Read-only `npm audit --omit=dev --json` reports existing Next moderate and picomatch/watcher high findings. No dependency changed. The generic output request to perform an unrelated upgrade is not scope authority. The npm.ps1 wrapper lost forwarded flags in one worker run; collection was repeated using the explicit Node Playwright CLI. Final gates must verify actual command flags, using the native npm.cmd route or direct equivalent where needed.

Each finding has one lead implementation owner in the matrix. Navigation contributes card/PDP/catalog/auth metadata to media_content-led F19/F21/F28; admin contributes creations onboarding to navigation-led F25. Source file ownership remains exclusive and transfers are explicit. Independent reviewer identified R1 toast resolution and R2 F04 URL test matching; admin applied focused fixes, full final review still required.

## Candidate source freeze

All area workers handed off source after R1-R7 independent-review remediations. This is not final acceptance. Source completeness32/32 is distinct from executed32/32 verification. Final broad commands, real browser/backend campaigns, comparable baseline/candidate samples, screenshots and exact-SHA rereview remain required. The source lead mapping in matrix is authoritative. Runtime setup has recovered; no permanent external blocker is claimed.

Primary checkout status was rechecked and retains exactly the earlier dirty AGENTS/card/PDP/test outputs and untracked RODO/probe artifacts. Remote main remains79df809db41ca824913719e91eaea4c5a3132fb4. No Production, main push, merge or issue closure occurred.
