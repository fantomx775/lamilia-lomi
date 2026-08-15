# LamiliaLomi public UX/UI audit — 2026-08

**Verdict:** AUDIT READY
**Audit date:** 2026-08-15
**Baseline:** `origin/main` = `93df7575b133b165dece9e9d2dd691a822aef265`
**Branch/worktree:** `codex/public-ux-audit` / `C:\lamilia-lomi-public-ux`
**Runtime:** local Next.js app at `http://localhost:3000`
**Browser QA:** Codex in-app browser at 390×844, 768×900, and 1440×900

This is an evidence-based public UX audit only. No production application code, schema, migrations, auth implementation, storage, admin, or backend files were changed.

## A. Executive summary

The public surface is a coherent seeded product experience with working localized routing, product pages, Amazon destinations, demo auth, QR context, premium unlock, Library re-entry, and protected-download decisions. The strongest foundation is the product-to-Amazon page and the end-to-end demo QR flow: the tested journey reached login, verification, unlock, Library, and the download endpoint.

The largest risk is mobile continuation. At a 390 px viewport the shared header creates horizontal overflow (`scrollWidth=440` against a 375 px client width), hides Catalog/Library navigation, and the unlocked product state does not expose a Library link. A reader can complete unlock but cannot continue the intended journey through visible UI on a phone. The QR query reaches auth, but after verification the visible premium-code input is empty, forcing re-entry.

Localization is structurally present for EN/PL/DE/ES, but public copy is not consistently localized. PL product content is mixed with English CTAs and footer text; DE/ES product content falls back to English; the shared header/footer hard-code English for DE/ES; legal pages and author content contain explicit placeholders. This lowers trust and makes the four-locale promise less credible.

The five highest-value opportunities are:

1. Restore a compact mobile navigation and add a direct post-unlock `View Library` action.
2. Preserve QR code and redirect context through locale switching, login, verification, and unlock without requiring re-entry.
3. Finish the public localization contract, including shared shell, auth/premium states, product translations, legal content, sitemap, and metadata alternates.
4. Make the home/product CTA hierarchy explicitly separate “buy on Amazon” from “I own the book / unlock bonuses”.
5. Fix catalog control naming, reset-password behavior, and empty/error feedback so the critical public surfaces are usable with keyboard and assistive technology.

## B. Route inventory and coverage matrix

The repo contains 13 public page route patterns: root plus 12 locale-scoped page patterns. Product detail has three published slugs. Query filters are states of the catalog route, not separate route files.

Status meanings: `AUDITED` means the route rendered and its relevant behavior was inspected; `UNTESTABLE` means the exact action was intentionally not completed and the reason/evidence is recorded; `NOT APPLICABLE` means the surface is outside public UX screen scope.

