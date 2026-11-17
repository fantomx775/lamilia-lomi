# UX127 local acceptance plan

Part of #127 and #139. This document is a plan, not passing evidence.

Baseline: `79df809db41ca824913719e91eaea4c5a3132fb4`, detached worktree `C:/lamilia-lomi-ux-127-baseline`. Integration: `C:/lamilia-lomi-ux-127`, branch `codex/ux-audit-127`. QA task `/root/qa` owns this plan, matrix and Playwright project configuration; implementation owners supply focused regressions. Independent full-diff review is a separate task and remains required.

## Current environment inspection

- Windows; Node 22.15.0; Docker Server 29.8.2 responding; no running containers at inspection.
- Ports 3000, 3443, 55420, 55421, 55422, 55424 had no listeners. Recheck immediately before starting services.
- Approximately 4.4 GiB free RAM out of 15.9 GiB: serialize production builds, Docker startup and browser campaigns.
- Chromium and WebKit browser cache directories exist. Actual binary launch remains NOT RUN.
- Worktree preflight reported `install_reason=node_modules_missing` for detached baseline. Independent install started; writable dependencies/build outputs are not shared.
- No physical iPhone/Android has been connected or tested: NOT RUN, optional later acceptance limitation.

## Baseline preparation results

- PASS: baseline preflight; independent `npm ci --no-audit --no-fund` installed 642 packages.
- PASS: `LAMILIA_BACKEND=local NEXT_PUBLIC_APP_URL=http://127.0.0.1:3127 npm run build` on the exact baseline SHA (actual PowerShell process environment, not shell inline syntax). Log: `.task/ux127/baseline-build.log` (working evidence, not yet final PR artifact).
- Historical command rejection (superseded by the approved managed lifecycle): the execution policy rejected both normal `npm run start -- --hostname 127.0.0.1 --port 3127` and direct `node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3127` before process creation, reporting `blocked by policy`. The subsequent transparent Playwright-managed webServer command was allowed and started Next; this is no longer an external policy blocker. That local-mode production server correctly rejected runtime configuration: production requires HTTPS and prohibits local backend. The local build is build-only evidence, unsuitable for runtime measurements. A Supabase+HTTPS baseline rebuild is now explicitly authorized; no phase/NODE_ENV/security guard is bypassed.
- PASS (collection only): `node node_modules/playwright/cli.js test tests/e2e/issue-127-navigation.spec.ts --project=chromium --project=mobile --project=webkit-mobile --list` collected six cases, two per requested engine/project. This is not browser execution.
- PASS: focused ESLint on `tests/e2e/issue-127-navigation.spec.ts` and `playwright.config.ts`; `git diff --check`.

## Execution order

1. Build unchanged baseline once with `LAMILIA_BACKEND=local`, `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3127`; log build and exact SHA. Start with `npm run start -- --hostname 127.0.0.1 --port 3127`. Verify process command line/worktree and build ID. Never allow Playwright reuse to select an arbitrary dev server.
2. Capture baseline using one controlled synthetic local content dataset and no production secrets/data. Keep dataset identity, browser/version, viewport, DPR, network profile, cold/warm cache state and run ID. Use the same fixtures and timing code for final candidate.
3. Measure separately trusted click to first visible local feedback, visible route fallback, useful destination content and completed operation. Use browser monotonic timestamps/paint-visible assertions, not tool wall time. Record raw samples and medians/ranges for repeated cold/warm runs, with identical network controls. Absence of feedback is an observed missing state, not a zero-millisecond success. These measurements are not field CWV.
4. Stop only the owned baseline server if resources are needed. Build final candidate serially with the same backend/config/profile; serve at a separate verified port, run the same measurement campaign. Recreate identical fixtures rather than sharing writable content stores.
5. Create an exclusive disposable local Supabase project under TEMP after the baseline build. Follow `docs/testing-community-supabase.md`; API55421/DB55422/mail55424, local daemon identity guards, local confirmation template, application migrations unchanged in transactional filename order and recorded ledger, seed and pgTAP. Status and credentials stay private. Local mail sink only.
6. Run real Supabase integration and focused browser mutations. A mock/local-demo pass cannot satisfy cloud save, RLS/storage, auth or premium acceptance. Each mutation needs reload/backend readback and controlled fixture cleanup.
7. After integration freeze one candidate SHA. Required final commands: `git diff --check`; `npm run lint`; `npm test -- --maxWorkers=1`; `npm run typecheck`; `npm run build`; `npm run e2e -- --workers=1`. Count and explain all skips, then run opted-in real backend suites separately; do not sum skipped projects into coverage.
8. Capture and visually inspect before/pending/after screenshots with animations disabled or deterministic state, fixture control and exact current SHA/run ID. Final records go in actual PR comments after candidate freeze; any source change requires refreshed checks/screenshots/review.

