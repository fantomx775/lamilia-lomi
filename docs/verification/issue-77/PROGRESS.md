# Coloring Club P0 execution checkpoint

Original scope: EPIC #77, P0 #78–#85, user overnight authorization dated 2026-10-25. Full instructions remain at `/home/mateusz/.codex/attachments/d02f7a11-6baa-44d3-8898-5d8092d08a5c/pasted-text-1.txt`. User asked to be notified when preflight finishes; GO was explicitly reported in conversation.

## Current state

- Preflight GO; see PREFLIGHT.md and EPIC authorization/evidence comment: https://github.com/fantomx775/lamilia-lomi/issues/77#issuecomment-6403835564
- Branch/worktree: `codex/coloring-club-p0`, `/home/mateusz/Dokumenty/Lamilia Lomi/lamilia-lomi-coloring-club-p0`. Initial base `aca69f97b46a0294d92c297a833bae832071caa0`. Preserve original checkout and its user's lockfile modification.
- Last completed code checkpoint #78: implementation and fix-loop review, server flags default OFF, canonical spec and supplied design pack committed. Evidence in CC00.md, issue update https://github.com/fantomx775/lamilia-lomi/issues/78#issuecomment-6403933780. Still open pending integrated release; no final PR yet.
- #79 implementation in progress by real Luna task `/root/cc00_spec_flags` (same worker continues sequentially from #78). Current assigned scope: new `src/lib/community/*`, CLI-generated community-foundation migration, local real DB test, architecture note. Worker must report before parent review/commit. Never restart a live task from this file alone: inspect collaboration state and message/poll its actual handle.
- Independent read-only reviewer `/root/preflight_review` did not implement code. Previous CC00 review's remaining evidence finding concerned explicit production dependency delta; CC00.md now records the command, delta, semver rationale and successful build. Final integrated candidate still needs fresh exact-SHA independent review and harness records.
- #80–#85 not implemented. Do not skip dependencies or treat harness `ready` as proof of textual dependency completion. #78/#79 Project statuses currently In Progress; other P0s Backlog.

## Infrastructure/test recovery

- Separate local Supabase stack `lamilia-coloring-club-p0` is running. Database container `supabase_db_lamilia-coloring-club-p0`; API 55421, DB 55422, mail sink 55424. Never modify any `pj-*`/Panel Jazdy container/resource.
- Local config `/tmp/lamilia-coloring-club-db/supabase/config.toml`. Original 22 migrations and seed restored with local `psql -U supabase_admin` after normal bootstrap failed on historical storage ownership. CLI helper path in PREFLIGHT.md. pgTAP installed in extensions; run SQL tests with `docker exec -e 'PGOPTIONS=-c search_path=public,extensions' -i supabase_db_lamilia-coloring-club-p0 psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1`.
- Local test keys in `/tmp/lamilia-p0-preflight/local-supabase-status.json` (private, do not log/commit). All real test code must assert API port/project identity before writes. Controlled fixtures only.
- Verified cloud DB ref `ebyhoawczbexwtioywuk`, via explicitly named Lamilia MCP account; 22 applied versions and no pending baseline versions. CLI's saved identity does not list this project. Use correct MCP for actual cloud migrations after all gates, not inferred CLI linking.
- Baseline browser server on port3100 was stopped for build; no app server is expected running at this checkpoint. Confirm actual processes before restarting. Chromium1223 installed and working. For actual Supabase app E2E, canonical config requires HTTPS even locally; `next dev` supports `--experimental-https-key`/`--experimental-https-cert`, and existing `issue-30-supabase-auth.spec.ts` shows controlled local HTTPS patterns.
- Session sleep inhibitor PID433110, 12h timeout, AC power; verify it remains live if resuming much later.
- Vercel immutable baseline deployment verified, protection remains enabled. Temporary share-generated cookie is in `/tmp/lamilia-p0-preflight/vercel-smoke-cookie`, private. Harness supports `AGENT_HARNESS_PRODUCTION_SMOKE_COOKIE` scoped to exact immutable project host. Obtain new access for final deployment, don't assume old cookie validity. No sensitive value belongs in git artifacts.

## Architecture decisions / next checks

- Raw community tables and write RPCs service-only, RLS enabled, all anon/authenticated raw grants revoked. Application anonymous GET provides approved safe projections only and enforces server env kill switch. Direct PostgREST never exposes raw storage/author fields. This is an intentional interpretation of issue #79's anonymous SELECT requirement, matching the existing reader-artworks architecture and avoiding direct-REST bypass of environment flags. Worker must document it explicitly.
- Server-derived actor identity only (`getUser()` through existing session helpers); SQL rechecks actual email verification, active adult/rules participation, published product/unlock, current admin role and CAS revision/state. No body-controlled actor/status and no user-metadata role authorization.
- Public bytes must always pass application status/flag checks with private/no-store. No browser-disclosed provider signed URL. Reuse existing media/storage building blocks without changing curated/premium media behavior. #81 must re-encode with Sharp and strip metadata.
- Parent inspected all ten supplied full screenshots via actual image tools and read design README. Future UI workers must also inspect the relevant actual references before editing; mock names/images/counts are documentation fixtures only. Gallery is photo-first, roughly two columns on390/four on1440; mobile My Creations horizontal cards; upload drawer becomes focused full-width mobile; moderation single scrolling page on mobile, queue and preview on desktop. No inferred title field, follow/loved-artworks page or other mock decoration unless required by issues.
- One final PR uses non-closing refs #78–#85. Delivery first #85 after all features/gates pass, then individual `resume-pr --issue` runs for remaining children, then EPIC only after all complete. No merging #70, no manual `vercel --prod`, no bypass of exact-SHA checks.

## Release state

No new cloud migrations, final PR, main merge, or new deployment yet. New community flags remain OFF; public/legal readiness unproven. Full unit/typecheck/lint/build/E2E, genuine community RLS/Storage matrix, responsive visual QA, independent review and deployed journeys remain to be completed. This file does not prove completion.