| Public surface | Actual coverage | Status | Evidence / notes |
|---|---|---|---|
| `/` | Root redirect | `AUDITED` | HTTP 307 → `/en`. |
| `/:locale` | `en`, `pl`, `de`, `es` | `AUDITED` | Rendered in browser; home tested at all three viewports. |
| `/:locale/products` | `en`, `pl`, `de`, `es`; `audience`, `type`, `category`, `tag`, `sort`, search-empty states | `AUDITED` | Filtered product sets and empty state inspected. |
| `/:locale/products/:slug` | Published slugs: `moon-garden-coloring-book`, `mindful-mandalas-for-adults`, `bedtime-forest-picture-book`, across all locales | `AUDITED` | Product, Amazon, QR, premium, invalid-slug 404, and locale paths inspected. Draft product is correctly not public. |
| `/:locale/login` | `en`, `pl`, `de`, `es`; QR redirect context | `AUDITED` | EN login completed with unverified demo user; locale routing smoke passed. |
| `/:locale/register` | Valid QR context across locale model; bare route guard | `AUDITED` | Valid form rendered; bare `/en/register` redirects 307 → `/en/products`. |
| `/:locale/reset-password` | `en`, `pl`, `de`, `es` route model | `AUDITED` | Screen rendered; inert submit is recorded as UX-007. |
| `/:locale/library` | Guest and unlocked states; all locale paths | `AUDITED` | Guest state observed before login; unlocked product observed after QR journey. |
| `/:locale/account` | Guest and authenticated states; all locale paths | `AUDITED` | Authenticated dashboard observed; guest branch verified in code and route smoke. |
| `/:locale/contact` | `en`, `pl`, `de`, `es` route model | `AUDITED` | Screen and labeled fields inspected. POST side effect is separately untestable. |
| `/:locale/author` | `en`, `pl`, `de`, `es` | `AUDITED` | Rendered route; placeholder content recorded as UX-009. |
| `/:locale/privacy` | `en`, `pl`, `de`, `es` | `AUDITED` | All localized records rendered; placeholder/fallback content recorded as UX-009. |
| `/:locale/terms` | `en`, `pl`, `de`, `es` | `AUDITED` | All localized records rendered; placeholder/fallback content recorded as UX-009. |
| Next 404 fallback | Invalid product `/en/products/does-not-exist` | `AUDITED` | Browser showed `404 / This page could not be found.` |
| `/robots.txt` | Generated metadata route | `AUDITED` | HTTP 200; locale coverage limitation recorded as UX-010. |
| `/sitemap.xml` | Generated metadata route | `AUDITED` | HTTP 200; only EN/PL URLs are generated, recorded as UX-010. |
| `/favicon.ico` | Static public asset | `AUDITED` | HTTP 200. |
| `/api/analytics/amazon-click` | Client analytics POST endpoint | `NOT APPLICABLE` | Supporting event transport, not a UX screen; POST mutation was not separately replayed. |
| `/api/contact` | Contact POST endpoint | `UNTESTABLE` | Form rendered, but submit was not sent because configured Resend could transmit a message; `src/app/api/contact/route.ts:7-39` is source evidence. |
| `/api/downloads/:assetId` | Premium download GET endpoint | `UNTESTABLE` | Click reached the endpoint and server logged HTTP 307 to the signed/static target; the browser did not emit a download event, so final file delivery is not claimed. |
| `/api/cron/review-reminders` | Operational cron endpoint | `NOT APPLICABLE` | Not a public UX surface; it is authorization-gated when `CRON_SECRET` is configured. |
| `/admin/**` | Protected admin route family | `NOT APPLICABLE` | Explicitly excluded by the audit contract. |

Coverage total: **22 public-surface rows accounted for; 17 AUDITED, 2 UNTESTABLE, 3 NOT APPLICABLE.** All **13/13 public UI route patterns** are audited. The two untestable rows have concrete reasons and evidence above.

## C. Browser QA evidence

### Viewport matrix

| Surface | 390×844 | 768×900 | 1440×900 |
|---|---|---|---|
| Home | Rendered; horizontal overflow observed | Rendered; no overflow | Rendered; no overflow |
| Catalog | Rendered; filters, cards, empty state; horizontal overflow observed | Rendered; no overflow | Rendered; no overflow |
| Product / QR entry | Rendered; guest login/create-account state; horizontal overflow | Rendered; Amazon/premium/Library links visible | Rendered; Amazon/premium/Library links visible |
| Login | Rendered; labels and redirect context visible; horizontal overflow observed | Rendered | Rendered |
| Register | Rendered; required/optional consent controls visible; horizontal overflow observed | Rendered | Rendered |
| Library | Rendered; guest/unlocked states covered; horizontal overflow observed | Rendered | Rendered |

Saved high-priority screenshots:

- [Home at 390 px](evidence/home-en-390.png) — visible horizontal scrollbar and clipped locale controls.
- [Catalog at 390 px](evidence/catalog-en-390.png).
- [Product at 390 px](evidence/product-moon-en-390.png).
- [Home at 768 px](evidence/home-en-768.png).
- [Home at 1440 px](evidence/home-en-1440.png).

### Locale coverage

Routing smoke passed for EN/PL/DE/ES on home, catalog, product, auth, Library, account, contact, author, privacy, and terms route models. The product path remained localized when switching EN → PL, but the QR query was dropped:

```text
before switch link: /pl/products/moon-garden-coloring-book
after click URL:    /pl/products/moon-garden-coloring-book
expected context:   ?code=LOMI-BOOK-2026 preserved
```

EN/PL/DE/ES are therefore routed, but not equivalently localized. The concrete gaps are findings UX-004 and UX-005.

### Accessibility and state checks

