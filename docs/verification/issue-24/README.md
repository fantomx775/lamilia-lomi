# Issue #24: Image UX verification

## Browser evidence

The final local Playwright run on 2026-10-11 passed 8/8 tests with `--workers=1` across the three focused specs for category image UX, product gallery preview, and product image ordering. It covered Chromium desktop (1280×720) and Pixel 7 mobile emulation (412×839). The earlier wrapper attempt started with six workers and was interrupted; it is not counted as a pass. The stale login locale selector was corrected before the final run.

The reviewed screenshots in this directory come from the final run:

- `chromium/` and `mobile/`: category upload, storefront rendering, admin thumbnails, and deferred-cleanup warning.
- `product-gallery/chromium/` and `product-gallery/mobile/`: catalog cover, product detail cover, and full-size gallery preview.
- `product-image-order/chromium/` and `product-image-order/mobile/`: upload, reorder, save, reload, and edit states. Debug-only arrow-target diagnostic images are excluded.

Visual review confirmed category images and product covers retain their proportions, gallery preview shows the full image, and storefront and admin thumbnails load. The cleanup warning is readable on both viewports. The first and last order arrows are disabled at their respective ends and cannot receive a center hit; enabled-arrow checks and saved-order persistence after reload passed. Some captures show the local Next.js development badge. The known hydration warning involving `caret-color` on the category search input recurred; there were no page errors, unexpected failed requests, or broken image loads.

The follow-up now surfaces a failure-case cleanup warning in the taxonomy drawer when the category disappears and the new image cannot be removed. A focused component/API regression covers that error response and the displayed category/image IDs. Playwright was not rerun for this error state; the existing browser evidence still covers the unchanged upload, storefront, thumbnail, gallery-preview, and ordering flows.

## Server-side image validation

- Local multipart cover/gallery uploads are fully decoded with Sharp and checked against the accepted 1:1 or 8.5:11 ratios and minimum dimensions before storage. EXIF-oriented images use display dimensions from Sharp autoOrient metadata; an orientation-6 JPEG regression proves the displayed 8.5:11 cover ratio is accepted.
- Supabase signed/TUS uploads are validated at product save. The server uses the new asset's bound product/asset Storage path, checks Storage `info()` size and MIME against the submitted metadata and the 20 MiB cap before downloading, then checks the downloaded size and fully decodes the bytes before the product mutation RPC. It computes SHA-256 from that same validated byte buffer and passes it to R2 finalization. No arbitrary payload URL is fetched. Existing assets continue to use the existing database snapshot policy.
- R2 finalization checks size/MIME and reads staging bytes with an explicit range and bounded stream. The staging SHA-256 must match the validated Supabase mirror before copy, and the finalized private object is checked again before staging deletion. When staging is absent, retry verifies the existing private object's SHA-256 before allowing product save. Regressions cover same-size/MIME byte mismatch on staging and retry, matching bytes, over-limit objects, and overlong streamed responses.
- Regression coverage includes an invalid-ratio direct API upload, an invalid-ratio signed-upload bypass, rejection of an oversized Storage object before download, and the image decoder's pseudo-PNG/truncated-file cases.
- If a category disappears between image upload and metadata update, successful exact-object cleanup still returns not-found. If cleanup fails, the result and 404 API response include cleanupDeferred plus category/image IDs; the UI displays the operator warning. Cleanup for ambiguous database outcomes remains deferred under the existing policy.

## Checks

- Focused Vitest: 6 files, 84 tests passed, covering R2 byte parity/retries, product media finalization, Supabase content mutations, EXIF dimensions, category-image API responses, and the taxonomy drawer warning.
- Changed-file ESLint, `tsc --noEmit --pretty false`, and `git diff --check` passed.
- `npm run build` passed with `LAMILIA_BACKEND=local` and `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000`.
- Focused Playwright passed 8/8 in the earlier browser run described above; it was not rerun after this review follow-up, so the new failed-cleanup warning has component/API test evidence rather than a new browser screenshot.
- The exact migration `20261010184114_category_image_media.sql` was applied successfully to an isolated local Supabase database. Because an older foundation migration fails with SQLSTATE `42501` (`must be owner of table objects` while changing `storage.objects`), the target migration was checked against a minimal local `public.categories (id, slug)` fixture instead of claiming a full historical migration-chain pass. The CLI returned `ALTER TABLE`; a separate assertion block passed and confirmed all six nullable, typed media columns and all three CHECK constraints. Assertions accepted valid metadata and rejected an invalid provider, partial metadata, zero size, and SVG MIME; the fixture ended with zero rows.
- The category-image API and image decoder tests use generated fixtures/mocked storage. No live R2 account or assets were used.

The Production migration remains unapplied. Apply it before merging the code that reads the new columns. No hosted database or Production data was changed.
