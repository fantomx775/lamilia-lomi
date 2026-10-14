# Public Production navigation follow-up

This runner measures only anonymous, read-only page navigation on `https://www.lamilialomi.com`. It covers Home → Catalog, Catalog → Product Detail, Product Detail → Catalog through the header, guest Header → Library, and guest Header → Login on Chromium desktop and Pixel 7 emulation. It never submits login forms, opens Admin, or performs a write.

Issue #16 also asks for signed-in Header → Account and authenticated Admin navigation. This isolated Playwright run has no authorized saved auth state, so those controlled cold/warm timings remain unmeasured. A separately verified real Admin session is open in the parent’s visible browser and may support read-only interaction screenshots; that does not provide the trusted timing markers or independent fresh contexts used here. No session cookie is exported. The local demo adapter also cannot provide a Production-mode runtime because the app configuration guard rejects `LAMILIA_BACKEND=local` under `NODE_ENV=production`, and local Supabase is unavailable while the Docker API returns internal errors. A guest `/admin` denial cannot stand in for Admin navigation.

The fresh pre-run Production identity is source SHA `571c487037ed79d740f02c16439b5058675385b2`, Vercel deployment `dpl_BqPBrvEnNqBTjCk2Ab2U3XwXRJnk` (READY, Production target; alias `www.lamilialomi.com`), GitHub deployment `7059889271` (success), and public origin `https://www.lamilialomi.com`. The runner enforces the exact public origin and verifies its checkout SHA against the supplied expected SHA. It records the two deployment IDs supplied after external verification; it does not verify the alias-to-deployment mapping itself. Record a fresh Git/Vercel identity check immediately after the run because the alias may move over time.

The completed run below used that identity. External Vercel checks before (13:07:18 UTC) and after (13:16:40 UTC) the run both resolved `www.lamilialomi.com` to the same READY Production deployment and source SHA. The Production health request returned HTTP 200. See [raw measurements and screenshots](runs/navigation-production-public-2026-10-14T13-13-58-521Z/measurements.json).

## Observed Production results

Each cell is the median milliseconds for three accepted cold/warm pairs. “First UI” is the first sampled visible UI marker; “content” is the expected destination H1. Cold uses a fresh client context, while warm reuses the context after browser Back. The 10 route/device groups and 30 total pairs all completed with no rejected attempts or run error.

| Device | Transition | Cold first UI | Cold content | Warm first UI | Warm content |
| --- | --- | ---: | ---: | ---: | ---: |
| Desktop | Home → Catalog | 578.1 | 584.0 | 29.1 | 563.6 |
| Desktop | Catalog → Product Detail | 261.8 | 611.0 | 261.0 | 578.2 |
| Desktop | Product Detail → Catalog (header) | 587.8 | 620.1 | 29.3 | 548.7 |
| Desktop | Header → Library (guest) | 327.0 | 327.0 | 29.7 | 330.1 |
| Desktop | Header → Login (guest) | 376.4 | 376.4 | 228.5 | 228.5 |
| Pixel 7 | Home → Catalog | 365.2 | 554.6 | 32.7 | 637.1 |
| Pixel 7 | Catalog → Product Detail | 642.3 | 642.3 | 32.4 | 421.6 |
| Pixel 7 | Product Detail → Catalog (header) | 630.4 | 630.4 | 32.2 | 554.3 |
| Pixel 7 | Header → Library (guest) | 251.0 | 251.0 | 32.6 | 333.5 |
| Pixel 7 | Header → Login (guest) | 364.9 | 364.9 | 233.0 | 233.0 |

The sampler did not observe a pressed-state transform on any sample (`pressedFeedbackMedianMs` is null throughout). That does not establish that no visual pressed state exists; it means this animation-frame probe did not capture one. Header → Library/Login had no newly visible loader, so their first UI marker was the destination H1, at 251–376 ms cold across devices. These measurements therefore do not demonstrate the requested approximately 100 ms feedback target or rule out a silent interval above 150 ms. Some other routes did expose loading UI earlier than destination content.