- Heading hierarchy and landmarks were present on the main public screens.
- Login, register, reset-password, and contact text fields have explicit visible labels.
- Catalog search had no accessible name; the five standalone selects had no associated labels. Browser DOM evidence showed unnamed `textbox`/`combobox` controls.
- At 390 px the authenticated header Account link becomes icon-only with no accessible name because its text is hidden below `sm` (`src/components/site-header.tsx:55-61`).
- A browser keyboard traversal attempt left `document.activeElement` on `BODY` after eight Tab attempts; this is recorded as **keyboard traversal inconclusive/untestable in this browser surface**, not as a pass.
- The invalid product route rendered the default Next 404 page.
- Search no-result rendered an explicit empty state with reset link.
- Reset-password click left the URL and page state unchanged; source shows `type="button"` with no action.

## D. Business-critical journey audit

### Journey 1 — acquisition → product → Amazon

| Step | Status | Evidence / friction |
|---|---|---|
| Home entry | `AUDITED` | Home renders a clear brand statement and `Browse catalog` / `Try QR unlock` CTAs. |
| Catalog discovery | `AUDITED` | Three published products, audience cards, search, filters, sorting, and empty state work. Filter controls are not named for assistive technology. |
| Product detail | `AUDITED` | Product title, description, cover, gallery, video placeholder, Amazon link, and premium anchor render at all required widths. |
| Amazon handoff | `AUDITED` | `View on Amazon` points to the real Amazon URL and opens a new tab; local analytics handler is wired. The click was not replayed as a separate analytics POST. |
| Main friction | `P1` | Home gives no direct Amazon action and spends a public feature card on “Owner control”; product page presents Amazon and premium as equal visual actions without clarifying “buy” vs “already own”. See UX-006. |

### Journey 2 — physical book/QR → auth → verification → unlock → Library → download

| Step | Status | Evidence / friction |
|---|---|---|
| QR entry | `AUDITED` | Home `Try QR unlock` opened `/en/products/moon-garden-coloring-book?code=LOMI-BOOK-2026`. |
| Guest handoff to auth | `AUDITED` | Product showed `Log in` and `Create account` with encoded `redirectTo` and `code`. |
| Login | `AUDITED` | `unverified@lamilialomi.test` returned to the product with the same URL context. |
| Verification | `AUDITED` | Product showed an explicit verification-required state and demo verification action. |
| Unlock form | `AUDITED with friction` | After verification the URL still contained `code`, but the visible input property was empty; the code had to be entered again manually. See UX-004. |
| Unlock | `AUDITED` | Valid code redirected to `?unlocked=1`; product displayed “Premium content is unlocked” and a premium asset link. |
| Library | `AUDITED with mobile gap` | Direct Library route showed the unlocked product. At 390 px the unlocked product page had no visible Library link and mobile header navigation was hidden. See UX-001. |
| Download | `UNTESTABLE final delivery` | Click reached `/api/downloads/asset-moon-premium-pdf` and server logged 307; the browser did not emit a download event. Source authorization and the static demo PDF exist, but final file delivery is not claimed. |

## E. Findings

### UX-001 — P0 — Mobile QR journey has no visible Library re-entry

**Area:** QR/unlock/Library continuation
**Route / screen:** `/:locale/products/:slug` unlocked state → `/:locale/library`
**Viewport:** 390 px
**Problem:** After unlock, the product state only says the Library keeps the product available. At mobile widths the shared Catalog/Library nav is hidden at `md`, so the user has no visible action to continue to Library.
**Evidence:** Browser snapshot at 390 px showed `Premium content is unlocked`, `Your library keeps this product available for later downloads`, and no Library link. `src/components/site-header.tsx:43-52` hides the nav below `md`; `src/app/[locale]/products/[slug]/page.tsx:156-169` renders the unlocked asset without a Library CTA.
**User/business impact:** The post-purchase journey is broken at its highest-value continuation point for QR-first mobile readers. Unlock can succeed while the intended next step remains undiscoverable.
**Recommended change:** Add a primary `View Library` action to the unlocked state and a compact mobile navigation/menu that always exposes Library.
**Acceptance criteria:**

- At 390 px, unlocked product state exposes a visible, keyboard-focusable Library link.
- Mobile navigation exposes Catalog, Library, locale, and Account without horizontal overflow.
- The same CTA works in EN/PL/DE/ES and preserves locale.

