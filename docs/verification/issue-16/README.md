# Issue #16 local catalog fallback proof

- Tested source SHA: `ae7a249890dc1db826791f85be652639301a6fcc`
- Run ID: `issue-16-catalog-fallback-ae7a249`
- Flow: Home → Catalog while the local catalog data request is delayed
- Command: `node .\node_modules\playwright\cli.js test tests/e2e/navigation-feedback.spec.ts --grep 'Catalog shows its destination fallback' --workers=2`
- Controlled delay: 5,000 ms, enabled only with `LAMILIA_BACKEND=local` and a localhost Playwright base URL

The Chromium project uses a 1440×900 viewport. The mobile project uses the Pixel 7 profile at 412×839 (DPR 2.625). The test confirms that `/en/products` is active, the catalog fallback is visibly rendered at opacity ≥0.1 before the catalog H1 appears, and the fallback is hidden after the H1 becomes visible.

The test asserts no page errors, console errors, or same-origin HTTP error responses. It permits only a canceled same-origin destination RSC request (`/en/products?_rsc=…`) when the destination URL and H1 complete; every other failed request fails the test. The final exact-head browser validation record is attached to the PR.

| State | Desktop Chromium | Pixel 7 |
| --- | --- | --- |
| Fallback visible while catalog data is pending | [catalog-pending-desktop.png](catalog-pending-desktop.png) | [catalog-pending-pixel7.png](catalog-pending-pixel7.png) |
| Catalog content after loading | [catalog-final-desktop.png](catalog-final-desktop.png) | [catalog-final-pixel7.png](catalog-final-pixel7.png) |

This is local UI evidence for the fallback regression test. The separate Production navigation measurements and their limitations are documented in [the navigation performance baseline](../../navigation-performance-baseline.md).
