# Admin UX / Functional Audit — Lamilia Lomi

Date: 2026-09-05
Environment: live Vercel URL (`https://lamilia-lomi.vercel.app/en/login`)
Account: dedicated admin test account (credentials intentionally not recorded)
Status: code fixes complete; live deployment and content inputs still pending

## Scope

Exercise the complete admin surface through the browser, including navigation, authentication, product CRUD, taxonomy CRUD, product assignments, media/premium metadata, static pages, users, settings, and representative public-facing verification where applicable.

## Evidence rules

- Each result is based on the live browser state, not only source-code inspection.
- Destructive test data is limited to clearly labelled audit fixtures and will be cleaned up only after their behavior is verified.
- No credentials, tokens, or private user data are recorded here.
- Screenshots are captured in the audit conversation at key checkpoints; this file records the corresponding state and findings.

## Test matrix

| Area | Status | Evidence / notes |
| --- | --- | --- |
| Login and admin access | PASS | Login succeeded; redirected to `/en/library`, then Account opened `/admin`. No credential or redirect error observed. |
| Admin dashboard and navigation | PASS | Dashboard loaded with sidebar links for Dashboard, Produkty, Kategorie, Tagi, Użytkownicy, Strony, Ustawienia. Summary showed 2 published products, 2 premium codes, 0 premium files. |
| Products: list, search/filter, create, edit, archive/delete | PASS (code fix pending live deploy) | List/search, minimal create, edit, publish, archive, and delete passed live. The full one-shot form and premium asset save were hardened in code and covered by regression tests. |
| Product translations and SEO fields | PASS | EN/PL/DE/ES content and SEO fields were saved and reloaded successfully. SEO is an expandable disclosure, not a missing field. |
| Categories: create, edit, delete | PASS | Audit fixture was created with EN/PL content, edited, verified in the list, and deleted. Existing categories were left unchanged. |
| Tags: create, edit, delete | PASS (code fix + migration pending live apply) | Audit fixture CRUD passed live. Tag descriptions now flow through the Supabase adapter and the new `tag_translations.description` migration. |
| Product category/tag assignment | PASS | Audit product retained the selected `Coloring books` category and `Printable bonus` tag after save/reload. |
| Amazon links | PASS | Amazon.com and Amazon.de links saved; Amazon.com remained the single default link and rendered publicly. |
| Premium codes | PASS | Active and inactive codes saved with the expected checked state. Active code unlocked the product and added it to My Library. |
| Media/assets and public vs premium metadata | PASS (code fix pending live deploy) | Cover, gallery, video, and public download assets passed live. Premium asset bucket classification is now normalized in both UI and backend, with regression coverage. |
| Static pages | PASS (UI) / CONTENT BLOCKER | Admin list and EN/PL/DE/ES editor loaded. Public EN Privacy/Terms currently show owner-placeholder copy; see A-002. |
| Users | PASS (code fix pending live deploy) | The Supabase user reader no longer depends on request-scoped content loading, and the page has a controlled retry state. Regression tests and build pass. |
| Settings | PASS (read-only) | Integration status page loaded and showed Resend, GA4, and Supabase as configured; Cron as protected. No settings were changed. |
| Public-facing verification | PARTIAL | Existing Moon Garden remains incomplete (A-003) and legal copy remains owner input (A-002). The audit fixture rendered cover, gallery, video, Amazon CTA, unlock flow, and My Library entry before cleanup. |

## Findings

Findings are recorded below.

### Finding A-001 — Admin users page is unavailable

- Severity: high (entire admin area unavailable)
- URL: `https://lamilia-lomi.vercel.app/admin/users`
- Reproduction: open the route while authenticated as admin; click `Reload`.
- Expected: user list / user-management screen.
- Actual: “This page couldn’t load — A server error occurred. Reload to try again.” with `ERROR 882554858`.
- Additional evidence: browser console recorded minified React error `#441` twice during the two loads.
- Screenshot: captured in the audit conversation immediately after reproduction.
- Resolution: the Supabase path now reads product titles through the server-only service-role client, and the page renders a controlled retry state if the account service is unavailable. The fix is present on `main` and covered by admin-user tests/build; the live URL requires a deployment before re-checking.

### Finding A-002 — Public legal pages still contain production placeholder copy