**Dependency:** NONE
**Risk:** Low UI risk; verify against auth/session states.
**Suggested slice:** Slice A — Mobile navigation and post-unlock re-entry

### UX-002 — P1 — Shared mobile header overflows and clips controls

**Area:** Responsive navigation
**Route / screen:** Shared header on all public pages
**Viewport:** 390 px
**Problem:** The header’s logo, four locale links, and Account action exceed the viewport; Catalog/Library navigation is hidden instead of replaced by a compact mobile affordance.
**Evidence:** Browser metrics: viewport 390, client width 375, document `scrollWidth=440`; [home-en-390.png](evidence/home-en-390.png) shows the horizontal scrollbar and clipped `ES` control. The same overflow appeared on home, catalog, product, login, register, and Library.
**User/business impact:** Clipped controls and lateral scrolling reduce trust and make the mobile-first QR journey feel unfinished.
**Recommended change:** Redesign the header’s mobile layout with a compact locale control/menu and labeled Account action; constrain the header to the viewport.
**Acceptance criteria:**

- `scrollWidth === clientWidth` at 375–390 px on every public route family.
- All primary navigation actions remain reachable without horizontal scrolling.
- Account has an accessible name at mobile width.

**Dependency:** NONE
**Risk:** Medium shared-component regression risk.
**Suggested slice:** Slice A — Mobile navigation and post-unlock re-entry

### UX-003 — P1 — Locale switching drops the QR code query

**Area:** Localization and funnel context
**Route / screen:** Product QR URL → language switcher
**Viewport:** 768 px browser interaction; applies to all viewports
**Problem:** Switching locale preserves the product path but drops `?code=...`, so a reader loses the QR context while changing language.
**Evidence:** Browser interaction from `/en/products/moon-garden-coloring-book?code=LOMI-BOOK-2026` used the PL switcher link `/pl/products/moon-garden-coloring-book`; resulting URL was `/pl/products/moon-garden-coloring-book` with no query. `src/components/language-switcher.tsx:16-29` derives from `usePathname()` and never carries search parameters.
**User/business impact:** A language switch can silently remove the core unlock intent before auth.
**Recommended change:** Build locale links from pathname plus current search parameters, with an explicit allowlist for funnel context such as `code`, `redirectTo`, and verification state.
**Acceptance criteria:**

- QR code survives EN/PL/DE/ES switching on product, login, and register routes.
- Non-funnel tracking parameters are not copied blindly.
- Automated coverage asserts locale, pathname, and query preservation.

**Dependency:** FUNNEL
**Risk:** Medium; unsafe redirect/query propagation must be avoided.
**Suggested slice:** Slice B — QR context contract across locale and auth

### UX-004 — P1 — Verified QR flow does not prefill the visible unlock field

**Area:** QR/auth/unlock continuity
**Route / screen:** Product after verification
**Viewport:** 390 px; applies to all viewports
**Problem:** After verification, the URL retained `?code=LOMI-BOOK-2026`, but the visible `#premium-code` input property was empty. The user had to manually re-enter the code.
**Evidence:** Browser snapshot after verification showed the unlock textbox without a value; read-only DOM evaluation returned `value=""` while `location.search` still contained the code. `src/components/unlock-form.tsx:72-75, 101-106` passes `initialCode` but the post-auth/hydration state did not present it as entered.
**User/business impact:** Adds a re-entry step exactly where QR should reduce friction and risks abandonment if the code is not easily readable from the physical book.
**Recommended change:** Make the auth-return contract populate the controlled input value and visibly confirm the code context; preserve it through verification and failed unlock states.
**Acceptance criteria:**

- After login and verification, the input visibly contains the QR code and submits it without re-entry.
- Invalid/missing-code states preserve the entered value safely.
- Refresh and locale switch behavior is covered.

**Dependency:** FUNNEL
**Risk:** Medium; coordinate with auth redirect and server action semantics.
**Suggested slice:** Slice B — QR context contract across locale and auth

### UX-005 — P1 — EN/PL/DE/ES public copy is not consistently localized

