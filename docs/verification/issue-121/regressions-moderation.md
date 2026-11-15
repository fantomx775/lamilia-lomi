# Moderation regression investigation and verification

Base: `d2886cb8aba87fab6272d3efb2cae54d708a9292` (PR #122). These measurements cover the working candidate before integration; final SHA evidence is recorded separately by the coordinator.

The old component initialized four counters to zero and rendered a successful-looking empty queue before any read. Queue and selected detail were client effects following product-option SSR. The Supabase adapter awaited four exact count REST requests before issuing its page request; detail then awaited its artwork before requesting history.

The page now streams an accessible skeleton and loads products and the first queue in parallel on the server, then its first selected detail before hydration. Successful hydration does not issue duplicate queue/detail requests, including React StrictMode's effect replay. Count and list state remain unknown until success; errors have retry and never manufacture empty results. Refresh preserves only matching queue/filter scope and previous valid counts, while marking the region busy. Product/creator scope changes hide the previous scope's counters. Status changes can preserve scope-wide counts but hide stale rows. Request sequence IDs reject stale queue responses; detail requests use abort plus sequence IDs, separate detail errors and retry. Selecting a different work clears armed decisions; refreshing disables decisions until authoritative data is ready.

`community_moderation_counts` replaces four count REST requests with one service-only, invoker-rights aggregate scan. Page and aggregate requests run in parallel (five HTTP requests in two serial waves become two in one wave). Detail and history also run in parallel. The existing partial indexes cover pending ordering, status, product/status and author; no index was added without evidence of an unsuitable plan. At the tiny local fixture size PostgreSQL correctly uses sequential scans.

## Measured evidence

`node scripts/testing/community-moderation-benchmark.mjs` verifies the isolated Docker identity and compares actual baseline PostgREST count-then-page reads against aggregate-plus-page reads. Two warmups and ten measured samples per variant, interleaved. It asserts exact result equivalence, escaped creator prefix behavior, anonymous denial and service-only execution grants. The benchmark makes no database writes.

Recorded run (local loopback, concurrent development workload, one live fixture):

| Queue data REST batch | Median | Min | Max | HTTP requests |
| --- | ---: | ---: | ---: | ---: |
| Before: four counts, then page | 22.345 ms | 14.168 ms | 31.018 ms | 5 |
| After: one aggregate alongside page | 11.436 ms | 5.916 ms | 29.590 ms | 2 |

An earlier quieter run measured 11.298 ms → 5.945 ms. These are real loopback measurements, not production latency or a large-data throughput claim. The stable improvements are fewer network requests, one fewer serial network wave, one aggregate scan instead of four counts and elimination of client hydration waterfalls. SQL `EXPLAIN (ANALYZE, BUFFERS)` for a single-status count and the four-status aggregate each executes below 0.2 ms on the tiny local dataset; SQL computation was not the main delay here. The benchmark prints actual plans for repeatability.

The browser regression also measures five authenticated real `/api/admin/community/artworks` responses after two warmups, with a product-specific fixture; results are emitted to the Playwright log. It verifies actual uploaded Supabase work appears in SSR, no initial browser queue API request, retained counters and rows while a same-scope request is delayed, and successful empty/zero after a status change. Delaying an outgoing request is only used to inspect the loading state; data comes from the real isolated API and database.

## Checks

- PASS: `npm test -- src/app/admin/community/community-moderation.test.tsx src/app/admin/community/page.test.tsx` — 15 tests including loading/error/empty/refresh, stale queue responses, detail retry, conflict revision refresh and StrictMode hydration. Independent-review fixes additionally preserve successful product options when the queue fails, render an explicit server-reload retry if product options fail, and guard isolated browser fixtures behind the opt-in and supported browser projects.
- PASS: `npx eslint src/app/admin/community/community-moderation.tsx src/app/admin/community/page.tsx src/lib/community/supabase-adapter.ts tests/e2e/community-moderation-loading.spec.ts scripts/testing/community-moderation-benchmark.mjs`.
- PASS: real isolated Chromium final instrumented flow; five authenticated API samples median 148.508 ms. PASS: mobile WebKit initial flow before timing instrumentation (13.4 s). A subsequent combined rerun passed Chromium but WebKit failed to launch within its 180-second browser-launch timeout; no application assertion ran in that retry. Final SHA rerun remains coordinator work. Screenshots from successful runs are in `/tmp/lamilia-moderation-artifacts/issue-121/` for integration.
- PASS: local transactional application of migration and grants: `docker exec -i supabase_db_lamilia-coloring-club-p0 psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -1 < supabase/migrations/20261113181925_community_moderation_counts.sql`.

Migration `20261113181925_community_moderation_counts.sql`, SHA256 `48822f7722c8500f4d9e4cd4c6aa147c618925087deaa04296185fbd44ea1248`, only adds a function. It changes no existing data, policies or deployed API signatures. `anon` and `authenticated` cannot execute it; `service_role` can. The application checks administrator role before invoking the service client. Apply and verify this compatible migration in Production before the merge triggers the Git deployment. Production application/verification is owned by the coordinator and is not claimed here.