- Severity: critical release blocker for a real public launch.
- URLs: `https://lamilia-lomi.vercel.app/en/privacy` and `https://lamilia-lomi.vercel.app/en/terms`.
- Actual: public pages display `Replace with final owner-approved policy before production.` and `Replace with final owner-approved terms before production.`.
- Impact: visitors are shown explicit internal placeholder text instead of approved legal content.
- Screenshot: captured in the audit conversation on the Terms page.
- Resolution: intentionally not changed in code. The project source of truth lists Privacy Policy and Terms as owner inputs and explicitly requires owner/legal confirmation. Publishing invented legal copy would be unsafe; this remains a release-content blocker.

### Finding A-003 — Published product is missing purchase/media content

- Severity: high for catalog conversion/content completeness.
- URL: `https://lamilia-lomi.vercel.app/en/products/moon-garden-coloring-book`.
- Admin evidence: product status is `Opublikowany`, while the editor shows no assets and no Amazon market link.
- Public evidence: cover renders as `Cover coming soon`; the page shows `Public flipthrough video` without a configured video; no Amazon purchase link is present even though the unlock copy says the book is bought on Amazon.
- Impact: a published product cannot present its cover, video, or purchase CTA.
- Resolution: not changed through source code. The repository seed contains sample media/Amazon records, but the live Supabase record is missing owner-provided content. This remains a data/content setup blocker until approved assets and links are loaded into the intended environment.

### Finding A-004 — Mobile admin navigation is clipped and relies on hidden horizontal scrolling

- Severity: medium UX issue.
- Viewport: 390 × 844.
- Actual: sidebar navigation is rendered as a horizontal strip; only part of `Kategorie` is visible at first glance and a horizontal scrollbar is present. Product cards also truncate long titles and slugs.
- Impact: mobile admin is usable after scrolling, but key navigation is not discoverable without knowing the strip is horizontally scrollable.
- Resolution: replaced the hidden horizontal strip with a responsive two-column mobile grid, retained a single-column desktop layout, and added `min-w-0` protections. Mobile/desktop runtime checks and navigation tests passed.

### Finding A-005 — Saving a Premium download asset crashes the admin editor

- Severity: high (product media cannot be completed from the admin UI).
- Reproduction: on a saved audit product, add an asset, select `Premium download`, enter either `/private/demo-premium/moon-garden-bonus.pdf` or a valid existing public asset path, then click `Zapisz`.
- Expected: the premium asset is saved and remains available for the product.
- Actual: the page changes to “This page couldn’t load — A server error occurred. Reload to try again.” with `ERROR 2300623740`; after Reload, the new row is gone. The same error occurred with both a private path and a public SVG path, so the failure is tied to the premium asset type rather than only the tested private path.
- Impact: the public unlock flow can succeed, but no premium material can be attached through this editor, leaving the unlocked product without a downloadable premium asset.
- Screenshot: captured in the audit conversation immediately after the failed save.
- Resolution: premium assets now always use the schema-required `premium-files` bucket when their kind is selected, including when the user changes kind after adding an asset. Backend normalization prevents stale form metadata from violating the database constraint. Regression tests and full E2E passed locally.

### Finding A-006 — Tag descriptions are not persisted

- Severity: medium (metadata silently disappears).
- Reproduction: create or edit a tag, enter an EN or PL description, save, close/reopen the tag drawer.
- Expected: the saved description is shown again.
- Actual: the tag name and slug persisted, but the description field was empty after reopening for both EN and PL. The same behavior was observed on the audit fixture after two saves.
- Impact: admins can believe a description was saved when it was silently lost; localized tag metadata cannot be maintained reliably.
- Resolution: added the missing `tag_translations.description` column migration, included descriptions in Supabase writes, and made the adapter choose the visible/latest mirrored form value. Regression coverage passed; the migration must be applied to the connected Supabase project.

### Finding A-007 — Full one-shot product creation is not reliable

- Severity: medium/high (complex catalog entry may require manual recovery).
- Reproduction observed: on a fresh product form, entering the full localized/media/market/code scenario and submitting once returned `?error=English+title+is+required` even though the EN title was visibly filled. A minimal EN-only create then succeeded, and the same data could be built incrementally on the saved product.
- Impact: the normal “fill the complete form, save once” workflow is not proven reliable. The audit was able to complete the product only by saving sections incrementally.
- Note: this is reported as an observed reliability issue, not as a confirmed root cause.
- Resolution: mirrored locale fields are now parsed using the latest submitted value, so the visible locale input wins over its hidden state mirror. Product-editor/admin tests cover the behavior and the full local E2E suite passed.

## Chronological test log

Audit started. Live application and browser evidence will be added below as each flow is exercised.

### 2026-09-05 — login and dashboard

