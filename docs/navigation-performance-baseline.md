# Navigation and performance epic

Captured 2026-09-15 for the navigation/performance work tracked by issues #16–#21. The implementation is in PR #22. The base is `main` at `fef1d30511c69665ca73a953ad2c9acada3ddc20`; the code candidate is `5578573388819840ad30e043c0ac14ebbbd1205a`. The candidate Preview is `https://lamilia-lomi-hb4a3xz9a-fantomxs-projects.vercel.app` (`dpl_2RxNNQRettMb9mC64aqm7pRJxoQH`), verified READY for this branch and SHA. PR #22 remains open and unmerged. No Production resources were changed.

## Method and limits

Baseline and candidate timings were collected through the Codex in-app browser against production-like Vercel Previews at a 1440 × 900 desktop viewport. Each is a single approximate observation: click response, URL change, and time until the destination heading became accessible. Prefetch and warm/cold cache state were not controlled, so these numbers are not percentiles or a reliable estimate of full-render speedup. A separate mobile browser view was 390 × 844; tablet layout was checked at 768 × 1024. Local Playwright covered the interaction and responsive states, including a deterministic 1.2-second product-data delay to expose pending UI.

The UX target is visible click/tap acknowledgement within 100 ms, no silent interval over 150 ms, and a destination-shaped fallback while server work remains. A single browser session cannot prove this budget for every device or route. The Preview had no authenticated admin session, so its `/admin` result is guest no-access; authenticated Admin navigation was checked against the local demo backend instead.

## Baseline observations

| Transition | Click returned | URL changed | Destination heading |
| --- | ---: | ---: | ---: |
| Home → Catalog | 39 ms | 695 ms | 709 ms |
| Catalog → Home | 42 ms | 781 ms | 794 ms |
| Catalog → Product Detail (first visit) | 79 ms | 809 ms | 828 ms |
| Catalog → Product Detail (repeat) | 42 ms | 1,089 ms | 1,108 ms |
| Product Detail → Catalog | 41 ms | 854 ms | 867 ms |
| Header → Library | 43 ms | 377 ms | 392 ms |
| Header → Login | 39 ms | 466 ms | 478 ms |

After clicking Catalog → Product Detail, the catalog was still visible about 294 ms later with no pressed state, pending hint, or destination skeleton. The primary issue was the silent wait while the route and server work completed.

## Findings in the baseline request path

- Product Detail and its metadata both called the general public content snapshot. React request caching meant they shared one broad snapshot for that request; this was not 22 separate table reads. In Supabase mode the snapshot still queried 11 public content tables in parallel, including the entire product/catalog data, taxonomy, assets, Amazon links, and static pages. Public premium-code reads were already excluded.
- Product Detail waited for the product and complete session together. The Supabase session path called `auth.getUser()`, read the profile, and read all of that user's product unlocks before deciding the state for one product. The shared header also awaited the full session, coupling personalization to the page shell and allowing repeated uncached session work.
- Product cards and main navigation links had hover styling but no immediate pressed state or route-pending hint. Catalog, Product Detail, account/auth, and Admin lacked scoped route loading fallbacks.

## Candidate behavior

- Product Detail metadata and page content now share a request-cached, product-specific public query. In Supabase mode it selects a published product by slug with only the translation, categories/tags, active assets, and Amazon-link fields required by the page; it does not fetch the full catalog, static pages, or premium codes. Local demo mode continues to use its local content snapshot.
- Public Product Detail renders without waiting for unlock personalization. Unlock status streams separately; a verified signed-in user checks only the current product. Downloads remain server-authorized. The header resolves its account link separately, and request-cached auth/profile reads avoid redundant session work. Admin access remains server-side and fail-closed.
- Product cards show focus/pressed feedback and a delayed, screen-reader-announced pending indicator. Responsive header navigation exposes Catalog and Library on mobile. Catalog, Product Detail, account/auth, Admin, and localized Home routes have scoped loading UI; the Home route group keeps the fallback from changing unrelated localized routes such as QR pages. First visible product images load eagerly while below-the-fold images remain lazy. Motion respects reduced-motion preferences.
- A production-guarded test-only delay makes the Product Detail loading state reproducible in local browser tests.

