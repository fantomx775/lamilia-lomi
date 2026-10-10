# Issue #24: Image UX verification

## Browser evidence

The complete local Playwright capture run `issue24-local-chromium-mobile-20261010-full-8of8` passed 8/8 tests with one worker. It ran the category image lifecycle and deferred-cleanup warning, storefront gallery preview, and admin image-order flows in both Chromium desktop (1280×720) and Pixel 7 mobile emulation (412×839).

The screenshots in this directory come from that run:

- `chromium/` and `mobile/`: category upload preview, storefront category rendering, admin product thumbnails, and deferred-cleanup warning.
- `product-gallery/chromium/` and `product-gallery/mobile/`: catalog cover, product detail cover, and full-size gallery preview.
- `product-image-order/chromium/` and `product-image-order/mobile/`: gallery upload, reorder, save, reload, and edit states.

Visual review confirmed square category images and portrait product covers keep their proportions, the gallery preview contains the full image, storefront and admin thumbnails load, and the product list remains usable on mobile. The warning is readable on both viewports and includes the category ID needed for follow-up. Some captures show the local Next.js development badge.

The order test reported that arrows at the first and last positions are disabled and therefore cannot receive a center hit; enabled-arrow checks passed, and saved order was confirmed after reload. The browser also logged expected navigation cancellations during admin login and product creation; persistence assertions passed. No page errors or broken image loads were found. The local development server emitted the known hydration warning involving `caret-color` on the category search input, which the existing Issue #30 browser diagnostics classify as known noise.

## Checks

- Focused Vitest: 9 files, 85 tests passed, including image-ratio and dimension validation, category persistence and cleanup, R2-compatible storage behavior, admin UI, and deletion-warning coverage.
- TypeScript check, changed-file lint, production build, and `git diff --check` passed.
- Local Playwright: 8/8 passed across desktop and mobile.
- Local Supabase validation applied the foundation and `20261010184114_category_image_media.sql` migrations to an isolated local project, then confirmed all six nullable category media columns and three constraints. No hosted database or production R2 assets/configuration were touched.
- R2 category upload behavior was verified through the existing pipeline with mocked SDK tests; no live R2 account or assets were used.
- Applying the complete pre-existing local migration chain is blocked by `20260815120000_supabase_production_foundation.sql`, which attempts to alter `storage.objects` and fails with SQLSTATE `42501` (not owner).

The production migration remains intentionally unapplied for the deployment phase and must precede deployment of code that reads the new columns.