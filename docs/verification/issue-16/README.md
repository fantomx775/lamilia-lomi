# Issue #16 local catalog fallback proof

- Tested source SHA: `2a2fde1963c75688df3573c6ccb5dedabf6a435f`
- Run ID: `issue-16-catalog-fallback-2026-10-16T08-37-20-2a2fde1`
- Flow: Home → Catalog while the local catalog data request is delayed
- Command: `node .\node_modules\playwright\cli.js test tests/e2e/navigation-feedback.spec.ts --grep 'Catalog fallback remains visible while local catalog data is held' --workers=2 --reporter=json`
- Controlled delay: 5,000 ms, enabled only with `LAMILIA_BACKEND=local` and a localhost Playwright base URL

The Chromium project uses a 1440×900 viewport. The mobile project uses the Pixel 7 profile at 412×839 (DPR 2.625). The test confirms that `/en/products` is active, the catalog fallback is visibly rendered at opacity ≥0.1 before the catalog H1 appears, and the fallback is hidden after the H1 becomes visible.

The test asserts no page errors, console errors, or same-origin HTTP error responses. In this run, the desktop browser canceled one same-origin destination RSC request (`/en/products?_rsc=…`) during client navigation; the destination URL and H1 completed and there was no HTTP status error. The mobile run recorded no failed requests. The local timing attachment measured 2,799 ms on desktop and 2,733 ms on Pixel 7, including local `next dev` startup/compilation effects; it is a visibility diagnostic, not a Production 150 ms SLA. The final exact-head browser validation record is attached to the PR.

| State | Desktop Chromium | Pixel 7 |
| --- | --- | --- |
| Fallback visible while catalog data is pending | [catalog-pending-desktop.png](catalog-pending-desktop.png) | [catalog-pending-pixel7.png](catalog-pending-pixel7.png) |
| Catalog content after loading | [catalog-final-desktop.png](catalog-final-desktop.png) | [catalog-final-pixel7.png](catalog-final-pixel7.png) |

This is local UI evidence for the fallback regression test. The separate Production navigation measurements and their limitations are documented in [the navigation performance baseline](../../navigation-performance-baseline.md).