- PASS: live URL loaded and accepted the dedicated admin credentials.
- PASS: admin access was available through the Account link; dashboard rendered in Polish with clear sidebar navigation.
- PASS: key-count cards rendered and were visually legible at the default desktop viewport.
- UX note: the public header remains visible above the admin shell, which is understandable but slightly mixes public and admin navigation.

### 2026-09-05 — products, categories, tags, users

- PASS: product list loaded with 2 records; search returned 1 matching record for `Mindful` and 0 records for a non-matching query with a clear `Brak wyników.` state.
- PASS: new-product form loaded and exposed translations EN/PL/DE/ES, publication status, organization, category/tag assignment, SEO/media, Amazon markets, premium codes, and advanced fields.
- PASS: category list loaded with 3 records; add-category drawer opened with localized content tabs, slug, order, Save/Cancel controls.
- PASS: tag list loaded with 3 records; add-tag drawer opened with localized content tabs, slug, Save/Cancel controls.
- FAIL: users route failed consistently with A-001.

### 2026-09-05 — static pages, public product, mobile UX

- PASS (UI): `/admin/pages`, `/admin/pages/privacy`, `/admin/pages/terms`, and `/admin/settings` loaded; settings showed read-only integration statuses.
- FAIL (content): public Privacy and Terms pages expose placeholder text (A-002).
- PARTIAL: public published product loaded and unlock controls rendered, but content/purchase gaps were present (A-003).
- PARTIAL: mobile product list switched from table to cards and remained usable; navigation discoverability issue recorded as A-004.

### 2026-09-05 — confirmed mutation and end-to-end product flow

- PASS: created a clearly labelled audit product, then saved EN/PL/DE/ES product text and SEO fields.
- PASS: saved segment, product type, order, review delay, category assignment, and tag assignment; values survived reload.
- PASS: saved cover, gallery, video, and public-download assets independently. The premium-download variant failed with A-005.
- PASS: saved Amazon.com and Amazon.de markets with exactly one default; both remained visible after reload.
- PASS: saved one active and one inactive premium code; the active code unlocked the public product and the product appeared in My Library.
- PASS: changed the product to Published, verified the public EN route, then archived and deleted the fixture. The admin product list returned to the original 2 records.
- PASS: empty publish validation returned the visible list `English title | English short description | Amazon link | Cover asset` without creating a record.

### 2026-09-05 — taxonomy CRUD

- PASS: category fixture create, EN/PL localization, edit, and delete.
- PARTIAL: tag fixture name/slug create, edit, and delete passed; descriptions were silently lost on reload (A-006).

### 2026-09-05 — pages, settings, and cleanup

- PASS (read-only): page list and Privacy/Terms editors loaded with EN/PL/DE/ES tabs. Existing legal pages were not saved or changed.
- FAIL (content): public Privacy and Terms still contain the placeholder copy from A-002.
- PASS (read-only): settings integration status page loaded; no settings were changed.
- PASS: final product list contains only the original two products; audit category and tag were deleted. My Library also returned to the empty `No unlocked products yet` state after fixture deletion. No audit credentials were written to this report.

### 2026-09-05 — post-fix verification

- PASS: focused admin regression tests — 29 tests.
- PASS: full unit/integration suite — 30 files, 129 tests.
- PASS: production build with local backend configuration — compiled, typechecked, and generated all 62 static pages.
- PASS: full Playwright suite — 26 tests across Chromium desktop and mobile.
- PASS: `git diff --check` on the fix branch.
- PASS: source-level resolution confirmed for A-001, A-004, A-005, A-006, and A-007.
- PENDING: live Vercel re-check, because automatic Git deployments are disabled and no Production deployment was requested.
- PENDING: owner-approved Privacy/Terms copy (A-002), approved Moon Garden media/purchase content (A-003), and application of the tag description migration to the intended remote Supabase project.

### 2026-09-05 — live re-check after main push

- FAIL / unchanged A-001: the authenticated live URL still renders the generic server-error screen with `ERROR 882554858` on `/admin/users`.
- Evidence: the live screenshot was captured after `origin/main` reached `4edb8c0d404d4ec985331487d3855598c01812b0`; the runtime is therefore not serving that commit yet.
- Independent read-only Vercel evidence: the latest promoted Production deployment is associated with commit `039d81…`, not the current `main` commit `edf12a5…`.
- Interpretation: the source fix is verified locally, but live verification remains pending deployment. No Production deployment was initiated because automatic Git deployments are disabled and the request was to push `main`, not deploy Production.