**Area:** Localization/content hierarchy
**Route / screen:** Shared header/footer, product detail, auth/premium states, legal pages
**Viewport:** All
**Problem:** Routing supports four locales, but public copy mixes languages and falls back to EN. PL product pages still show English `View on Amazon`, `Premium materials`, and footer copy; DE/ES product title/description fall back to EN; shared shell labels are hard-coded for non-PL locales.
**Evidence:** Browser locale matrix showed PL product content in Polish but English CTAs/footer; DE and ES product pages showed the English Moon Garden title/description. `src/lib/products.ts:38-40` falls back to default EN translation; `src/components/site-header.tsx:20-25` and `src/components/site-footer.tsx:19-36` hard-code public labels; `messages/*.json` contains translations that the page components do not consistently use.
**User/business impact:** Visitors can interpret the product, but the experience does not meet the language promise and weakens conversion/trust in DE/ES and mixed PL screens.
**Recommended change:** Move all public shell, auth, premium, catalog, and state copy into locale messages; add complete product translations or explicitly constrain published locale coverage.
**Acceptance criteria:**

- No accidental English remains in PL/DE/ES critical public screens.
- Product title, description, CTA, premium, auth, empty, error, and legal strings have defined locale behavior.
- Long German/Spanish strings pass 390/768/1440 viewport checks.

**Dependency:** CONTENT
**Risk:** Medium content-volume and copy-review risk.
**Suggested slice:** Slice C — Localized public shell and funnel copy

### UX-006 — P1 — Acquisition hierarchy does not clearly separate buying from ownership

**Area:** Conversion hierarchy and trust
**Route / screen:** Home and product detail
**Viewport:** 390 px and 1440 px
**Problem:** The home hero uses `Browse catalog` and `Try QR unlock`, but has no direct Amazon bridge; the feature row spends a public card on “Owner control” and describes the admin area. Product detail gives `View on Amazon` and `Premium materials` equal visual weight without a clear “buy this book” vs “already own it” distinction.
**Evidence:** [home-en-1440.png](evidence/home-en-1440.png); `src/app/[locale]/page.tsx:40-50, 87-119`; `src/app/[locale]/products/[slug]/page.tsx:91-107`. The acquisition path still works, so this is not a blocker.
**User/business impact:** New visitors must infer the commercial next step, while returning owners are mixed into the same hierarchy; this can reduce Amazon click-through and trust.
**Recommended change:** Introduce explicit intent labels and hierarchy: `Buy on Amazon` as the acquisition CTA, `I own this book` / `Unlock bonuses` as the owner CTA, and replace admin-facing copy with reader reassurance.
**Acceptance criteria:**

- A first-time visitor can identify the Amazon action without opening the catalog.
- An owner can identify the QR/bonus path without confusing it with purchase.
- CTA hierarchy remains clear at 390 px and 1440 px.

**Dependency:** FUNNEL
**Risk:** Medium copy/analytics risk; preserve Amazon click measurement.
**Suggested slice:** Slice D — Acquisition and product CTA hierarchy

### UX-007 — P1 — Catalog controls are unnamed for assistive technology

**Area:** Accessibility and filtering
**Route / screen:** `/:locale/products` filter form
**Viewport:** All; observed at 390 px
**Problem:** Search relies on placeholder text and the five select controls have no associated labels or accessible names.
**Evidence:** Empty-catalog DOM snapshot exposed an unnamed `textbox` and unnamed `combobox` controls. `src/app/[locale]/products/page.tsx:40-79` renders a label wrapper with only an icon for search and standalone selects.
**User/business impact:** Screen-reader and keyboard users cannot identify filter purpose reliably; the catalog remains technically functional but less discoverable.
**Recommended change:** Add visible or visually-hidden labels, preserve selected values, and add a results summary after Apply.
**Acceptance criteria:**

- Every input/select has a programmatic accessible name.
- Filter results announce or visibly summarize the active filters and result count.
- Empty state provides a clear reset action and keyboard focus remains predictable.

**Dependency:** NONE
**Risk:** Low.
**Suggested slice:** Slice E — Catalog accessibility and state feedback

### UX-008 — P1 — Reset-password CTA is inert

**Area:** Auth recovery
**Route / screen:** `/:locale/reset-password`
**Viewport:** All; observed at 390 px
**Problem:** The page promises a Supabase Auth recovery path, but `Send reset link` is a `type="button"` with no form action or feedback.
**Evidence:** Browser click left URL and page state unchanged. `src/app/[locale]/reset-password/page.tsx:18-24` contains no submit action, success state, or error state.
**User/business impact:** A user who forgets a password has no recovery path, creating a hard auth dead end outside the QR happy path.
**Recommended change:** Implement the real recovery action or explicitly hide the route until the backend contract exists; add pending, success, invalid-email, rate-limit, and expired-link states.
**Acceptance criteria:**

