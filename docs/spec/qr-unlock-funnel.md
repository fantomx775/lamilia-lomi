# QR → Unlock → Library → Download funnel

## Scope

This document describes the integrated frontend/orchestration workstream on top of the merged Supabase foundation in `main`. This branch does not add Supabase schema, migrations, RLS, service-role logic, storage policy, or a second production persistence layer. Local mode remains a deterministic test harness; Supabase mode uses the existing request adapters and RPC/storage contracts.

## State machine

| State | Entry | Server-owned result / next transition |
| --- | --- | --- |
| `qr_entry` | `/[locale]/unlock/[slug]` | Validate published product context; an optional QR code is materialized by the server route handler into the HTTP-only intent cookie, then the browser is redirected to a clean product URL. Invalid slug is a controlled 404. |
| `product_context` | Product page `#premium` | Show product title/cover and owner-vs-prospect distinction. |
| `guest_auth` | Guest chooses log in or registration | Store short-lived HTTP-only unlock intent; return to the same locale/product. |
| `verification_required` | Authenticated session has no verified email | Show verification-required state; resume the stored product/code intent. |
| `code_entry` | Verified session with no unlock | Normalize and submit code; no code remains in the redirect URL. |
| `redeeming` | Server action receives code | Validate product, active code, current server session, and verification. |
| `unlocked` | Valid code or existing ownership | Idempotent positive state; clear intent and expose Library/download actions. |
| `library` | User opens Library | Read unlocked products through the current adapter contract. |
| `download_allowed` | Server authorizes asset ID | Stream the local harness asset or use the existing Supabase private Storage signed-URL contract. |
| `denied` | Invalid product/code, guest, locked, wrong asset, or unexpected error | Generic localized recovery state; never raw backend error or client-supplied ownership. |

## Trust boundaries

- URL: locale, product slug, and optional transient UI outcome. A QR code may carry an optional code only at the QR ingress boundary; the route handler validates the public product, stores prefill context in the short-lived HTTP-only intent cookie, and removes the code before the product page renders. `returnTo` is restricted to same-locale internal paths; absolute and protocol-relative URLs fall back to the locale Library.
- Form: code and display context are untrusted input. Code is trimmed/normalized and checked server-side against the selected product. It is not logged, sent to analytics, or copied into post-submit URLs.
- Session: identity, email verification, role, and current unlocks come from the server session. The client cannot choose `userId`, `isVerified`, `unlocked`, or an asset path as authorization.
- Product/asset adapter: product and asset relationships are loaded server-side. Download authorization checks the asset's server-known `productId` against the server session's unlocks.
- Unlock intent: a short-lived HTTP-only cookie carries product/locale/return context and optional code prefill across auth/verification. It is not an ownership record and is never sufficient to authorize redemption or download.

## Backend contract requests

The Supabase foundation must provide these contracts before final merge:

1. `getCurrentAuthUser()` / `getCurrentAuthState()` — server-derived user identity and authoritative email verification state.
2. `redeemPremiumCode({ productId, normalizedCode })` — authenticated, verified, product-bound, atomic redemption with a unique `(user_id, product_id)` outcome and domain results `unlocked | already_unlocked | invalid | inactive | wrong_product | unexpected`.
3. `listUnlockedProducts()` — RLS-safe current-user Library query with product/asset relationships.
4. `authorizePremiumDownload({ assetId })` — server-side asset-to-product and ownership check, followed by a short-lived private Storage signed URL or stream; client asset paths are never authorization.
5. Auth verification callback/resume contract — email confirmation returns to an allowlisted same-locale internal target and preserves the unlock intent without putting the code in the URL.

## Integration order

`Supabase foundation (merged in main) → integrate the funnel → rerun the complete local matrix → verify Preview/Supabase configuration separately → final review → merge`.

## Evidence map

The complete 42-row automated/browser matrix is maintained in `docs/verification/qr-unlock-funnel-matrix.md` and is exercised by `tests/e2e/unlock-funnel.spec.ts` plus the focused unit/integration tests. Live Supabase/Preview verification is a separate gate and is not implied by local-mode results.
