# Issue #23 media lifecycle and browser evidence

Evidence captured 2026-10-15 against the local demo backend on `127.0.0.1:3102`. All lifecycle writes used synthetic local records and files; the browser tests did not write to Production. Browser projects were Playwright Desktop Chrome at 1440×900 and Pixel 7 at its configured device viewport. The gallery test uses original public fixture bytes served from local files and the real local Next image optimizer; the cover and category tests use synthetic files.

## Targeted results

- `npm test -- src/lib/media-storage.test.ts src/lib/media-upload.test.ts 'src/app/api/media/[assetId]/route.test.ts' src/app/api/admin/assets/route.test.ts` — passed, 4 files / 62 tests. This covers mocked R2 storage lifecycle/fallback behavior and the media route's private-asset protections; it does not contact an R2 bucket or Supabase service.
- `npx playwright test tests/e2e/issue-23-media-lifecycle.spec.ts --project=chromium --project=mobile --workers=1` — passed, 2/2. Each run saved an initial synthetic product cover, replaced it, saved and reloaded, then verified one active reference to the replacement, absence of the old asset row, and deletion of the old local file. The test deletes its synthetic product afterward.
- `npx playwright test tests/e2e/issue-24-image-ux.spec.ts tests/e2e/issue-60-pdp.spec.ts --project=chromium --project=mobile --workers=1` — 6 passed / 2 failed. Category upload/replacement/storefront rendering/removal and deferred-cleanup warning passed on both projects (4); product gallery/lightbox passed on both projects (2). The two failures were the separate Issue 60 route-skeleton test: `product-detail-loading` did not appear because this local server was not started with `LAMILIA_TEST_PRODUCT_DETAIL_DELAY_MS`. That unchanged skeleton scenario is outside this media-only change; it was not retried.
- `npx eslint tests/e2e/issue-23-media-lifecycle.spec.ts` and `git diff --check` — passed.

The lifecycle E2E asserted zero unresolved console errors, page errors, failed requests, or failed HTTP responses. It classifies the local demo uploader's initial HTTP 415 response as expected because the multipart fallback then succeeds. Gallery diagnostics report no console/page/HTTP errors; canceled `video.mp4` range/buffer requests are browser `ERR_ABORTED` events while the test separately verifies video playback. The mobile gallery also records a canceled in-flight image optimizer request during navigation. No unresolved browser failures remained in the passing scenarios.

## Screenshots

The screenshots are local synthetic/browser-fixture evidence, not screenshots of the Production runtime.

| Flow | Desktop Chrome | Pixel 7 |
| --- | --- | --- |
| Saved cover replacement (editor state before save) | [cover replacement](lifecycle/chromium/cover-replacement-before-save.png) | [cover replacement](lifecycle/mobile/cover-replacement-before-save.png) |
| Category admin and storefront | [uploaded](category/chromium/category-admin-uploaded.png), [storefront](category/chromium/category-storefront.png), [cleanup warning](category/chromium/category-cleanup-warning.png) | [uploaded](category/mobile/category-admin-uploaded.png), [storefront](category/mobile/category-storefront.png), [cleanup warning](category/mobile/category-cleanup-warning.png) |
| Product gallery and lightbox | [gallery](gallery/gallery-chromium.png), [lightbox](gallery/lightbox-chromium.png) | [gallery](gallery/gallery-mobile.png), [lightbox](gallery/lightbox-mobile.png) |

The existing [read-only Production image audit](production-image-audit-2026-10-14.md) records public source dimensions, cache headers, and the lack of a representative live category assignment.

## Public Production quality, 2026-10-15

The reproducible `node docs/verification/issue-23/probe-public-quality.mjs` probe performs public reads only. It checks the current Catalog cover, Product Detail cover, gallery thumbnail and expanded lightbox on Chromium 1440x900 at DPR 1 and DPR 2, plus Pixel 7. All three contexts passed image decoding and no-horizontal-overflow checks, with no console/page errors or failed HTTP responses. Aborted navigation/prefetch requests are classified in `public-quality/diagnostics.json`, separately from HTTP/media failures.

The parent visually inspected the sampled covers, gallery thumbnails and expanded lightbox. The artwork and text are sharp at their actual rendered sizes, including desktop high DPI; there was no observed avoidable pixelation requiring processing changes or upscaling. Original media were preserved. The screenshots and measured source/rendered dimensions are in `public-quality/`; these are live Production observations, not candidate-SHA runtime claims. This does not establish a post-delete cache bound, and there was no configured representative Production category image to inspect. Synthetic local category rendering is proven separately above.

## Integration boundary

No verified Lamilia test R2 bucket, endpoint, or credentials are available. The app's configured R2 environment is Production-only; a separate Cloudflare token was denied access to the app's account/buckets, and unrelated buckets belong to a different project. No upload, overwrite, or deletion was attempted against Production. The Docker daemon was unavailable and host memory was constrained, so no local Supabase instance was started. Consequently, the browser lifecycle proof uses the local demo filesystem backend, and R2 behavior is covered only by mocked storage tests; real Supabase and R2 object write/delete lifecycle remains unverified.
