# Catalog polish verification

The Catalog now uses a neutral book icon for missing or failed category images, while valid images and the legacy category proxy keep their existing delivery behavior. Product cards preserve the 8.5:11 uncropped cover, reserve three actual text lines for the title, and expose the complete title with a native keyboard/touch disclosure. Long unbroken words wrap within the card.

## Local targeted checks

- PASS: changed-file ESLint and `git diff --check`.
- PASS: `node node_modules/vitest/vitest.mjs run src/components/category-tile-image.test.tsx src/components/product-card.test.tsx` — 4 tests.
- PASS: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3103 node node_modules/@playwright/test/cli.js test tests/e2e/issue-62-catalog-polish.spec.ts --workers=1` — Chromium 1440x900 and Pixel 7, 2 scenarios.

The browser flow uses a disposable local snapshot, restores the original snapshot in `finally`, and never writes Production. It checks a valid category image, an intentionally absent versioned image, no image, short and long/unbroken product names, all desktop settings (3/4/5), tablet two-column layout, mobile one-column layout, image decoding, 8.5:11 cover geometry, equal title regions, keyboard/touch disclosure, and no horizontal overflow. The early desktop overflow regression was reproduced, fixed, and retested.

## Browser evidence

Screenshots are in `browser/`. The desktop 3/4/5-column captures, tablet capture, Pixel 7 grid, and expanded-title captures were visually inspected. Category fixtures reuse an existing local seed illustration; no category artwork was generated or uploaded to Production. Covers retain their original rendering and source assets.

The diagnostics record the deliberate category-image HTTP 404 and its browser resource error. These are the tested fault-injection scenario, not unexpected failures. No unexpected HTTP failure, failed request, or page exception remained. Exact final-SHA rerun, screenshot provenance, independent review, and CI are recorded on the PR.

CI owns the broad lint/typecheck/unit-test/Production-build gate. There is no migration, dependency change, deployment, or Production configuration change.