- Valid email produces an observable success state without leaking account existence.
- Invalid, rate-limited, and network-error states are actionable.
- The reset token return path is covered on mobile and desktop.

**Dependency:** BACKEND
**Risk:** High auth/security risk; requires Supabase foundation contract.
**Suggested slice:** Slice F — Auth recovery and account states

### UX-009 — P1 — Legal, author, and social surfaces are explicit placeholders

**Area:** Trust/content readiness
**Route / screen:** `/:locale/author`, `/:locale/privacy`, `/:locale/terms`, footer
**Viewport:** All
**Problem:** Public pages tell visitors to replace placeholder legal copy before production; the author page is a placeholder and the footer displays `Instagram / Pinterest placeholders`.
**Evidence:** Browser legal checks rendered “Replace with the final German privacy policy before production” and equivalent Spanish/English placeholder text. `src/lib/content-store.ts:17-80` stores placeholder records; `src/app/[locale]/author/page.tsx:4-9` and `src/components/site-footer.tsx:36` expose placeholder language.
**User/business impact:** Visitors may question legitimacy, data handling, and brand maturity; legal copy is also a registration trust dependency.
**Recommended change:** Replace placeholders with approved localized legal, author, support, and social content; keep content ownership separate from UI implementation.
**Acceptance criteria:**

- No “replace before production” or placeholder copy is reachable publicly.
- Legal content is complete and reviewed for EN/PL/DE/ES.
- Social links are either real destinations or omitted.

**Dependency:** CONTENT
**Risk:** High legal/content review dependency.
**Suggested slice:** Slice G — Trust, legal, and content readiness

### UX-010 — P1 — Locale SEO surfaces omit DE/ES

**Area:** Localization, SEO, discoverability
**Route / screen:** `/sitemap.xml`, `/robots.txt`, product metadata
**Viewport:** Technical; affects all public screens
**Problem:** The app routes DE/ES, but generated SEO surfaces enumerate/allow only EN/PL and product alternates are only EN/PL.
**Evidence:** `/robots.txt` and `/sitemap.xml` returned 200, but `src/app/robots.ts:7-14` allows only EN/PL paths, `src/app/sitemap.ts:7-17` iterates `['en','pl']`, and `src/lib/products.ts:241-245` emits only EN/PL alternates.
**User/business impact:** DE/ES pages are less discoverable and can be treated as secondary or duplicate content despite being public routes.
**Recommended change:** Generate metadata, alternates, sitemap entries, and robots policy from the supported locale registry, with an explicit decision for untranslated product content.
**Acceptance criteria:**

- Every supported locale has correct sitemap and alternate URLs.
- Robots policy matches the intended public/private route set.
- SEO checks cover locale/product combinations and canonical URLs.

**Dependency:** SEO-ANALYTICS
**Risk:** Medium indexing/canonicalization risk.
**Suggested slice:** Slice G — Trust, legal, and content readiness

### UX-011 — P2 — Video/social placeholders reduce finish quality

**Area:** Content polish and trust
**Route / screen:** Product media block and footer
**Viewport:** All
**Problem:** The product page labels a static placeholder asset `Public flipthrough video`, while the footer advertises placeholder social channels.
**Evidence:** Product DOM showed `Public flipthrough video` over `/assets/video/flipthrough-placeholder.svg`; footer DOM showed `Instagram / Pinterest placeholders`.
**Impact:** The main product promise still works, but perceived quality and content credibility are lower.
**Recommended change:** Use a real video/preview interaction or label the asset honestly as a preview; omit or link real social destinations.
**Acceptance criteria:** Media label matches behavior and assets; no placeholder social text is public.
**Dependency:** CONTENT
**Risk:** Low implementation risk, content availability risk.
**Suggested slice:** Slice G — Trust, legal, and content readiness

### UX-012 — P2 — Audience card accessible names duplicate taxonomy text