## Coverage campaigns

| Campaign | Required cases | Existing starting point / needed extension |
| --- | --- | --- |
| Navigation | delayed cold/warm routes; tall card top feedback; X/Escape/Back/Forward during exit/current route/two targets/no animationend/reduced motion/focus/scroll lock/deferred logout | navigation-feedback, mobile-storefront-121, new UX127 assertions |
| Catalog | query+audience+category+sort, Enter/Search/Apply, no-JS GET, empty/reset, rapid filters/error/retry, Back/Forward and safe catalog return/scroll | catalog-layout, catalog-rich-text-search, navigation-feedback; extend new filter/context tests |
| Routes | Club list/detail/creator skeleton geometry; catalog/Club/PDP section errors and successful retry; delayed reader artwork cannot delay PDP title/cover/CTA | new controlled delay/failure tests, public ON/OFF |
| Contact/auth | required/format/length inline errors, duplicate submit, timeout/provider refusal/retry retained draft; real local sink acceptance; verification status/error semantics; safe return intent | new Contact sink fixture, issue-30-auth-return and real issue-30-supabase-auth |
| Toast | repeated identical successes, success/error both orders, persistent unresolved error, hover/focus/hidden pause, long 320px text, modal/drawer, exit/reduced-motion/unmount | focused unit tests plus UX127 browser checks |
| Media | slot/currentSrc/decoded MIME/size/cache/DPR1/2/3; old originals fallback; thumb/detail all role and flag combinations; takedown/delete revokes every variant | community-public, community-reports-lifecycle, community-flags; extend variant matrix |
| Gallery/video | square/6x9/8.5x11 before/after geometry; thumbnail immediate then decoded larger image; slow/error/retry/sibling/focus/Escape/swipe; real MP4 Range/codec/faststart/start/seek/pause/background/inline | issue-23-gallery-quality, issue-24-image-ux, issue-67-video-poster plus new assertions |
| Content | public copy/accessibility names no filenames/stubs; full titles including About; Author URL; truthful About; unique metadata/sitemap without invented dates | issue-26-product-text, issue-50-about, smoke, new public audit |
| Premium | correct home book selection, guest/unverified/no-book/unlocked/invalid+valid code, printed legacy GET query and fragment POST, no speculative redeem, direct own files and private download after reload | issue-31-qr-premium-workflow, issue-31-supabase-redemption, kdp-shared-supabase, issue-30-supabase-auth |
| Club upload | 1-3 files, phases, one rejected, offline/timeout/background/retry without duplicate, edit/delete revision and reload; 51+ with equal timestamps/page failure/oldest action | community-uploads, community-creations-regressions; new pagination fixture |
| Avatar | immediate publication after upload; role checks, report/takedown/delete revocation; never reintroduce premoderation | community-avatars, community-reports-lifecycle |
| Admin | real encoding/transfer/finalization/cancel; save-error retained Supabase object/id, retry no repeated bytes, reload asset list; deleted local outcome; delayed dimensions/drop/save snapshot races and dirty guard | product-editor-ux Chromium/WebKit plus NEW real Supabase F31 fixture |

Responsive coverage: 320/375/390/430/768/1440 CSS px; portrait/landscape; keyboard/focus, increased text/zoom, safe areas, reduced motion, slow and interrupted network. Desktop Chromium, mobile Chromium and mobile WebKit must actually collect and execute the new spec files. Initial `webkit-mobile` testMatch permits only legacy named specs; configuration must explicitly include UX127 tests. Browser emulation does not prove physical iPhone behavior.

