# Navigation and performance baseline

Captured 2026-09-15 against the pre-change `origin/main` candidate (`fef1d30511c69665ca73a953ad2c9acada3ddc20`). The production-like Vercel Preview was `https://lamilia-lomi-kkzhvl86r-fantomxs-projects.vercel.app` (`dpl_DUESaWQRdkdCrap96W2gCQp5Baa6`). No Production resources were changed.

## Method and limits

The baseline combines source-path inspection with real browser interaction in the Codex in-app browser. Preview timings below are approximate click-to-accessible-destination observations from one desktop session (about 1265 × 716); they are single samples, not percentiles. A click returned to the controller before the route settled, so the destination was checked in a follow-up browser snapshot. The browser showed the previous page during that interval, with no pressed state, inline pending hint, or destination skeleton. A separate authenticated local `next dev` session was used only to inspect admin navigation and to reproduce cold/warm development behavior; its timings are not used as production performance conclusions.

The Preview had no available admin session. `/admin` therefore measured the guest no-access page, not an authenticated admin workflow. The Preview also contained pre-existing missing product images and non-production test products; those were left unchanged.

## Baseline samples

| Transition | Approx. click → destination content | Context |
| --- | ---: | --- |
| Home → Catalog | 0.73 s | Preview, desktop |
| Catalog → Product Detail | 0.55 s | Preview, desktop, navigation from catalog |
| Product Detail → Catalog | 0.66 s | Preview, desktop |
| Header → Library | 0.60 s | Preview, desktop, guest |
| Header → Login | 0.66 s | Preview, desktop, guest |
| Direct Product Detail | 0.93 s | Preview, desktop |
| Direct Account | 0.79 s | Preview, desktop |
| `/admin` → guest no-access | 0.66 s | Preview, desktop, unauthenticated |

The local development browser showed the old screen with Next's `Compiling` or `Rendering` badge at about 0.75–0.94 s after a click, with the destination visible at about 1.0–1.23 s. Repeated authenticated admin transitions showed the same stale-screen behavior at about 0.9–1.2 s. These local development observations identify the silent-wait UX but are not comparable with Preview timings.

## Findings from the existing request path

- Product Detail and its metadata both called the general public snapshot reader. In Supabase mode that reader selected `*` from products, translations, product-category/tag associations, assets, Amazon links, categories and translations, tags and translations, and static pages (11 table reads in parallel; public premium-code reads were already excluded).
- The product page waited for the product and full session together. The full session performed `auth.getUser()`, a profile read, and a read of every product unlock for the user before calculating the one product's state.
- The shared SiteHeader also awaited the full session before it rendered. That made account personalization part of the header's render path and allowed it to delay the localized page shell.
- ProductCard and main navigation links had hover styling but no pressed feedback or route pending hint. The app had no route `loading.tsx` boundaries for Catalog, Product Detail, localized account/auth routes, or Admin.

The UX budget for this epic is immediate visible click/tap acknowledgement (target ≤100 ms), no silent interval over 150 ms, and a destination-shaped fallback when server work remains. A full-render SLA is intentionally not set from these single samples; the same transitions will be remeasured after the change.

## Candidate changes

- Product Detail metadata and page content now share a request-cached, product-specific Supabase read. It selects the published product by slug with only the translation, category/tag, active asset, and Amazon-link fields used by the page; it does not read the full catalog, static pages, or premium codes. The existing RLS policies still govern which asset metadata an authenticated reader may see.
- The public product shell no longer waits for session or unlock reads. Its unlock section streams separately; only a verified account checks the unlock for that one product, and premium downloads remain server-authorized. The header resolves only the account link under its own Suspense boundary. Admin access remains a server-side, fail-closed check.
- Supabase `getUser()` and profile reads are deduplicated per request. Requests without an SSR auth cookie skip session refresh on ordinary page routes; API requests and cookie-backed routes still run the existing `updateSession` path.
- Direct HTML GETs for localized product URLs check the published slug and return a localized HTTP 404 with `noindex` for misses. RSC and prefetch requests avoid this extra check. The existing locale middleware and auth refresh behavior remain in place for applicable requests.
- Product cards provide focus/pressed feedback and a delayed, screen-reader-announced pending indicator. The header adds Catalog and Library links on mobile. Product, Catalog, account/auth, and Admin routes have scoped loading fallbacks; motion effects respect reduced-motion preferences.

## Candidate local verification

The candidate passed `npm run typecheck`, `npm run lint`, `npm test` (44 files, 214 tests), and `npm run build`. The full local Playwright suite passed 49 tests; its one skipped case is the desktop-only navigation timing sample under the mobile project. The suite covered direct localized 404/noindex behavior, desktop navigation, mobile and tablet layout, pending feedback, keyboard navigation, guest/authenticated unlock flows, downloads, and local demo-admin routes. A mobile locale test now waits for the URL-code handoff to finish before switching locales, preventing the test from racing the existing unlock-intent redirect.

These browser checks used the local demo backend. They establish route, interaction, and security-boundary behavior, not hosted response-time results. The repository rejects `next start` when configured with its local backend, so the local build was not used as a production-runtime timing proxy. Hosted before/after measurements and browser verification are recorded below once the candidate Preview is available.