**Area:** Content scannability/accessibility polish
**Route / screen:** Home audience cards
**Viewport:** All; observed at 390 px
**Problem:** Browser link names contain duplicated audience text such as `Kids Kids`, because the card repeats the label and display title.
**Evidence:** Home DOM link names were `Bedtime Forest cover Kids Kids` and `Mindful Mandalas cover Adults Adults`; `src/app/[locale]/page.tsx:71-78` renders both label and title.
**Impact:** Minor screen-reader and scan noise; does not block conversion.
**Recommended change:** Keep one semantic heading and expose the supporting taxonomy as secondary metadata.
**Acceptance criteria:** Card accessible names are concise and unique; visual audience context remains.
**Dependency:** NONE
**Risk:** Low.
**Suggested slice:** Slice E — Catalog accessibility and state feedback

## F. Mobile-specific findings

- The 390 px layout has a measurable horizontal overflow on every tested public screen because the header content is wider than the viewport.
- Mobile hides the primary Catalog/Library navigation at `md` without a replacement.
- The unlocked state has no direct Library CTA, making the QR journey incomplete through visible mobile UI.
- Long locale controls and the icon-only Account action need a compact, labeled pattern.
- Product cards and forms render without evidence of vertical clipping at 390 px, but the header overflow must be fixed before considering mobile QA green.

## G. Accessibility findings

- `UX-001` and `UX-002`: mobile Library/account navigation is unavailable or unnamed at narrow widths.
- `UX-007`: catalog search/select controls lack accessible names.
- `UX-012`: duplicate audience text creates screen-reader noise.
- Keyboard traversal remained inconclusive in this browser surface: eight Tab attempts left focus on `BODY`. A follow-up implementation slice must include real keyboard testing in Playwright/CI and a manual screen-reader pass.
- Semantic headings and most text-field labels were present; no claim is made for contrast, reduced motion, or screen-reader announcement completeness because those require a dedicated accessibility tool/manual pass.

## H. Localization findings

- Locale routing is present for EN/PL/DE/ES and locale links preserve the pathname.
- Product translations are present for EN/PL only; `getTranslation` falls back to EN for DE/ES.
- Shared header/footer, auth, premium, catalog, and state strings are largely hard-coded and therefore English on PL/DE/ES.
- Legal records exist in four locales but DE/ES records are explicit placeholders and PL copy lacks final diacritics.
- Sitemap, robots, and product alternate metadata omit DE/ES.

## I. Proposed implementation slices

### Slice A — Mobile navigation and post-unlock re-entry

- **Scope:** Replace the overflowing mobile header with compact navigation; keep Catalog, Library, locale, and Account reachable; add `View Library` to the unlocked product state; add accessible names.
- **Non-goals:** No auth, database, download authorization, or desktop redesign.
- **Dependencies:** None.
- **Expected value:** Removes the P0 continuation break and the most visible mobile defect.
- **Likely areas:** `site-header`, unlocked product section, shared button/navigation styles.
- **QA strategy:** Playwright at 390/768/1440; no horizontal overflow; signed-out, unverified, unlocked, and logged-out states; keyboard focus order.

### Slice B — QR context contract across locale and auth

- **Scope:** Preserve allowlisted QR/redirect context across locale switch, login, register, verification, failed unlock, and refresh; ensure the unlock input visibly retains the code.
- **Non-goals:** No change to redemption rules, RLS, or storage authorization.
- **Dependencies:** FUNNEL/core auth redirect contract.
- **Expected value:** Reduces QR abandonment and removes forced code re-entry.
- **Likely areas:** `language-switcher`, auth redirect builders/actions, `UnlockForm`, product/auth query handling.
- **QA strategy:** Matrix for EN/PL/DE/ES and guest → login → unverified → verified → unlock; invalid/missing code; refresh and back navigation.

### Slice C — Localized public shell and funnel copy

- **Scope:** Use locale messages for header/footer, catalog, auth, premium, state, CTA, and legal navigation copy; define complete product translation behavior for supported locales.
- **Non-goals:** No translation of admin surfaces or unrelated backend messages.
- **Dependencies:** CONTENT.
- **Expected value:** Makes the four-locale promise credible and improves trust/conversion.
- **Likely areas:** `messages/*.json`, public page components, product/content records.
- **QA strategy:** EN/PL/DE/ES screenshot/text assertions at all viewports; long-string and fallback tests.

### Slice D — Acquisition and product CTA hierarchy

