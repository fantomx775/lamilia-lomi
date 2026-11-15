# Avatar acceptance after PR #122

The prior `community_avatar_finalize` RPC always wrote `pending`; Account displayed an awaiting-review message and a separate administrator approval queue controlled publication. This was the prior product behavior, now explicitly replaced by immediate publication.

New successful uploads enter `approved` (the existing public-read contract), replace previous photos atomically under the owner-profile lock, and invalidate the old media URL. Account retains crop preview, zoom and position controls, refreshes server components, and shows success/error toasts. The public creator profile, artwork detail and gallery cards use the current published avatar. Gallery lookup is one bounded batch RPC per page, not one HTTP request per artwork. Failed image downloads fall back to initials.

The approval UI is retired. The administrator page defaults to reported public photos and offers takedown; the HTTP endpoint accepts only `removed`. The existing SQL review signature remains compatible with the currently deployed application during the pre-merge migration interval. New uploads are not pending and the replacement application exposes no approve/reject operation.

A verified visitor can report a public photo from its creator profile. Reports remain private; the administrator sees the reason/details and can remove the public photo. The reported queue filters its joined relation in SQL instead of downloading all report IDs.

## Security and release

Migration: `20261113181514_community_avatar_immediate_publication.sql`.
SHA256: `706777b3468d858a9f58dd1a8de402e29835d12e395c6e985a4307149c8485f2`.

This is an additive compatible expansion: the new reports table and batch/report functions do not change existing columns or remove functions. Existing application media routes already interpret `approved` as public. The finalize return signature is unchanged. Historical pending/rejected rows are not mass-published; they remain private until the owner replaces/removes them. Existing cleanup triggers retain a five-minute late-write fence for in-flight uploads and immediately schedule completed replaced photos.

Release order: validate on isolated database, independently review SQL, apply/verify this exact migration and its ledger entry in Production before merge, then merge the compatible application. The parent coordinator owns Production application; this slice performed no Production writes. No flags or public legal pages were changed.

Local SQL checks verified report-table RLS enabled, no anon/authenticated SELECT grant, service-role SELECT, and invoker-only finalize/report/batch RPCs executable by service role only. Existing private Storage policies remain in force. Auth revocation/soft-deletion, wrong-owner access, direct Storage reads and signed URLs, late finalization, replacement/takedown/removal and hard account cleanup were exercised with real local Auth/Storage/Postgres.

## Executed checks

- PASS: `RUN_COMMUNITY_AVATAR_SUPABASE_TESTS=1 npm test -- src/lib/community/avatar-supabase.integration.test.ts src/lib/community/avatar-image.test.ts` — 7 tests, real isolated Supabase lifecycle plus MIME/size/pixel/EXIF/GPS image checks.
- PASS: `npm test -- src/components/community/community-artwork-report.test.tsx 'src/app/api/community/avatars/[id]/report/route.test.ts' src/lib/community/repository.test.ts` — 12 tests, report UI, same-origin/session/verified identity/strict body/duplicate/privacy boundaries.
- PASS: `npx tsc --noEmit`; focused ESLint for changed avatar/report/gallery/repository files.
- Browser evidence is recorded by the coordinator at the final candidate SHA. Interim real Chromium completed upload/crop/publication, all three public consumers, replacement, visitor reporting, administrator takedown, another upload, self removal and reload persistence. A WebKit assertion initially assumed a relative image URL; WebKit/Next emitted its equivalent absolute local URL. The assertion now compares both exact origin and path.

No physical iPhone Safari was available. Playwright iPhone 13 WebKit is the mobile engine evidence.

Interim browser verification: `RUN_COMMUNITY_AVATAR_E2E=1 node /tmp/lamilia-p0-preflight/run-tests.cjs npx playwright test tests/e2e/community-avatars.spec.ts --project=chromium --project=webkit-mobile --workers=1` with the isolated app environment loaded privately — **PASS 2/2**, Chromium 31.3s, iPhone 13 WebKit 52.3s. Both runs assert empty JavaScript-error and rendered-resource-failure arrays. Explicit negative API probes separately assert 401/403/404. Before replacing or removing a just-uploaded photo the test waits for its actual decoded image, avoiding a test-generated request to an already revoked image. Public-consumer checks use independent anonymous contexts.

Full migration replay: `docker exec -i supabase_db_lamilia-coloring-club-p0 psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < /tmp/lamilia-p0-preflight/verify-avatar-migration.sql` — **PASS**. The transaction drops only the new local table/functions, restores the previous finalize implementation, executes the entire exact migration file, verifies RLS/grants, and rolls back. This demonstrates forward application from the deployed contract without changing the persistent test database. The final migration's function/table privileges were also read directly from `pg_proc`, `pg_class`, `has_table_privilege`, and `has_function_privilege`.