This was a read-only anonymous Production observation, with Link prefetch enabled, no network throttling, and no server/cache reset. The health request showed `x-vercel-cache: MISS`; this single request does not characterize every page request. The report contains 145 `net::ERR_ABORTED` request failures observed over BrowserContext lifetime/teardown, with no console errors, page errors, or same-origin HTTP errors. The aborts are not attributed to individual transitions. These samples are not a code-only comparison or an SLA.

## Qualitative authenticated Admin check

An existing authenticated Admin session was checked separately in the visible browser using read-only navigation. Dashboard, Products, Collections, Categories, Tags, Users, Pages, and Settings (heading “Konfiguracja”) reached their expected headings at desktop 1440 × 900 and mobile 412 × 839 (16 checks total). The checks manifest and desktop/mobile Admin dashboard screenshots are included in [admin-ui](admin-ui/). This is qualitative destination evidence only: the visible-browser method did not provide trusted pointerdown timing or independent cold/warm contexts. No cookies were exported, no forms were submitted, and no writes were made. Authenticated Account and controlled cold/warm Account/Admin timings remain unmeasured.

## Method and limits

- Playwright Chromium headless; 1440 × 900 desktop and Pixel 7 emulation at 412 × 839 CSS pixels, DPR 2.625, touch enabled. No CPU or network throttling. Next Link prefetch stays enabled.
- Cold means a new isolated BrowserContext with a fresh client cache and the source route loaded before activation. The runner does not clear Production/server caches, and Link prefetch may populate the destination. Warm repeats the same navigation after browser Back in that context; any source reload fallback is recorded.
- The start marker is trusted pointerdown on the actual visible semantic link. The runner records the first viewport-visible UI marker (observed pressed transform, newly visible loading UI, or destination H1), each marker separately, and the first viewport-intersecting expected destination H1. It excludes screen-reader-only and pre-existing loading indicators. Timing a CSS state on animation frames is a browser observation, not a guaranteed paint timestamp.
- At least three accepted cold/warm pairs are required for each route and device. Raw samples, rejected attempts, diagnostics, and screenshots are saved beneath a timestamped run folder, even if a later group fails.
- These are sampled Production observations with no network or server-cache reset. They do not establish an arbitrary full-render SLA or isolate code-only latency.

## Run

After confirming the live Production alias still points to the expected deployment and SHA, run from the repository root:

```powershell
$env:LL_NAV_PROD_ORIGIN = 'https://www.lamilialomi.com'
$env:LL_NAV_VERCEL_DEPLOYMENT_ID = 'dpl_BqPBrvEnNqBTjCk2Ab2U3XwXRJnk'
$env:LL_NAV_GITHUB_DEPLOYMENT_ID = '7059889271'
$env:LL_NAV_EXPECT_SOURCE_SHA = '571c487037ed79d740f02c16439b5058675385b2'
$env:LL_NAV_OUTPUT = 'docs/verification/navigation-performance/2026-10-14/production-public/runs'
node docs/verification/navigation-performance/2026-10-14/production-public/measure-navigation-production-public.mjs
```

The runner verifies `git rev-parse HEAD`, saves browser/runtime/memory metadata, and never handles credentials. `LL_NAV_SAMPLES` can raise repetitions from the default 3 through 10.

## Remaining Issue #16 scope

This report adds repeatable public Production evidence for five guest/storefront transitions on desktop and mobile, plus separate qualitative Admin destination checks. It cannot complete Issue #16: signed-in Header → Account and controlled cold/warm authenticated Admin timings are not measured, and the sampled Header → Library/Login first-visible feedback exceeds the requested approximately 100 ms target. The acceptance criteria also request no silent interval beyond 150 ms; report observed markers without turning those targets into a full-render SLA. Keep Issue #16 open until the remaining criteria have evidence.