- **Scope:** Clarify `Buy on Amazon` vs `Unlock bonuses`; add a direct acquisition path where appropriate; replace admin-facing homepage copy with reader reassurance; preserve analytics.
- **Non-goals:** No checkout, payment, Amazon integration, or pricing redesign.
- **Dependencies:** FUNNEL and CONTENT.
- **Expected value:** Improves first-visit clarity and Amazon click-through.
- **Likely areas:** Home hero/feature cards, product CTA block, Amazon analytics labels.
- **QA strategy:** Task-based browser checks for new visitor vs book owner, Amazon href/target/analytics contract, mobile/desktop hierarchy.

### Slice E — Catalog accessibility and state feedback

- **Scope:** Label search/select controls, add active-filter/result summary, improve empty-state focus, simplify duplicate card accessible names.
- **Non-goals:** No new catalog taxonomy or server filtering architecture.
- **Dependencies:** None.
- **Expected value:** Makes discovery usable by keyboard/screen-reader users and improves scanability.
- **Likely areas:** Catalog form, ProductCard, filter state copy.
- **QA strategy:** Accessibility assertions for names/roles, keyboard filter flow, empty/reset/no-result states at all viewports.

### Slice F — Auth recovery and account states

- **Scope:** Implement reset-password request/return states against the approved Supabase Auth contract; add pending/success/error/rate-limit/expired-link states; improve logged-out account and Library re-entry.
- **Non-goals:** No auth provider migration or session-storage redesign.
- **Dependencies:** BACKEND/Supabase foundation.
- **Expected value:** Removes an auth dead end and makes recovery trustworthy.
- **Likely areas:** `reset-password`, auth actions, session boundary, account/Library states.
- **QA strategy:** Mocked and stage-backed auth tests as appropriate; no production mutation; keyboard/mobile/desktop checks.

### Slice G — Trust, legal, content, and locale SEO readiness

- **Scope:** Replace legal/author/social/video placeholders; generate sitemap/robots/alternate metadata from the supported locale registry; make media labels truthful.
- **Non-goals:** No SEO ranking experiment or CMS migration.
- **Dependencies:** CONTENT and SEO-ANALYTICS.
- **Expected value:** Removes public placeholder trust debt and makes DE/ES discoverable if they remain supported.
- **Likely areas:** static content records, author/footer/media copy, `robots.ts`, `sitemap.ts`, product metadata.
- **QA strategy:** Public content search for placeholder phrases; sitemap/canonical assertions for all locales; legal links and media behavior at all widths.

## J. Recommended execution order

1. **Slice A** — remove the P0 mobile continuation break and overflow.
2. **Slice B** — stabilize the QR/auth context contract before adding more funnel UI.
3. **Slice C** — localize the shared shell and critical funnel copy.
4. **Slice D** — sharpen acquisition/product CTA hierarchy and measure Amazon handoff.
5. **Slice E** — make discovery controls and cards accessible.
6. **Slice F** — complete auth recovery and account state coverage with the Supabase foundation.
7. **Slice G** — finish content/legal/SEO readiness after owners supply approved copy.

## K. Explicit non-goals

- No production application-code implementation in this audit branch.
- No Supabase schema, RLS, migration, storage, download authorization, or server redemption changes.
- No admin UX audit or admin changes.
- No checkout, payment, marketplace, subscription, or Amazon-side changes.
- No merge to `main` and no production deployment.
- No claim that the final premium file download succeeded in-browser; only the authorized 307 endpoint step was observed.

## L. Quality gate

- [x] Final audit artifact exists at `docs/audits/public-ux-audit-2026-08.md`.
- [x] All 13 public UI route patterns are audited.
- [x] All public technical/supporting surfaces are explicitly accounted for.
- [x] Both business-critical journeys are mapped step by step.
- [x] 390/768/1440 viewport QA is recorded; mobile failures are findings, not hidden.
- [x] EN/PL/DE/ES routing and critical-screen coverage are recorded.
- [x] Every finding has ID, priority, area, route/screen, viewport, problem, evidence, impact, recommendation, acceptance criteria, dependency, risk, and suggested slice.
- [x] P0/P1 findings have concrete source and/or browser evidence.
- [x] Mobile, accessibility, and localization sections are present.
- [x] Seven prioritized implementation slices are defined.
- [x] No production-code changes are present in the audit worktree.
