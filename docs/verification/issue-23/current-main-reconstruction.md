# PR #70 reconstruction on current main

This work reconstructs the remaining image-delivery changes from PR #70 without changing its original branch or `C:\i23`. Baseline: `aff7125f4eaf3243234818e1f31cf33f4a0d2dce`; original PR head: `5a667358642d88de6394a3c55f793bd5fe74ee9e`. The graph at inspection contained 130 commits on main absent from the PR and eight commits unique to the PR. GitHub reported the original PR non-mergeable. Issue #23 remains open; reconstruction does not establish delivery or infrastructure acceptance.

## Preserved and reconstructed changes

| Original change | Current treatment |
| --- | --- |
| `2ba801e` category versioning and gallery sizes | Port category byte delivery/version checks. Preserve main's newer gallery and inside-book sizes/layouts. |
| `6e5161e` public R2 image versioning | Port the narrow published/active/public cover-or-gallery lookup and versioned product paths. Preserve current content repository additions. |
| `644a1d9` version-aware optimization | Port media/category detection and fallback components. Only a single valid version parameter permits optimization; legacy/download/ambiguous queries stay direct. |
| `3aae097`, `a37591b` assertions | Adapt relevant metadata/route expectations to the current source. |
| `71eeb8b` local optimizer allowlist | Already superseded by current main. Preserve its explicit exclusion of community media and test the real Next allowlist matcher. |
| `9379e92`, `5a66735` byte streaming and fetch hardening | Port image streaming, HTTPS requirement, no redirects, combined caller cancellation and 10-second timeout. Add focused helper regressions. |

The current gallery retains four-thumbnail layouts, creator links and hearts, reader-artwork integration, and the newer lightbox/swipe behavior. No gallery component or Next configuration is replaced. Community byte delivery remains private and `no-store`, and cannot enter Next Image's optimizer. Premium/download authorization and storage publication/revocation workflows are preserved. Only published public R2 cover/gallery URLs move to the versioned streaming path; other mapped asset types retain their existing delivery mapping.

Version validation rejects stale category image IDs and mismatched product asset versions. Legacy URLs retain redirects. Versioned image responses expose image bytes instead of signed-provider URLs; they replace upstream cache headers with `public,max-age=60,s-maxage=60`. This does not prove an exact post-delete cache-expiry bound: browsers and the optimizer can retain earlier responses, and actual edge behavior must be measured.

## Required validation

- Focused Vitest: changed route tests; `content-repository`, `public-navigation-products`, `public-product-detail`, `media-upload`, category/fallback components, helper and optimizer-boundary tests.
- Focused ESLint and `git diff --check`.
- Typecheck/build and authoritative exact-SHA CI: backend integration and image delivery changed.
- `tests/e2e/issue-23-gallery-quality.spec.ts`: read-only local synthetic optimizer, community exclusion, desktop DPR1/DPR2 and Pixel 7. This tests the application/optimizer with fixture bytes; it does not prove hosted R2 quality or lifecycle behavior.
- Existing local media replacement/category lifecycle E2E plus private community media regression.
- Independent current-SHA review.

At implementation handoff, only the whitespace check has run. Other checks are **NOT RUN**, awaiting the coordinator's serialized validation window. Preflight reported `node_modules_missing`; this worker did not install dependencies or start a build/server.

## Infrastructure acceptance still required

Use dedicated owned fixtures and an isolated Supabase/R2 runtime for upload, display, responsive sizes, replacement, refresh, deletion, fallback, publication/revocation races and cleanup. Verify category delivery for both R2 and Supabase providers, upstream HTTPS responses without redirects, and cache behavior after deletion/unpublish at the exact candidate SHA. Record source/optimized bytes and dimensions, DPR1/DPR2, CDN response headers and repeated post-delete responses.

Required access: an isolated backend with fixture provisioning/cleanup; dedicated private/public R2 buckets and scoped data-plane credentials; HTTPS media origin; read access to that target's CDN/cache configuration; an exact-SHA application runtime. Availability of encrypted Production variables alone is not evidence that those isolated resources exist. Production user accounts, media, premium codes and bucket objects must not serve as destructive fixtures.

No Production purge, Cloudflare rule change, migration, merge, deployment, feature enablement or original-PR closure is part of this reconstruction. Both Coloring Club flags remain OFF. Independent local work can be reviewed while the real infrastructure acceptance remains explicitly blocked.
