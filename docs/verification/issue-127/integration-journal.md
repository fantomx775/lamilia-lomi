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

## First real production-flow result and repair

On e15f01b7a182893e11e5fed8dd57f5fb1e7d5994/buildGy6cHtcy5AJLe81kbkiC3, F31 failed before Storage transfer: target preparation200 generated https://localhost without3443, and real TUSPOSTs hit default443/ERR_CONNECTION_REFUSED. Separate45-second and short sanitized diagnostics confirmed the exact origin, without recording tokens/headers/query. Acceptance timeout and guards were not relaxed. Controlled actor/product cleanup counts were all0. The media-storage endpoint helper now uses URL origin to preserve custom ports while retaining hosted Supabase storage hostname mapping and discarding userinfo/query/fragment;34 focused tests passed. Actual F31 acceptance remains pending the new build/rerun.

F28 completion audit removed manual brand suffixes from Account/MyCreations/Guidelines and added unique truthful Privacy/Terms/reset metadata. Legal bodies and authentication actions are unchanged;21 existing focused tests passed, with actual rendered-head assertions prepared for QA.
# Recovery checkpoint: cancelled local file and actual chunked transport

On working source after `54772114dc8423ca71e51f622d81f44f326596ac`, preparing the real F30 acceptance case exposed a cancelled-file recovery defect. Three focused tests reproduced that saving the other product fields cleared the original cancelled File and falsely reported all changes saved. Successful-save cleanup now follows only asset client IDs actually serialized into that request. The unresolved File remains available for Retry, keeps navigation protection, and prevents a new-product redirect from losing the local draft. Explicit removal intentionally resolves that draft. The five recovery cases and four affected suites passed (141 tests); this is unit evidence, not browser encoder acceptance. Independent working-diff review found no confirmed new Critical/High/Medium issue.

The F29 browser assertion now waits for the actual owned PATCH 200 and matching revision before reading the database. Previously it could inspect a textarea's already-present draft before the request completed. Its real backend rerun remains required.

A controlled valid 45-second VP9/WebM fixture was generated using the already installed Playwright FFmpeg, without adding dependencies. Actual container metadata: 960×540, 24 fps, 12,769,858 bytes. The new real-backend acceptance tests exercise a valid PDF larger than a TUS chunk and actual browser WASM cancel→Save→Retry. Fixture generation and test collection do not establish runtime PASS. The benchmark's unsupported ESM-to-TypeScript helper import was also corrected to a normal typed Playwright spec; its earlier import failure is not performance evidence.

The first complete benchmark attempt on exact baseline79/build `2RSz4aI_0ickjnVJWPIYO` returned 3 PASS/3 FAIL because of unclassified aborted requests. A one-pair diagnostic distinguished typed Next prefetch cancellations from an aborted placeholder image, and found a stranded controlled fixture from an earlier interrupted batch52 (revision3 before its final delete). The successful batch547 used a different fixture and completed cleanup. Recovery reverified the exact isolated database/container, product and three actor identities and dependencies, removed only those owned objects/rows/accounts, and read back zero residual product/actor/artwork/Storage objects. No unrelated data was removed. Final comparable timing still requires a new clean-data baseline/candidate campaign. Benchmark diagnostics and partial samples are persisted before assertions; soft network assertions retain overall FAIL while collecting all requested pairs. Warm means repetition in the same browser context with browser cache retained; no router-cache guarantee is asserted after document navigation.

## Actual `0b9cf5b` production checkpoint

Canonical typecheck and production build passed on `0b9cf5b6309e9b258b6b9001420e2d688426e818`; build `nB8VOMeDiO4YDdHwuTQX6` used the guarded isolated Supabase HTTPS configuration. The first build attempt stopped on Next's SecurityFatalError recommendation; the identical retry passed and both attempts were retained. Independent full-range source review reported no unresolved findings and was published as a SHA-bound review record.

The real Chromium campaign ended with 1 PASS (F31), 1 FAIL (F30 PDF), and 11 NOT RUN after maxfail1. F31's actual retained/reloaded previews decoded850×1100, run `ux127-admin-chromium-89f769cb`. The valid large PDF passed real TUS POST201/PATCH204, HEAD200 full offset/length, actual transfer hash and downloaded Storage-byte identity. Its Save then failed the unchanged assertion: after the owned Server Action200 the bar still said unsaved. No PDF DB/reload acceptance was reached. A focused regression subsequently reproduced a genuine timing defect: rAF could read the form while React still kept its fieldset disabled, establishing false dirty state. The repair and real rerun remain required; transport success alone is not F30 PASS.

Terminal cleanup readback found zero controlled products/accounts/artworks, named PDF objects or orphan product objects; owned app/proxy/runner processes and listeners3128/3443 were absent. The line reporter also counted one unattributed global error without its stack; a private JSON reporter is required on the next run to capture its actual cause rather than guessing or ignoring it.

The PDF dirty-state regression subsequently passed RED→GREEN: the saved request signature is now applied in a layout effect after the enabled DOM commit, and dirty reads skip a still-disabled form. Six focused cases and all142 tests in the four affected editor/media-save suites passed; browser Saved/DB assertions and timeouts were unchanged. Real PDF/video rerun remains mandatory. The same next checkpoint adds an observed Club list/artwork/creator cold/warm campaign and actual three-route ON HTML proof bound to its own browser run ID, plus a managed all-project local-demo configuration. Benchmark settling now waits for network quiet, fonts and actual visible-image decode outside the measured pointer interval; global failure assertions remain intact. These are implemented tests and infrastructure, not unexecuted acceptance claims.

On `e8818ea31da8015d0bd514ace96b91bc67e28d99`, build `dqftPMRtKsLALGJlwWEVi`, actual F31 and the complete PDF case passed. PDF run `ux127-chunked-pdf-chromium-e792b13e` transferred7,080,998 real bytes (POST6,291,456; PATCH789,542; HEAD200), matched downloaded Storage SHA256, then passed Saved, database and reload. Root visually reviewed its reloaded row and clean Save bar. The video case passed real pinned-WASM EXEC, preparation/cancel, retained draft/gallery and partial-Save DB checks; it then failed a test wait registered before retry encoding with the generic20s request deadline. The application's existing preparation contract is loader60s plus encoding/write/read420s. The observer now uses that bounded preparation contract plus the existing20s target-request allowance, handles its outcome immediately and disposes listeners/timer; the600s case budget and normal UI/hash/Save/DB assertions remain unchanged. Actual retry-to-target elapsed is recorded separately, with no speed or full-case PASS claim. A new matching-head runtime remains required. The campaign ended2PASS/1FAIL/10NOTRUN with zero residual fixtures/objects/processes; JSON identified the additional global entry as the maxfail stop notification, not another application error.

On `651a185c7f13bf7ba59f7fb8ca099f438899f78b`, build `7kjK7O8MSLplpxvXnb1nf`, the real45s video case passed completely: run `ux127-large-video-chromium-4a28df65`,12,769,858B WebM input→10,226,218B MP4, actual retry preparation/signing110,096ms, real POST6,291,456B/PATCH3,934,762B/HEAD200, Storage hash, Save, DB, reload and decoded45s/960×540 output. The whole batch ended6PASS (F31/PDF/video/F12ON/F29/F28),1FAIL(F18),1intentionalOFFskip,5NOTRUN. F18 exposed a genuine RSC boundary error: the server's ProductInsideBookSection called isPlayableVideoAsset exported by a use-client module. A shared pure-helper repair and fresh runtime are required; the failed main hero assertion is retained. Terminal cleanup again confirmed zero controlled residual data/objects and owned app processes/listeners.
