# Coloring Club P0 preflight — 2026-10-25

Decision: **GO**. This is environment/baseline evidence, not feature acceptance or release completion.

Owner authorization: the user supplied the autonomous overnight implementation instructions dated 2026-10-25, explicitly authorizing P0 implementation, validated migrations on the verified Lamilia database, one final normally gated merge, Vercel Git deployment, verification, and issue updates. This supersedes the older delivery restrictions in issue descriptions. Required security/repository gates remain binding. Public availability still depends on operational/privacy/legal readiness; no professional legal review has been established.

## Repository and workflow

- Repository: `fantomx775/lamilia-lomi`, HTTPS origin verified; GitHub authenticated as its owner with repository and `project` scope. Original missing Projects scope was fixed externally, then `inspect 78` and `inspect 79`–`85` passed.
- Current remote main and initial branch head: `aca69f97b46a0294d92c297a833bae832071caa0`.
- Dedicated worktree: `/home/mateusz/Dokumenty/Lamilia Lomi/lamilia-lomi-coloring-club-p0`; branch `codex/coloring-club-p0` created and pushed successfully. Original main checkout and its dirty lockfile preserved.
- Only open PR found: #70, `codex/issue-23-r2-cdn-quality`, head `5a667358642d88de6394a3c55f793bd5fe74ee9e`. Independent read-only reviewer inspected its full diff. Shared overlap: media route, content repository, image galleries, media-upload helpers, Next image configuration. No community implementation exists there. Do not merge it as part of P0.
- Issue #83's harness branch match `codex/fix-public-product-assets` is unrelated legacy media/premium work: comparison is 5 commits ahead / 386 behind main, no community files. It is not an existing #83 implementation to resume.
- No effective main rules or classic branch protection were found (rules endpoint `[]`, protection endpoint 404). Normal GitHub merge remains authoritative; recheck before delivery. CI exists and must be inspected on the final candidate.
- Read AGENTS.md, CLAUDE.md, harness documentation/code, canonical product docs, all P0 issue bodies/criteria, and installed Next.js route-handler, mutation, and server/client-component guides. Canonical docs contain stale multilingual/local-only claims to reconcile in #78.
- Explicit dependency order: #78 → #79 → #80 → #81 → #82 → #83 → #84 → #85. Textual dependencies are not native blockers; do not trust `inspect.ready` as dependency proof. Complete and verify each slice before starting its dependent slice; keep issues open until post-deployment verification.
- One final PR with non-closing references to #78–#85. `verify-pr` evaluates exact base/head, local/browser/review/release evidence, GitHub rules/checks and mergeability. `deliver-pr <PR> --issue 85` is supported once all work is complete. Then sequential `resume-pr <PR> --issue 78` through `84` rechecks the same exact deployment and completes each issue separately. EPIC completion only after all P0 children pass. No safety gate adaptation needed.
- Independent agent evidence: `/root/preflight_readonly` (Luna read-only delegation round trip), `/root/preflight_review` (independent harness, docs and PR #70 analysis). Sequential Luna implementation and separate review tasks are available.

## Ubuntu and tools

- Node 22.23.3, npm 10.9.9, GitHub CLI 2.102.0; Next 16.4.3 and Playwright 1.60.0 installed in dedicated worktree. Vercel uses Node 24.x; final hosted verification must retain that distinction.
- RAM 7.4 GiB, swap 2 GiB; initially 3.9 GiB available, later 5.2 GiB available. Approximately 39–40 GiB disk free. Use one build or browser suite at a time, one Vitest/Playwright worker.
- AC power online. Session-only sleep/idle inhibitor active (`systemd-inhibit`, PID 433110, 12-hour sleep handle). Do not alter persistent OS settings.
- Docker works. Existing `pj-mig-flota-ubuntu` containers belong to Panel Jazdy and were left untouched.
- An entirely separate `lamilia-coloring-club-p0` local Supabase stack is healthy: API 55421, database 55422, local mail sink 55424. Config lives at `/tmp/lamilia-coloring-club-db/supabase/config.toml`. Only Auth/REST/Storage/gateway/database/mail services enabled. CLI binary: `/home/mateusz/.npm/_npx/5ed57a240faae6e6/node_modules/@supabase/cli-linux-x64/bin/supabase` (2.121.0).
- Chromium 1223/headless shell installed after first browser attempt found the required revision absent. Actual browser execution and visual inspection succeeded afterward.

## Database and storage

- Connected Supabase MCP account explicitly named Lamilia Lomi; verified project `ebyhoawczbexwtioywuk`, name `lamilia-lomi`, healthy, eu-west-3, PostgreSQL 17.6.1.155. Vercel's configured public Supabase URL points to this exact ref.
- Read-only SQL confirms role `postgres`, public schema CREATE privilege, Storage USAGE, 20 public tables with RLS enabled, and 22 applied migrations. Buckets `public-media`, `public-videos`, `premium-files`, `collection-media` all private.
- Equivalent read-only migration preflight used MCP migration history plus exact local migration version comparison: 22 local = 22 applied; **no pending or remote-only migration versions**. Supabase CLI's local saved identity does not list Lamilia, so do not link it to an inferred project or use that identity for target writes. Use the explicitly verified Lamilia MCP for target migration operations and rerun history/schema checks immediately before delivery.
- Default local CLI restoration failed at historical `alter table storage.objects enable row level security` (42501: not table owner). Historical applied SQL was not modified. Started the independent local stack without application migrations/seed, then executed all 22 unchanged historical migrations and seed through `psql -U supabase_admin` inside **only** `supabase_db_lamilia-coloring-club-p0`: PASS. This is a local bootstrap privilege workaround, not a change to cloud resources.
- Installed pgTAP only in that disposable local database. Existing reader-artwork RLS/grant test: all 9 assertions PASS using `PGOPTIONS='-c search_path=public,extensions'` and `ON_ERROR_STOP=1`; transaction rolled back.
- Genuine local Storage API upload/download PASS; known private object denied to anonymous client; object removed successfully. Controlled fixtures and local mail sink allow real Auth/RLS/Storage/deletion/concurrency tests without using customer data.

## Baseline and deployment capability

- Initial `npm ci --no-audit --no-fund`: FAIL, existing lockfile resolution has picomatch 2 where 4.0.7 is required. `npm install --no-audit --no-fund`: PASS (603 packages), repaired lockfile only in task worktree; `npm ci --ignore-scripts --dry-run --no-audit --no-fund`: PASS. Include this baseline repair and dependency evidence in final PR.
- `npm run typecheck`: PASS.
- `npm test -- scripts/agent-harness.test.mjs src/lib/auth.test.ts src/lib/premium-request.test.ts src/lib/reader-artworks.test.ts --maxWorkers=1`: PASS, 94 tests / 4 files.
- App startup: PASS at `http://127.0.0.1:3100`, local adapter. Full production build: NOT RUN in preflight (startup satisfies baseline runnable gate); required at final release.
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npm run e2e -- tests/e2e/smoke.spec.ts --project=chromium --workers=1 --output=/tmp/lamilia-p0-preflight/browser-results`: PASS, 4 tests. Public browse/download, demo login/library, guest admin guard. Catalog screenshot opened and visually inspected; no page errors. This is baseline local-adapter evidence, not real Supabase app-flow acceptance.
- Verified Vercel project `prj_ktTjOHS0QW0pdfyhKaQs883MJvYd`, team `team_lS6KpgnOGBg7jJ1AKF0Z2QU4`, production domain `www.lamilialomi.com`; production deployment `dpl_AhXoPw3wCdzxnpiq7CZz1op79Xog`, immutable URL `https://lamilia-lomi-cyemf7gvx-fantomxs-projects.vercel.app`, source `git`, exact main SHA above, READY. GitHub deployment/status records are readable.
- Vercel project/env inspection works. Required Supabase, R2, Resend and canonical URL environment names exist for production. Values/secrets were not logged. Changes, if required, use scoped Vercel tools for this exact project.
- Immutable deployment is protected. Existing authorized account share access yielded a temporary protection cookie; protection was not disabled. Existing harness `runProductionSmoke` supports `productionSmokeCookie` / `AGENT_HARNESS_PRODUCTION_SMOKE_COOKIE`, restricted to this project's immutable hostname. Actual exact-deployment smoke: PASS, `/en`, `/en/products`, `/en/login`, expected HTTP/text verified. First probe used an incorrect case-sensitive expectation `Books`; corrected to actual heading `Browse LamiliaLomi books`, then all passed. This was a probe-expectation error, not an application defect.
- Deployment log access tools are available. Final delivery must obtain/renew exact-deployment access as needed; do not reuse a stale cookie or mutable alias as deployment identity.
- Email strategy: local mail sink/stub for deterministic tests and delivery-failure tests; any hosted test notification must be limited to controlled test accounts. Existing Resend configuration is present; no messages sent in preflight. Successful moderation must not depend on email availability.

## Remaining release work

All eight P0 features, full tests/lint/build/E2E, actual community RLS/Storage security matrix, UI screenshots at 390/768/1440, independent exact-SHA review, validated new migrations, merge and exact-deployment runtime journeys remain **NOT RUN**. Feature launch/legal readiness is not established. Preflight GO authorizes implementation to proceed, not a claim that P0 or public launch is complete.

Non-secret evidence is stored alongside this file as `preflight-*`. Temporary credentials and Supabase status keys stay outside the repository and must never be committed.