## Candidate browser observations

The Preview's paired one-sample destination-heading observations were:

| Transition | Baseline Preview | Candidate Preview |
| --- | ---: | ---: |
| Home → Catalog | 709 ms | 799 ms |
| Catalog → Product Detail (first visit) | 828 ms | 662 ms |
| Product Detail → Catalog | 867 ms | 1,311 ms |
| Header → Library | 392 ms | 421 ms |
| Header → Login | 478 ms | 540 ms |

On the candidate, the Product Detail route skeleton was visible 87 ms after the first desktop click; on a repeat Catalog → Product Detail click, the card's pending state was visible at the 74 ms probe. The mobile Product Detail skeleton was visible at the 143 ms probe, with the destination URL changing at 158 ms. The mobile header exposed both Catalog and Library without horizontal overflow; tapping Library changed the URL in about 101 ms. These are sampled observations, not proof that every navigation meets the 100 ms budget. The full-render measurements vary in both directions and do not establish a stable speedup or regression.

Authenticated Preview Admin navigation could not be measured because no Preview admin session was available. Local demo Admin navigation reached Products, Categories, Tags, Users, Pages, and Settings in one sample each (186–273 ms); the active route was reflected in `aria-current`. Those local figures are interaction checks, not hosted performance claims.

The earlier candidate's unknown localized product slug rendered the localized “Product not found” page with `noindex,nofollow`; a Preview request log recorded the 404. The browser console had no errors or warnings during the checked candidate routes. Vercel Preview logs contained 12 media 503 events on the same two fixture assets seen in the baseline observation window; they were pre-existing Preview fixture behavior and were not changed. A guest `/admin` request returned the fail-closed access page; no authenticated Preview Admin flow was available.

## PR #22 follow-up (2026-09-19)

The Proxy no longer performs a product existence query. Catalog and Product Detail now use separate route groups, so `/[locale]/products/loading.tsx` cannot become the fallback for `/[locale]/products/[slug]`; the Product Detail route owns its destination-shaped skeleton. A deterministic local delayed-read Playwright check confirms that the Product Detail skeleton is visible while the Catalog skeleton is absent.

Next.js 16 streams the Product Detail loading boundary before the page-level `notFound()` can complete. Without restoring a database lookup in Proxy, an unknown direct Product Detail request therefore remains a framework-native soft 404 (`200`) with localized not-found UI and `noindex,nofollow` metadata. This is the documented route-layer limitation; no Proxy database workaround was reintroduced.

The follow-up also adds focused coverage for guest, unverified, locked, unlocked, product-scoped, and database-error entitlement states. No new Preview or Production deployment was performed for this follow-up. The timing samples above remain single uncontrolled observations and do not establish the repeatable cold/warm desktop/mobile benchmark needed to claim that issues #16/#21 are fully satisfied.

## Validation

- `git diff --check`, focused ESLint, `npm run lint`, `npm run typecheck`, `npm test` (46 files, 219 tests), and `npm run build` passed for the code candidate. After the full pass, the Admin E2E received a test-only timing attachment; focused ESLint and that Admin test passed twice on the final test code.
- The full local Playwright suite passed 49 tests with 3 skips before the test-only timing attachment. Coverage included desktop navigation, route pending UI, mobile/tablet layout, keyboard activation, localized unknown-product behavior, account/unlock/download flows, and local demo Admin paths. The final Admin-navigation test also recorded client navigation timing and active-route state for all six resource pages.
- Playwright used the local demo backend. The Vercel Preview was separately verified READY at the exact code-candidate SHA, with Product Detail, Catalog, mobile navigation, unknown-product handling, and guest `/admin` checked in a real browser. Preview request logs were checked for the expected unknown-product 404 and existing media responses.
- No Production deploy or merge was performed. The implementation is available for review in [PR #22](https://github.com/fantomx775/lamilia-lomi/pull/22); the six epic issues already exist as #16–#21.
