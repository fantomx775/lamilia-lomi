# Navigation performance comparison — 2026-10-13/14

This run compares the three requested storefront transitions before and after PR #55's public Home and Catalog query changes. It contains five accepted cold/warm pairs for every route and device, raw samples, browser diagnostics, and six screenshots per environment.

## Compared environments

| Side | Environment | Source SHA | Deployment |
|---|---|---|---|
| Before | Production, `https://www.lamilialomi.com` | `35358462fd0ba58d0dbb603b7e0659ee2f60c35f` | `7051238176` |
| After | Protected Preview, `https://lamilia-lomi-3y8p1ttr3-fantomxs-projects.vercel.app` | `30cac2578cdaf392f80e259f05ef933ad8bbe2d4` | `dpl_Cgc9uTXzWSvfN4gNv3dwzznEN82u` |

The two runs used the same product route, `/en/products/https-www-amazon-com-dp-b0h8tttsny`, and the Production and Preview catalogs exposed the same six product links at measurement time. The baseline run ID is `navigation-baseline-2026-10-13T22-12-38-127Z`; the Preview run ID is `navigation-after-30cac25-2026-10-13T23-20-47-612Z`.

## Method

- Playwright 1.60.0 with headless Chromium; desktop viewport 1440 × 900 and Pixel 7 emulation at 412 × 839 CSS pixels, DPR 2.625, touch enabled.
- No CPU or network throttling. Next Link prefetch remained enabled.
- Cold navigation started in a fresh isolated BrowserContext. The warm navigation followed the cold destination, browser Back to the source in the same context, then a second trusted activation. The Preview run used browser Back for all 30 warm samples; the baseline recorded a same-context source-reload fallback in four warm samples.
- Timing starts at trusted pointerdown on the semantic destination link. The report records click-to-URL and click-to-first-visible expected H1. Each route/device/state has five accepted samples that passed the destination URL and visible-H1 assertions.
- These are observed Production-versus-Preview medians, not a controlled network A/B test or a full-render SLA. Network/cache conditions can vary between runs; the results do not prove the code alone caused every difference.
- The protected Preview was opened through Vercel CLI's documented automation flow. The short-lived browser cookie was held only in process memory/environment; no bypass value is present in the evidence files. [`measure-navigation-preview.mjs`](preview/measure-navigation-preview.mjs) is the runner used for the Preview samples and expects `LL_NAV_PREVIEW_ORIGIN`, `LL_NAV_OUTPUT`, and the temporary `LL_NAV_COOKIE_NAME` and `LL_NAV_COOKIE_VALUE` environment variables.

See Vercel's [CLI curl documentation](https://vercel.com/docs/cli/curl) and [automation bypass documentation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation) for the supported protected-Preview access flow.

## Click to first visible destination H1

Each cell shows **Production baseline → Preview candidate** in milliseconds. Percentages are arithmetic changes in the observed median; negative values mean the Preview median was lower in this run.

| Device | Transition | Cold median | Warm median |
|---|---|---:|---:|
| Desktop | Home → Catalog | 4269.9 → 2080.2 (−51.3%) | 2519.1 → 847.7 (−66.3%) |
| Desktop | Catalog → Product Detail | 2340.0 → 1625.4 (−30.5%) | 2529.3 → 1245.2 (−50.8%) |
| Desktop | Product Detail → Catalog | 4448.7 → 1688.8 (−62.0%) | 3768.4 → 1021.9 (−72.9%) |
| Pixel 7 emulation | Home → Catalog | 2254.0 → 1539.5 (−31.7%) | 2904.1 → 844.8 (−70.9%) |
| Pixel 7 emulation | Catalog → Product Detail | 7877.8 → 2107.0 (−73.3%) | 16403.9 → 2017.9 (−87.7%) |
| Pixel 7 emulation | Product Detail → Catalog | 3639.0 → 2062.4 (−43.3%) | 3265.9 → 846.0 (−74.1%) |

All six Preview medians were lower than their Production baselines. Treat this as a sampled comparison, not a guaranteed or isolated causal gain. The repeated Product Detail route and all raw timing samples are in [`production/measurements.json`](production/measurements.json) and [`preview/measurements.json`](preview/measurements.json).

## Diagnostics

| Diagnostic | Production baseline | Preview candidate |
|---|---:|---:|
| Uncaught page errors | 0 | 0 |
| Console errors | 0 | 100 captured (diagnostic sample capped at 100) |
| Same-origin HTTP errors | 0 | 200 captured (diagnostic sample capped at 200) |
| Failed requests | 485 `net::ERR_ABORTED` requests observed | 750 `net::ERR_ABORTED` requests observed |

The harness records failed requests through BrowserContext teardown and does not attribute each `net::ERR_ABORTED` to a route transition versus context teardown. The Preview console and HTTP errors were recurring `503` responses from `/api/media/{id}` fixture endpoints; the captured errors covered 11 distinct media paths. No client page errors occurred. These media failures affect screenshot imagery and should be considered when interpreting the Preview comparison. They are separate from the navigation destination assertions, which passed for all included samples.

## Screenshots

| Device | Page | Production baseline | Preview candidate |
|---|---|---|---|
| Desktop | Home | [home](production/screenshots/desktop-home.png) | [home](preview/screenshots/desktop-home.png) |
| Desktop | Catalog | [catalog](production/screenshots/desktop-catalog.png) | [catalog](preview/screenshots/desktop-catalog.png) |
| Desktop | Product Detail | [product detail](production/screenshots/desktop-product-detail.png) | [product detail](preview/screenshots/desktop-product-detail.png) |
| Pixel 7 | Home | [home](production/screenshots/mobile-pixel-7-home.png) | [home](preview/screenshots/pixel7-home.png) |
| Pixel 7 | Catalog | [catalog](production/screenshots/mobile-pixel-7-catalog.png) | [catalog](preview/screenshots/pixel7-catalog.png) |
| Pixel 7 | Product Detail | [product detail](production/screenshots/mobile-pixel-7-product-detail.png) | [product detail](preview/screenshots/pixel7-product-detail.png) |

## Scope remaining for Issue #16

This run covers Home → Catalog, Catalog → Product Detail, and Product Detail → Catalog only. Header → Library, Header → Account/Login, and main Admin navigation still need cold/warm desktop and mobile measurements, so Issue #16 remains open. PR #22 already delivered the immediate ProductCard feedback, Product Detail loading boundary, and targeted Product Detail read path; this comparison does not claim to complete every Issue #16 route.
