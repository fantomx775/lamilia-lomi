# 2026-10-16 post-optimization Production navigation audit

## Result

The final paint-confirmed run was `navigation-production-public-2026-10-16T08-28-28-589Z`, completed at `2026-10-16T08:33:29.874Z`. The live Production application SHA was `3076389db0ca8abea8e536a46810c13fc400f74d`, Vercel deployment `dpl_3Uxmfp6v7nGuus8qaXXb3nxvRFeC`, and successful GitHub Production deployment `7101183636`. GitHub `main` and the deployment still referenced that SHA before and after the run. Health requests returned HTTP 200 with `x-vercel-cache: MISS`.

The benchmark runner SHA was `2a2fde1963c75688df3573c6ccb5dedabf6a435f`. Ten accepted cold/warm pairs were collected for five anonymous storefront journeys on Chromium desktop and Pixel 7: 100 pairs, 200 pointer activations. Four Enter-key checks passed. The run had one rejected attempt, 0 console errors, 0 page errors, and 0 same-origin HTTP status errors. No sign-ins, form submissions, or Production writes occurred.

## Method and limits

- Desktop: 1440 × 900, DPR 1. Pixel 7 emulation: 412 × 839, DPR 2.625.
- Cold means a fresh browser context and client cache, then the source route and activation. Server-side caches were not cleared; Next.js Link prefetch could warm destination data. Warm means the same context after the destination, browser Back to source, then another activation. No CPU or network throttling was applied.
- Timing starts at trusted `pointerdown`. Desktop mouse clicks hold for 50 ms before release to model a brief physical press; Pixel 7 uses a normal trusted tap.
- A candidate visual state counts only when the same element passes visibility checks in two consecutive `requestAnimationFrame` samples. Timing is recorded at the second sample, a conservative bound after a browser render opportunity rather than a direct compositor timestamp. Candidates are a changed `:active` style on the link/card, a new visible pending marker, or the destination H1.
- Press feedback is momentary and may disappear on release. The report therefore separates first feedback from pending UI; an immediate pressed style does not imply a persistent loading state.
- A pending marker is a new viewport-visible `[aria-busy="true"]`, `[role="status"]`, `[data-testid*="loading"]`, or `[data-pending="true"]` element with computed opacity ≥ 0.1. Screen-reader-only, clipped, pre-existing, and micro-opacity states do not count.
- Meaningful content is the expected destination H1. URL timing is secondary. p95 is the nearest-rank empirical value; with 10 observations it equals that group’s maximum, so treat it as a small-sample maximum.
- Complete per-activation evidence and browser diagnostics are in [the raw measurements](runs/navigation-production-public-2026-10-16T08-28-28-589Z/measurements.json).

The earlier run `navigation-production-public-2026-10-16T07-43-59-645Z` and the zero-hold run `navigation-production-public-2026-10-16T08-19-22-602Z` used pre-paint style reads or released the desktop mouse before a render opportunity. Their first-feedback summaries are superseded and are not used as visible-feedback claims; all figures below come from the final run above.

## First visible feedback and meaningful content

Each timing cell is median / empirical p95 in milliseconds. All groups contain 10 cold and 10 warm samples. The desktop press hold is part of the stated interaction model; timing still starts at pointerdown.

| Device | Transition | First feedback cold | First feedback warm | H1 content cold | H1 content warm |
| --- | --- | ---: | ---: | ---: | ---: |
| Desktop | Home → Catalog | 29.2 / 31.5 | 31.3 / 32.6 | 638.5 / 704.4 | 507.5 / 1450.2 |
| Desktop | Catalog → Product Detail | 28.8 / 35.7 | 30.6 / 31.7 | 728.0 / 751.3 | 663.5 / 714.3 |
| Desktop | Product Detail → Catalog (header) | 29.6 / 37.9 | 30.0 / 34.8 | 534.3 / 1151.3 | 574.5 / 1269.0 |
| Desktop | Header → Library (guest) | 29.0 / 35.0 | 31.5 / 33.0 | 396.5 / 1624.0 | 398.3 / 430.0 |
| Desktop | Header → Login (guest) | 28.1 / 30.4 | 31.6 / 33.2 | 397.1 / 680.6 | 414.5 / 431.1 |
| Pixel 7 | Home → Catalog | 31.7 / 48.4 | 49.7 / 50.6 | 472.6 / 631.8 | 490.4 / 564.8 |
| Pixel 7 | Catalog → Product Detail | 27.7 / 30.9 | 49.3 / 50.5 | 693.5 / 834.8 | 414.5 / 1081.7 |
| Pixel 7 | Product Detail → Catalog (header) | 30.4 / 34.8 | 30.6 / 34.1 | 554.4 / 630.6 | 505.3 / 595.7 |
| Pixel 7 | Header → Library (guest) | 31.8 / 32.8 | 32.4 / 33.4 | 331.4 / 580.4 | 348.8 / 350.0 |
| Pixel 7 | Header → Login (guest) | 31.5 / 32.9 | 31.8 / 32.9 | 399.4 / 448.7 | 348.5 / 364.8 |

