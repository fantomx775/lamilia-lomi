# Issue #24 image UX verification

## Browser evidence

The latest local Playwright run (`issue24-local-chromium-mobile-20261010-deferred-cleanup`) passed 6/6 tests on the Issue #24 source candidate. Chromium desktop used 1280×720; Pixel 7 mobile emulation used 412×839. The run covered category upload, replacement, storefront display, removal, the deferred-cleanup warning, admin product thumbnails, and gallery ordering through upload, save, reload, and edit.

Latest-run screenshots:

- `chromium/category-admin-uploaded.png`
- `chromium/category-storefront.png`
- `chromium/admin-product-thumbnails.png`
- `chromium/category-cleanup-warning.png`
- `mobile/category-admin-uploaded.png`
- `mobile/category-storefront.png`
- `mobile/admin-product-thumbnails.png`
- `mobile/category-cleanup-warning.png`

The product gallery and image-order screenshot sets remain from the earlier `issue24-local-chromium-mobile-20261010-review-fix` capture. Their flows were rechecked in the latest run; those surfaces were not changed by the deferred-cleanup fix.

Visual review confirmed portrait and square images retain their proportions, category previews fit their square frame, gallery images remain contained, and desktop/mobile product lists stay usable. The deferred-cleanup warning is readable at both sizes and includes the category ID needed for follow-up. Some captures show the local Next.js development badge.

## Checks

- Focused Vitest: 9 files, 85 tests passed, including image-ratio/dimension validation, category persistence and cleanup, R2-compatible storage behavior, admin UI, and deletion-warning coverage.
- TypeScript check, changed-file lint, production build, and `git diff --check` passed.
- Local Playwright: 6/6 passed across desktop and mobile.
- The browser run logged disabled gallery-order arrows at their expected bounds and an expected `net::ERR_ABORTED` request when product creation navigated to the new editor. Assertions confirmed saved product/image ordering. It also showed the known development hydration warning involving `caret-color` on the admin search input; the existing Issue #30 browser diagnostics classify that warning as known noise. No page errors or broken image loads were found.
- Local Supabase validation applied the foundation and `20261010184114_category_image_media.sql` migrations to an isolated local project, then confirmed all six nullable category media columns and three constraints. No hosted database or production R2 assets/configuration were touched.
- R2 category upload behavior was verified through the existing pipeline with mocked SDK tests; no live R2 account or assets were used.
- Applying the complete pre-existing local migration chain is blocked by `20260815120000_supabase_production_foundation.sql`, which attempts to alter `storage.objects` and fails with SQLSTATE `42501` (not owner). The targeted foundation plus Issue #24 migration passed.

The production migration remains intentionally unapplied for the deployment phase and must precede deployment of code that reads the new columns.
