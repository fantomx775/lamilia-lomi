# 2026-10-15/16 post-optimization Production navigation audit

## Result

This is a read-only anonymous browser audit of the live Production storefront after PRs #57–#64. Run `navigation-production-public-2026-10-16T07-43-59-645Z` completed at `2026-10-16T07:49:15.787Z`. The exact deployed source was `3076389db0ca8abea8e536a46810c13fc400f74d` on Vercel deployment `dpl_3Uxmfp6v7nGuus8qaXXb3nxvRFeC`; GitHub Production deployment `7101183636` references that SHA and reports `success`. The benchmark's health request to `https://www.lamilialomi.com/en` returned HTTP 200 with `x-vercel-cache: MISS`.

The run accepted 10 cold/warm pairs for each of five journeys on Chromium desktop and Pixel 7: 100 pairs and 200 pointer activations. Four Enter-key checks passed across desktop and Pixel 7. No database writes, sign-ins, form submissions, or other mutations were performed.

## Method and limits

- Desktop: 1440 × 900, DPR 1. Pixel 7 emulation: 412 × 839, DPR 2.625.
- Cold means a fresh browser context and client cache, then the source route and click. Server-side caches were not cleared; Next.js Link prefetch could warm destination data. Warm means the same context after destination, browser Back to source, then another click. No CPU or network throttling was applied.
- Timing starts at trusted `pointerdown` on the visible semantic link. First feedback is the earliest changed `:active` style, a new viewport-visible pending marker with computed opacity at least 0.1, or the destination H1. The press-style value records momentary pointer feedback and does not claim a persistent indicator after release.
- Pending UI is the first new visible `[aria-busy="true"]`, `[role="status"]`, `[data-testid*="loading"]`, or `[data-pending="true"]` marker. The 0.1 opacity threshold excludes CSS micro-opacity during the delayed fade-in.
- Meaningful content is the expected destination H1. URL change is reported separately as a secondary navigation signal. p95 is the nearest-rank empirical value; at 10 observations it equals that group's maximum, so treat it as a small-sample maximum rather than a stable population tail estimate.
- The complete raw dataset and browser diagnostics are in [measurements.json](runs/navigation-production-public-2026-10-16T07-43-59-645Z/measurements.json). A direct Production replay captured about 154 ms after activation is retained in [the diagnostic screenshot](diagnostics/desktop-home-catalog-150ms.png) with its [run metadata](diagnostics/desktop-home-catalog-150ms.json). The probe used the same Production SHA and Vercel deployment.

## Click feedback and meaningful content

Each cell is median / empirical p95 in milliseconds. All groups contain 10 accepted cold and 10 accepted warm samples.

| Device | Transition | First feedback cold | First feedback warm | H1 content cold | H1 content warm |
| --- | --- | ---: | ---: | ---: | ---: |
| Desktop | Home → Catalog | 0.9 / 1.7 | 0.3 / 0.6 | 649.4 / 867.0 | 564.4 / 786.4 |
| Desktop | Catalog → Product Detail | 0.9 / 1.9 | 0.3 / 0.4 | 682.4 / 878.9 | 600.4 / 779.0 |
| Desktop | Product Detail → Catalog (header) | 0.8 / 1.5 | 0.4 / 0.8 | 649.0 / 1344.9 | 554.4 / 1448.5 |
| Desktop | Header → Library (guest) | 0.9 / 1.4 | 0.3 / 0.3 | 334.0 / 602.3 | 328.7 / 343.1 |
| Desktop | Header → Login (guest) | 1.4 / 2.1 | 0.3 / 0.6 | 372.8 / 503.2 | 327.8 / 331.7 |
| Pixel 7 | Home → Catalog | 14.2 / 606.6 | 16.0 / 17.2 | 656.8 / 1201.4 | 401.3 / 535.9 |
| Pixel 7 | Catalog → Product Detail | 11.2 / 20.8 | 15.3 / 16.9 | 676.2 / 798.0 | 409.8 / 589.4 |
| Pixel 7 | Product Detail → Catalog (header) | 13.0 / 15.3 | 13.9 / 15.9 | 493.7 / 604.2 | 509.8 / 597.1 |
| Pixel 7 | Header → Library (guest) | 15.3 / 18.5 | 15.3 / 17.1 | 406.0 / 547.7 | 340.9 / 433.2 |
| Pixel 7 | Header → Login (guest) | 14.1 / 15.4 | 15.1 / 16.9 | 394.9 / 915.3 | 333.5 / 750.3 |