Real backend opt-ins to account for: `RUN_COMMUNITY_SUPABASE_TESTS`, `RUN_ISSUE_30_SUPABASE_E2E`, `RUN_ISSUE_31_SUPABASE_E2E`, `RUN_KDP_SUPABASE_E2E`, `RUN_ADMIN_READ_SUPABASE_E2E`, `RUN_COMMUNITY_LOCAL_E2E`, `RUN_COMMUNITY_PUBLIC_E2E`, `RUN_COMMUNITY_UPLOADS_E2E`, `RUN_COMMUNITY_AVATAR_E2E`, `RUN_COMMUNITY_HEARTS_E2E`, `RUN_COMMUNITY_PROFILES_E2E`, `RUN_COMMUNITY_MODERATION_E2E`, `RUN_COMMUNITY_LIFECYCLE_E2E`, and separate OFF invocation `RUN_COMMUNITY_FLAGS_OFF_E2E`. Inspect each spec's role/project guard before claiming execution.

Future release smoke and migration order are plans only. No merge, deploy, Production writes or issue closure is authorized.

## Isolated backend setup and executed integration

Run ID: `ux127-backend-20261118-0006`; application source remains the uncommitted integration candidate based on `79df809db41ca824913719e91eaea4c5a3132fb4`, so these are preliminary integration checks, not final-head acceptance.

- PASS: private `supabase status --workdir <exclusive TEMP>/lomi-ux127-isolated-20261117 -o json` and `node scripts/testing/isolated-community-target.mjs --docker-metadata`; local named-pipe daemon and exact labeled DB/Kong/network/ports verified. No credentials displayed.
- PASS: unchanged repository migrations, 37/37, each executed transactionally as local `supabase_admin` through the guard-pinned immutable Docker DB ID. Local ledger count37; unchanged seed created4 products; pgTAP installed. Full per-file safe report `.task/ux127/local-backend-replay.json` awaits final evidence packaging. This superuser replay is local setup only.
- PASS: `RUN_COMMUNITY_SUPABASE_TESTS=1 node node_modules/vitest/vitest.mjs run src/lib/community/supabase.integration.test.ts --maxWorkers=1 --pool=forks` —3 actual tests,0 skips, real local Auth/PostgREST repository.
- PASS: `RUN_COMMUNITY_AVATAR_SUPABASE_TESTS=1 node node_modules/vitest/vitest.mjs run src/lib/community/avatar-supabase.integration.test.ts --maxWorkers=1 --pool=forks` —4 actual tests,0 skips, real local Auth/DB/private Storage lifecycle.
- Private status, maintenance secret, owned TLS key/certificate remain under the exclusive TEMP directory; no hosted credentials or production state used.
- Functional local-demo E2E and Supabase production browser campaigns are separate. Demo-guarded tests cannot satisfy real backend acceptance and will be explicitly counted as skips in Supabase invocations.

## Managed production runtime safety contract

The checked-in `scripts/testing/issue-127-production-server.mjs` is launched and shut down by Playwright `webServer`, with `reuseExistingServer:false`. It starts only explicit worktree Next production port3128 and an owned loopback HTTPS3443 proxy. Exact `/auth/v1`, `/rest/v1`, `/storage/v1` requests proxy to the already guard-verified Kong55421; other paths route to Next3128. The app build and runtime both use `NEXT_PUBLIC_SUPABASE_URL=https://localhost:3443`; fixtures keep the private HTTP55421 target. External storage/mail/cache credentials are removed from the child environment (including R2/AWS/Resend/SMTP/Cloudflare). Media provider is explicitly Supabase, telemetry disabled.

Node trusts only the owned certificate via `NODE_EXTRA_CA_CERTS`; the runner verifies its explicit SHA256 fingerprint pin before spawning Next. Playwright's `ignoreHTTPSErrors:true` is an explicit self-signed fixed-loopback fixture exception, not a claim that browser certificate verification is enabled or permission to contact external/Production origins. Benchmark requests and browser failures are checked; unclassified network errors fail. The local TLS private key never enters tracked artifacts.
