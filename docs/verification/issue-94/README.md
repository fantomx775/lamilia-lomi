# Production admin read incident — 2026-10-31

## Confirmed baseline

GitHub `main` and the live `www.lamilialomi.com` alias resolve to
`aff7125f4eaf3243234818e1f31cf33f4a0d2dce`, Vercel Git Production deployment
`dpl_9WPDkhLi2jX1SK63ptp8iyYxVyLn` (READY). Its CI run `40409241679`
completed successfully. PR #91 is merged. PR #70 remains open, conflicting,
130 commits behind this main and eight unique commits ahead. The initial
inventory found 19 open issues and one open PR. Issue #85 is already closed;
#77–#84 remain open. Historical checklist state is not proof of acceptance.

Read-only Production Supabase inspection found all 31 repository migration
versions, including the nine community migrations. `collections`,
`product_collections` and `premium_codes` all have RLS enabled,
`authenticated`/`service_role` SELECT privileges and no `anon` SELECT privilege.
Their authenticated policies require `private.is_admin()`. No Production
schema, grants, policy, user, media or environment value was changed.

Production environment metadata confirms both Coloring Club flags are
`false`, and the presence of `AUTH_RESUME_SECRET`, `RESEND_API_KEY` and
`CRON_SECRET`. Secret presence does not prove provider delivery or the
health of scheduled maintenance. The earlier CC08 missing-secret observation
is superseded by this readback. Anonymous community HTTP reads remain disabled.

## Reproduction and root cause

On 2026-10-31 at approximately 20:00 UTC, anonymous GET requests to `/admin`,
`/admin/products`, `/admin/products/new`, `/admin/collections` and
`/admin/pages/about` rendered the denial layout while generating the reported
permission failures. `/admin/products/new` returned HTTP 200 but contained RSC
error digest `2472455123`; the corresponding Production runtime log named
`premium_codes`. Other requests reproduced `product_collections` errors.
Thus HTTP 200 and visible denial were insufficient acceptance checks.

The admin layout validates identity and profile role, but Next.js renders
child route segments independently. The pages eagerly call the shared admin
snapshot reader, which previously started parallel table reads without its
own access check. A guest or invalid session therefore used the anonymous
PostgREST role for admin-only tables. Correct database privilege denials were
reported as application exceptions. Authenticated grants were present; there
is no evidence supporting an anonymous grant or a service-role workaround.

The installed Next.js authentication guide explicitly documents this layout
behavior and recommends authorization at the data access layer.

## Correction and acceptance

Sensitive snapshot options now check the existing request-cached access
function before any database or local-store reads. That function validates
Supabase `getUser()` and the current `profiles.role`, independent of editable
user metadata. Denied callers receive an empty snapshot for the existing
denial layout. The product-edit page may additionally emit its controlled
`NEXT_HTTP_ERROR_FALLBACK;404`; this is distinct from an unhandled database
error. Public snapshot reads retain their existing behavior.

The regression first failed three tests with the original implementation.
Focused coverage includes all sensitive option combinations, public reads,
guest/expired/user/admin roles, metadata spoofing and existing product,
collection and premium mutation tests. The real-backend browser regression
uses owned loopback-only fixtures and checks all affected page families,
underlying PostgREST grants/RLS, HTML/RSC errors, no private-data disclosure,
editor reload and desktop/mobile screenshots. Raw credentials and sessions
are not recorded. Every owned fixture is removed in `finally`.

Exact final commands, browser provenance, independent review and CI results
are recorded in current-head PR comments. An initial cold-development-browser
attempt timed out compiling `/admin`; that failed attempt is not a PASS.

## Release boundary

This PR does not resolve the deployed incident by itself. Production remains
on the baseline until explicit delivery approval, normal harness gates,
Vercel Git deployment, authenticated/anonymous smoke and runtime readback.
Neither community flag may be enabled as part of this fix. No new migration
or database privilege is needed.