First feedback was within 100 ms in 99/100 cold activations and 100/100 warm activations; it was within 150 ms in 99/100 cold and 100/100 warm activations. The single cold outlier was Pixel 7 Home → Catalog at 606.6 ms: the active-style probe did not detect a changed pressed style before then, and the visible pending marker was recorded at 650.9 ms. This is one sample, not a repeated confirmed regression.

## Pending UI and URL

The pending columns show visible-marker sample count out of 10, then median / empirical p95 milliseconds. Missing samples did not expose a qualifying pending marker before the next recorded route event/content.

| Device | Transition | Pending cold | Pending warm |
| --- | --- | ---: | ---: |
| Desktop | Home → Catalog | 7/10, 141.3 / 143.6 | 10/10, 28.4 / 29.1 |
| Desktop | Catalog → Product Detail | 10/10, 75.4 / 92.6 | 10/10, 93.2 / 95.8 |
| Desktop | Product Detail → Catalog (header) | 9/10, 147.9 / 160.4 | 10/10, 26.1 / 34.1 |
| Desktop | Header → Library (guest) | 9/10, 144.3 / 156.2 | 10/10, 27.6 / 29.3 |
| Desktop | Header → Login (guest) | 9/10, 139.7 / 157.2 | 10/10, 13.0 / 28.6 |
| Pixel 7 | Home → Catalog | 9/10, 148.0 / 650.9 | 10/10, 32.8 / 33.6 |
| Pixel 7 | Catalog → Product Detail | 10/10, 77.3 / 91.7 | 10/10, 32.9 / 84.1 |
| Pixel 7 | Product Detail → Catalog (header) | 7/10, 145.5 / 164.6 | 10/10, 30.6 / 32.5 |
| Pixel 7 | Header → Library (guest) | 10/10, 147.9 / 149.1 | 10/10, 23.8 / 33.1 |
| Pixel 7 | Header → Login (guest) | 10/10, 147.9 / 149.1 | 10/10, 15.7 / 32.4 |

There were 90/100 cold and 100/100 warm qualifying pending markers. Some cold p95s exceed 150 ms, and ten cold samples had no qualifying marker. URL-change medians ranged 187.8–665.3 ms cold and 26.2–270.8 ms warm; their empirical p95s ranged 245.7–915.1 ms cold and 29.2–462.2 ms warm. URL timing is not treated as first visible feedback or as a full-render SLA.

The direct 154 ms Production replay of Home → Catalog had updated the URL to `/en/products`, but the main content contained no H1 or text and had no visible pending marker or `[aria-busy="true"]` state. Only the shared shell was visible; the destination H1 appeared around 800 ms in that replay. The screenshot is linked above. This is the repeated cold-navigation gap addressed by the local review candidate.

## Diagnostics and coverage limits

- Browser console errors: 0. Page errors: 0. Same-origin HTTP status errors: 0.
- Playwright aggregated 1,027 `net::ERR_ABORTED` request cancellations. The runner records the error code but not the request URLs, so these cannot be attributed to particular assets or transitions. They are not HTTP status failures; the aggregate is retained as an instrumentation limitation.
- One attempt (Pixel 7 Header → Library, attempt 10) was rejected because the runner lacked a trusted pointerdown, destination URL, or visible-content marker; 10 accepted pairs were still collected for that group.
- Header → Account and authenticated Admin navigation were not timed. No authorized authenticated Playwright storage state or credentials were available in this worktree; no login was attempted. Guest Library/Login measurements do not substitute for signed-in Account/Admin.
- The Production run tests the deployed SHA above. The local Catalog fallback fix is not deployed and has no Production runtime evidence yet.

## Local regression fix

The Product Catalog page now places its asynchronous catalog read under a page-local `Suspense` boundary using the same destination-shaped skeleton as the route `loading.tsx`. A local-only, bounded catalog delay makes the pending state repeatable in Playwright; the delay is disabled in production and outside the local backend. The focused test asserts the destination URL, visible fallback opacity, absence of the final H1 while pending, and final H1 after completion. Desktop Chromium and Pixel 7 both passed. Local pending/final screenshots and tested-SHA metadata are in [the Issue #16 evidence folder](../../../issue-16/README.md) once that evidence bundle is finalized.

## Issue status

Issue #16 remains open because signed-in Account and authenticated Admin cold/warm timing is still missing. The UX budget is not fully demonstrated on Production: pressed feedback met 100 ms in 99/100 cold samples, while visible pending UI missed or exceeded 150 ms in some cold samples. The local route fallback fix awaits review and has not been merged or deployed.

Keep Issue #21 separate and open. This audit does not cover its tablet-width measurements, mobile Product Detail pending/final screenshot set, exact candidate-SHA Preview (or equivalent) verification, or complete before/after regression matrix for metadata, not-found/localization, and anonymous/locked/unlocked states.
