# Issue #24: Image UX verification

## Browser evidence

The final local Playwright run on 2026-10-11 passed 8/8 tests with `--workers=1` across the three focused specs for category image UX, product gallery preview, and product image ordering. It covered Chromium desktop (1280×720) and Pixel 7 mobile emulation (412×839). The earlier wrapper attempt started with six workers and was interrupted; it is not counted as a pass. The stale login locale selector was corrected before the final run.

The reviewed screenshots in this directory come from the final run:

- `chromium/` and `mobile/`: category upload, storefront rendering, admin thumbnails, and deferred-cleanup warning.
- `product-gallery/chromium/` and `product-gallery/mobile/`: catalog cover, product detail cover, and full-size gallery preview.
- `product-image-order/chromium/` and `product-image-order/mobile/`: upload, reorder, save, reload, and edit states. Debug-only arrow-target diagnostic images are excluded.

Visual review confirmed category images and product covers retain their proportions, gallery preview shows the full image, and storefront and admin thumbnails load. The cleanup warning is readable on both viewports. The first and last order arrows are disabled at their respective ends and cannot receive a center hit; enabled-arrow checks and saved-order persistence after reload passed. Some captures show the local Next.js development badge. The known hydration warning involving `caret-color` on the category search input recurred; there were no page errors, unexpected failed requests, or broken image loads.

## Checks

- Focused Vitest: 2 files, 6 tests passed (`image-file-dimensions` and the category-image API route).
- Changed-file ESLint passed; `tsc --noEmit --pretty false` passed.
- `npm run build` passed with `LAMILIA_BACKEND=local` and `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000`.
- Focused Playwright passed 8/8 as described above. `git diff --check` is run during final candidate preparation.
- The exact migration `20261010184114_category_image_media.sql` was applied successfully to an isolated local Supabase database. Because an older foundation migration fails with SQLSTATE `42501` (`must be owner of table objects` while changing `storage.objects`), the target migration was checked against a minimal local `public.categories (id, slug)` fixture instead of claiming a full historical migration-chain pass. The CLI returned `ALTER TABLE`; a separate assertion block passed and confirmed all six nullable, typed media columns and all three CHECK constraints. Assertions accepted valid metadata and rejected an invalid provider, partial metadata, zero size, and SVG MIME; the fixture ended with zero rows.
- The category-image API and image decoder tests use generated fixtures/mocked storage. No live R2 account or assets were used.

The Production migration remains unapplied. Apply it before merging the code that reads the new columns. No hosted database or Production data was changed.