First visible feedback was confirmed within 100 ms in 100/100 cold and 100/100 warm activations, and within 150 ms in both sets. A pressed style was confirmed in 99/100 cold and 80/100 warm activations. Because that style can vanish on release, the separate pending measurements below are necessary to assess continuing progress feedback.

## Pending UI and URL

Pending columns show the count with a confirmed marker out of 10, then median / empirical p95 in milliseconds. URL cells are median / empirical p95.

| Device | Transition | Pending cold | Pending warm | URL cold | URL warm |
| --- | --- | ---: | ---: | ---: | ---: |
| Desktop | Home → Catalog | 3/10, 229.0 / 247.5 | 10/10, 98.5 / 114.4 | 162.6 / 394.9 | 82.5 / 98.0 |
| Desktop | Catalog → Product Detail | 10/10, 153.3 / 162.8 | 10/10, 147.9 / 164.7 | 387.9 / 423.1 | 318.4 / 332.2 |
| Desktop | Product Detail → Catalog (header) | 3/10, 226.7 / 228.1 | 10/10, 97.4 / 115.0 | 150.6 / 812.3 | 84.3 / 97.6 |
| Desktop | Header → Library (guest) | 7/10, 224.0 / 230.6 | 10/10, 100.9 / 115.9 | 236.1 / 858.0 | 81.8 / 97.6 |
| Desktop | Header → Login (guest) | 9/10, 228.0 / 230.1 | 10/10, 99.2 / 116.8 | 312.4 / 397.2 | 82.6 / 97.9 |
| Pixel 7 | Home → Catalog | 5/10, 163.9 / 165.2 | 10/10, 49.7 / 50.6 | 163.9 / 379.7 | 32.4 / 33.6 |
| Pixel 7 | Catalog → Product Detail | 10/10, 93.5 / 99.0 | 10/10, 49.3 / 50.5 | 668.5 / 817.4 | 31.8 / 33.4 |
| Pixel 7 | Product Detail → Catalog (header) | 6/10, 163.6 / 181.1 | 10/10, 47.2 / 48.1 | 172.1 / 264.2 | 30.6 / 34.1 |
| Pixel 7 | Header → Library (guest) | 8/10, 165.0 / 166.0 | 10/10, 49.5 / 50.4 | 248.6 / 398.4 | 32.4 / 33.4 |
| Pixel 7 | Header → Login (guest) | 10/10, 164.4 / 165.8 | 10/10, 49.0 / 49.8 | 377.4 / 432.3 | 31.8 / 32.9 |

A pending marker was confirmed in 71/100 cold and 100/100 warm activations. Only 21/100 cold and 96/100 warm activations showed a confirmed pending marker within 150 ms. This means immediate first feedback passes under the stated press model, while persistent pending feedback still misses the target on many cold navigations. In 29 cold activations no qualifying pending marker appeared before the H1. Cold pending medians ranged from 93.5 to 229.0 ms; warm medians ranged from 47.2 to 147.9 ms.

A historical direct replay captured the Catalog page around 154 ms after activation with the destination URL changed but without H1 text or a visible pending marker. Its screenshot and metadata remain under [diagnostics](diagnostics/); they are qualitative evidence from the earlier zero-hold method, not part of the final sample statistics.

## Diagnostics and coverage limits

- Console errors: 0. Page errors: 0. Same-origin HTTP status errors: 0.
- Playwright aggregated 1,159 `net::ERR_ABORTED` request cancellations. The runner retains only the error code, not request URLs, so these cannot be attributed to a particular transition or asset. They are not HTTP status failures.
- One attempt (Pixel 7 Header → Login, attempt 8) was rejected because it lacked a trusted pointerdown, destination URL, or confirmed content marker; all groups still collected their 10 accepted pairs.
- Header → signed-in Account and authenticated Admin navigation were not timed. No authorized authenticated Playwright state or credentials were available; no login was attempted. Guest Library/Login measurements do not substitute for signed-in Account/Admin.
- The Production run tests the deployed SHA above. The local Catalog fallback fix is not deployed and has no Production runtime evidence.

## Local regression fix

The Product Catalog page now places its asynchronous catalog read under a page-local `Suspense` boundary using the same destination-shaped skeleton as route `loading.tsx`. A bounded test delay is enabled only for the local demo backend. The focused desktop/Pixel 7 regression test verifies that the fallback appears before the catalog H1 and disappears after the H1 becomes visible. It is local visibility coverage only; local `next dev` timing is diagnostic and does not assert the Production 150 ms budget. See [the Issue #16 evidence folder](../../../issue-16/README.md).

## Issue status

Issue #16 remains open because signed-in Account and authenticated Admin cold/warm timing is missing. The Production first-feedback sample meets 100 ms under the measured press/tap model, but cold pending feedback is not consistently visible within 150 ms. The local route fallback fix awaits review and has not been merged or deployed.

Keep Issue #21 separate and open. This audit does not cover its tablet-width measurements, mobile Product Detail pending/final screenshot set, exact candidate-SHA Preview (or equivalent) verification, or full before/after regression matrix for metadata, not-found/localization, and anonymous/locked/unlocked states.
