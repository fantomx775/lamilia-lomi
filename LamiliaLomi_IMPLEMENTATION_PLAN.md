# LamiliaLomi - Implementation Plan

Status: proposed execution plan
Source of truth: `LamiliaLomi_SOURCE_OF_TRUTH.md`
Method: vertical slices + TDD + E2E closure
Date: 2026-05-31

This document defines how the LamiliaLomi product should be implemented. The plan uses vertical slices: each slice delivers a small, testable product capability from UI through server logic and data, rather than building horizontal layers in isolation.

Each slice is closed only when:

1. Unit-level TDD tests pass.
2. Integration tests pass where data/auth/storage behavior is involved.
3. E2E or manual browser verification confirms the user-facing behavior.
4. Evidence is captured: screenshot, test output, database check, or storage check.
5. The app remains runnable.

---

# 1. Execution Principles

## 1.1 Vertical slices

Build one complete capability at a time.

Good slice:

- User can view the product catalog with seeded products.
- User can unlock a product with a premium code.
- Admin can create and publish a product.

Bad slice:

- Build all database tables first.
- Build all UI components first.
- Build all admin screens before any of them work end-to-end.

Infrastructure work is allowed, but it must be attached quickly to a visible or testable behavior.

## 1.2 TDD workflow

For each slice:

1. Define the public behavior.
2. Write one failing unit or behavior test.
3. Implement the minimum code to pass.
4. Repeat for the next behavior.
5. Refactor only when tests are green.
6. Add integration/E2E coverage for the completed slice.

Unit tests should verify behavior through public interfaces, not private implementation details.

Examples of good test targets:

- `validatePremiumCode(...)`
- `buildProductMetadata(...)`
- `getLocalizedProductView(...)`
- `canDownloadPremiumAsset(...)`
- `scheduleReviewReminder(...)`
- server actions or service functions that represent user actions

Examples to avoid:

- testing private helper internals,
- testing exact component structure when behavior is enough,
- mocking everything so the test no longer proves the feature works.

## 1.3 Closure rule

A slice is not done when the code compiles. A slice is done when it has proof.

Accepted proof types:

- automated test output,
- Playwright/browser screenshot,
- database row check,
- Supabase Storage object check,
- signed URL/access denial check,
- visible UI state in desktop and mobile.

Each slice should leave a short note in implementation progress docs or commit message:

- what was built,
- what tests prove it,
- what manual evidence was captured,
- what remains intentionally outside the slice.

---

# 2. Recommended Test Stack

Final choices can adapt to the actual project setup, but this is the recommended baseline.

## Unit and behavior tests

- Vitest.
- React Testing Library for client components when needed.
- Testing Library user-event for UI interaction tests.

## Integration tests

- Supabase local development stack where possible.
- Tests for database policies, server actions, and route handlers.
- SQL migration validation.

## E2E tests

- Playwright.
- Run against local dev server.
- Use seeded test users and seeded products.

## Manual verification

- Browser verification on desktop and mobile.
- Screenshots for important flows.
- Database checks after flows that create data.

---

# 3. Test Data Strategy

Use stable seed data from the beginning.

Minimum seed set:

- one admin user,
- one regular verified user,
- one regular unverified user if needed,
- one Kids product,
- one Adults product,
- one complete product with:
  - EN translation,
  - PL translation or EN fallback,
  - DE/ES routes proving EN fallback if translations are not seeded yet,
  - cover,
  - gallery,
  - video placeholder,
  - Amazon link,
  - premium code `LOMI-BOOK-2026`,
  - premium PDF placeholder,
- base categories,
- base tags.

E2E tests should use deterministic slugs, emails, and codes.

---

# 4. Slice Plan

## Slice 0 - Project bootstrap and quality gates

### Goal

Create a runnable app foundation with testing, linting, formatting, and basic CI-ready scripts.

### Product capability

Developer can run the app locally and see the LamiliaLomi shell page.

### Implementation

- Initialize Next.js App Router with TypeScript.
- Add Tailwind.
- Add component/UI baseline.
- Add test setup.
- Add Playwright setup.
- Add `.env.example`.
- Add app shell route.
- Add basic responsive layout.

### TDD/unit tests

- Test that app config helpers read required public environment values safely.
- Test locale config helper returns supported locales and default locale.

### Integration tests

- Verify app can boot with test environment values.

### E2E/manual verification

- Open home page locally.
- Confirm page renders.
- Capture desktop screenshot.
- Capture mobile screenshot.

### Done evidence

- `npm test` or equivalent passes.
- `npm run lint` passes.
- Playwright smoke test passes.
- Screenshots show the shell page.

---

## Slice 1 - Database foundation with seed product

### Goal

Create the first real data path for products, categories, tags, assets, Amazon links, premium codes, profiles, unlocks, downloads, reminders, and static pages.

### Product capability

The app can load one seeded published product from the database.

### Implementation

- Add Supabase migrations for canonical schema.
- Add RLS policies for public product reads.
- Add seed data.
- Add server-side data access for product lookup.
- Add local development instructions for Supabase.

### TDD/unit tests

- Test product status rules:
  - published products are public,
  - draft products are not public,
  - archived products are not in catalog.
- Test translation fallback:
  - requested locale is used if present,
  - missing PL/DE/ES falls back to EN.

### Integration tests

- Migration applies successfully.
- Seed inserts successfully.
- Public client can read published product.
- Public client cannot read draft-only admin content.

### E2E/manual verification

- Load a debug/product preview page or home page that reads seeded product data.
- Confirm seeded product title appears.
- Check database contains seeded product, translation, category, tag, Amazon link, and premium code.

### Done evidence

- Migration output.
- Integration test output.
- Screenshot of rendered seeded product.
- Database check for seeded rows.

---

## Slice 2 - Public home page and brand segmentation

### Goal

Deliver the first public-facing experience with Kids/Adults entry points and real seeded products.

### Product capability

Guest can open the site, understand the brand, and choose Kids or Adults.

### Implementation

- Build home page.
- Add Kids/Adults sections.
- Show featured seeded products.
- Add public navigation.
- Add footer with placeholder social links.
- Apply visual direction: calm, premium, off-white, earthy accents.

### TDD/unit tests

- Test featured product selection rules.
- Test audience labels and route generation.
- Test fallback content for missing product imagery.

### Integration tests

- Home page server data fetch returns published products by audience.

### E2E/manual verification

- Guest opens `/en`.
- Kids and Adults entry points are visible.
- At least one product cover/title is visible.
- Layout works on desktop and mobile.

### Done evidence

- E2E screenshot desktop.
- E2E screenshot mobile.
- Test output.

---

## Slice 3 - Public catalog with filtering, sorting, and search

### Goal

Make products discoverable.

### Product capability

Guest can browse catalog, search, filter by audience/type/category/tag, and sort.

### Implementation

- Build `/[locale]/products`.
- Add server-side catalog query.
- Add filters.
- Add sorting: newest, A-Z, manual order.
- Add PostgreSQL full-text search.
- Preserve filters in URL query params.
- Add empty state.

### TDD/unit tests

- Test catalog query param parsing.
- Test sort option validation.
- Test search normalization.
- Test filter combination behavior.

### Integration tests

- Search finds product by title.
- Search finds product by tag/category.
- Filters return expected seeded products.
- Draft products never appear.

### E2E/manual verification

- Open catalog.
- Search seeded product.
- Apply category filter.
- Apply audience filter.
- Sort A-Z.
- Confirm visible results update.

### Done evidence

- Playwright test for catalog search/filter.
- Screenshot of filtered catalog.
- Database query or integration result showing expected filtered product.

---

## Slice 4 - Product detail page with SEO and Amazon link tracking

### Goal

Deliver the public product page.

### Product capability

Guest can view product details, gallery, video, tags/categories, and click Amazon link.

### Implementation

- Build `/[locale]/products/[slug]`.
- Render product translation with EN fallback.
- Render the full public gallery and video placeholder for guests.
- Render Amazon links.
- Add premium CTA.
- Add metadata generation.
- Add structured data where useful.
- Track Amazon link click.

### TDD/unit tests

- Test localized product view builder.
- Test SEO metadata fallback.
- Test Amazon primary link selection.
- Test structured data builder for required fields.

### Integration tests

- Product page resolves published product by slug.
- Missing PL content falls back to EN.
- Amazon click event can be recorded or emitted.

### E2E/manual verification

- Open seeded product page.
- Confirm title, description, cover/gallery, video area, Amazon CTA.
- Click Amazon link and confirm tracking event behavior without breaking navigation.
- Inspect page metadata if practical.

### Done evidence

- E2E screenshot product page.
- Test output.
- Analytics/event stub or database event evidence for Amazon click.

---

## Slice 5 - Auth: unlock-context registration, login, logout, reset password

### Goal

Enable session handling and account creation only when the user is unlocking a product.

### Product capability

User can create an account from a product unlock context, log in, log out, and request password reset. Casual visitors should not see a generic sign-up path.

### Implementation

- Add Supabase Auth integration.
- Add register page guarded to QR/product unlock context.
- Add login page.
- Add logout action.
- Add reset password flow.
- Add profile creation.
- Add terms acceptance and optional marketing consent.
- Add protected account page.

### TDD/unit tests

- Test registration input validation.
- Test generic registration redirects away or is unavailable.
- Test product/QR registration context is allowed.
- Test consent validation:
  - terms required,
  - marketing optional,
  - marketing defaults false.
- Test auth redirect destination builder.

### Integration tests

- Unlock-context registration creates auth user/profile.
- Profile stores marketing consent.
- Login returns valid session.
- Protected page rejects guest.

### E2E/manual verification

- Register test user from a product unlock context.
- Verify visible post-registration state.
- Log out.
- Log in.
- Open account page.
- Request reset password.

### Done evidence

- E2E screenshots for register/login/account.
- Database check for created profile.
- Test output.

---

## Slice 6 - Email verification gate

### Goal

Respect source of truth: email verification is required before protected downloads.

### Product capability

Unverified users can log in but cannot download premium files.

### Implementation

- Add verification state handling.
- Add UI notices for unverified users.
- Add auth callback route.
- Gate premium download on verified email.
- Add resend verification option if supported.

### TDD/unit tests

- Test `canAccessPremiumDownload(...)` denies unverified user.
- Test verified user with unlock is allowed.
- Test unverified messaging state.

### Integration tests

- Unverified user session cannot generate premium signed URL.
- Verified user can proceed when unlocked.

### E2E/manual verification

- Log in as unverified seeded user.
- Attempt premium flow.
- Confirm app shows verification required.

### Done evidence

- E2E screenshot of verification gate.
- Integration test proving signed URL denial.

---

## Slice 7 - Manual premium code unlock

### Goal

Implement the core premium access model.

### Product capability

Verified logged-in user can unlock a product by entering a valid code.

### Implementation

- Add unlock form to product page.
- Add server action/service for code validation.
- Store `user_product_unlocks`.
- Make code matching case-insensitive.
- Show success and failure states.
- Track unlock success/failure.

### TDD/unit tests

- Test valid code unlocks product.
- Test invalid code returns safe error.
- Test inactive code cannot unlock.
- Test code matching is case-insensitive.
- Test repeated unlock is idempotent.

### Integration tests

- Valid code creates `user_product_unlocks`.
- Invalid code does not create unlock.
- Reusing code by second user works.
- Duplicate unlock does not create duplicate row.

### E2E/manual verification

- Log in as verified user.
- Open product page.
- Enter wrong code and see error.
- Enter valid code and see premium section unlock.
- Check database row exists.

### Done evidence

- E2E screenshot before and after unlock.
- Database check for `user_product_unlocks`.
- Test output.

---

## Slice 8 - QR code unlock flow through auth

### Goal

Make the physical book QR journey work end-to-end.

### Product capability

User enters through `/en/products/[slug]?code=...`, logs in or registers in that unlock context, and unlocks the product without losing the code.

### Implementation

- Preserve `code` query param through auth redirect.
- Prefill unlock form or auto-confirm after login.
- Add friendly confirmation UI.
- Ensure invalid QR code displays recoverable error.

### TDD/unit tests

- Test return URL builder preserves product slug and code.
- Test code extraction/normalization.
- Test redirect safety prevents external redirects.

### Integration tests

- Auth redirect returns to product page with code context.
- Unlock service handles preserved code.

### E2E/manual verification

- Start as guest on QR URL.
- Click register/login.
- Complete auth as test user.
- Return to product page.
- Unlock product with preserved code.
- Confirm DB row exists.

### Done evidence

- Playwright E2E video/screenshot sequence.
- Database check for unlock row.
- Test output.

---

## Slice 9 - Premium downloads with signed URLs

### Goal

Securely deliver premium files.

### Product capability

Unlocked verified user can download premium PDF. Guest or locked user cannot.

### Implementation

- Add private premium storage bucket.
- Add premium asset metadata.
- Add `/api/downloads/[assetId]` route handler.
- Check verified session.
- Check `user_product_unlocks`.
- Generate signed URL.
- Log `download_events`.
- Show premium download list on product page.
- Add an authenticated "send this file/link to my email" action for mobile users; the email should point back to the protected product/library download flow, not expose a permanent public file URL.

### TDD/unit tests

- Test `canDownloadPremiumAsset(...)`.
- Test denied states:
  - guest,
  - unverified user,
  - user without unlock,
  - asset from different product.
- Test allowed state:
  - verified user with matching unlock.
- Test email-to-self request is allowed only for a verified user with the matching unlock.
- Test email-to-self payload contains product/file context without a permanent public file URL.

### Integration tests

- Route handler denies guest.
- Route handler denies locked user.
- Route handler returns redirect/signed URL for unlocked user.
- Download event is inserted.
- Email-to-self route/action sends through Resend or stub mode after the same access checks.

### E2E/manual verification

- Guest sees premium locked.
- Locked user cannot download.
- Unlocked user clicks download.
- On mobile, unlocked user can send the premium file/library link to their own email.
- Confirm file access starts or signed URL is returned.
- Confirm email stub/log evidence for the send-to-email action.
- Confirm `download_events` row exists.

### Done evidence

- E2E screenshots.
- Signed URL/access denial test output.
- Database check for `download_events`.
- Storage check for premium file.

---

## Slice 10 - My Library

### Goal

Give returning users a clear place to access unlocked products.

### Product capability

Logged-in user can see all unlocked products and return to downloads.

### Implementation

- Build `/[locale]/library`.
- Query user's unlocks.
- Render product cards.
- Link to product pages.
- Add empty state.

### TDD/unit tests

- Test library view model for unlocked products.
- Test empty library state.
- Test locale fallback for library product titles.

### Integration tests

- User sees only their own unlocks.
- Another user's unlocks are not returned.

### E2E/manual verification

- Log in as user with unlock.
- Open library.
- Confirm unlocked product appears.
- Open product from library.

### Done evidence

- E2E screenshot library.
- Integration test output for user isolation.

---

## Slice 11 - Admin access guard and dashboard shell

### Goal

Protect admin area and create the admin workspace.

### Product capability

Admin can access `/admin`; normal users and guests cannot.

### Implementation

- Add admin layout.
- Add admin navigation.
- Add role guard.
- Add dashboard shell.
- Add Polish admin labels.

### TDD/unit tests

- Test admin guard allows admin role.
- Test admin guard denies user role.
- Test admin guard denies missing session.

### Integration tests

- Guest request to `/admin` redirects/denies.
- Regular user request to `/admin` redirects/denies.
- Admin request succeeds.

### E2E/manual verification

- Visit `/admin` as guest.
- Visit `/admin` as regular user.
- Visit `/admin` as admin.

### Done evidence

- Screenshots for denied and allowed states.
- Test output.

---

## Slice 12 - Admin product CRUD, translations, and publish flow

### Goal

Allow admin to create and publish products.

### Product capability

Admin can create a product with EN/PL/DE/ES content, publish it, and see it on the public catalog/product page.

### Implementation

- Admin product list.
- Product create form.
- Product edit form.
- EN/PL/DE/ES translation fields.
- Status draft/published/archived.
- Audience and product type.
- SEO fields.
- Save/publish actions.

### TDD/unit tests

- Test product form validation.
- Test published product requires EN title and at least one Amazon link before publish.
- Test slug normalization.
- Test SEO fallback.

### Integration tests

- Admin creates draft product.
- Admin publishes valid product.
- Invalid publish is rejected.
- Public catalog shows published product only.

### E2E/manual verification

- Admin creates product.
- Admin publishes product.
- Open public catalog.
- Confirm product appears.
- Open product page.

### Done evidence

- Admin screenshots.
- Public product screenshot.
- Database check for product/translations.
- Test output.

---

## Slice 13 - Admin taxonomy and Amazon links

### Goal

Enable admin to manage categories, tags, and Amazon market links.

### Product capability

Admin can create categories/tags, attach them to products, and manage Amazon links per market.

### Implementation

- Category CRUD.
- Tag CRUD.
- Translation fields for category/tag names.
- Product category/tag assignment.
- Amazon links section in product editor.
- Primary Amazon link flag.

### TDD/unit tests

- Test category/tag slug normalization.
- Test duplicate slug validation.
- Test primary Amazon link selection.
- Test published product Amazon link requirement.

### Integration tests

- Category/tag create and attach works.
- Catalog filters use admin-created taxonomy.
- Product page shows Amazon link.

### E2E/manual verification

- Admin creates category/tag.
- Admin attaches to product.
- Guest filters catalog by that category/tag.
- Product page shows Amazon CTA.

### Done evidence

- Admin screenshot.
- Catalog filtered screenshot.
- Database check for join tables.

---

## Slice 14 - Admin media and premium file upload

### Goal

Make admin independent for product media and premium files.

### Product capability

Admin can upload cover, gallery images, video, and premium PDF for a product.

### Implementation

- Storage upload flow.
- Product asset metadata creation.
- Cover selection.
- Gallery ordering.
- Video asset.
- Premium file asset.
- File validation by type/size.

### TDD/unit tests

- Test allowed file type validation.
- Test asset kind rules.
- Test gallery ordering.
- Test public vs private asset classification.

### Integration tests

- Public asset metadata is readable publicly.
- Premium asset metadata is visible where appropriate but file is protected.
- Upload creates storage object and asset row.

### E2E/manual verification

- Admin uploads cover/gallery.
- Public product page displays uploaded media.
- Admin uploads premium PDF.
- Unlocked user can download through signed URL.

### Done evidence

- Admin upload screenshot.
- Public product page screenshot.
- Storage object check.
- Database asset row check.

---

## Slice 15 - Admin users and email export

### Goal

Give admin visibility into users and mailing export.

### Product capability

Admin can view users, see consent/unlocks, and export emails to CSV.

### Implementation

- Admin users list.
- User detail view.
- Show marketing consent.
- Show unlocked products.
- CSV export route/action.
- Filter all users vs marketing consent users.

### TDD/unit tests

- Test CSV generation.
- Test export filter behavior.
- Test user summary view model.

### Integration tests

- Admin can export CSV.
- Regular user cannot export CSV.
- Marketing-only export excludes users without consent.

### E2E/manual verification

- Admin opens users page.
- Admin exports marketing CSV.
- Confirm downloaded/generated CSV contains expected user and excludes non-consenting user.

### Done evidence

- Screenshot users page.
- CSV content sample.
- Test output.

---

## Slice 16 - Static pages, contact form, and legal consent

### Goal

Complete public trust/legal surfaces.

### Product capability

Guest can read Privacy/Terms and submit contact form. Registration uses accepted consent model.

### Implementation

- Static pages from `static_pages` or code fallback.
- Optional admin editing for static pages.
- Contact page/form.
- Contact email via Resend.
- Cookie consent UI.

### TDD/unit tests

- Test contact form validation.
- Test email payload builder.
- Test cookie consent state rules.
- Test legal page fallback.

### Integration tests

- Contact route sends or stubs email.
- Static pages render per locale.
- GA4 is not loaded before analytics consent.

### E2E/manual verification

- Open Privacy/Terms.
- Submit contact form.
- Accept/reject analytics cookies.
- Confirm UI state persists.

### Done evidence

- Screenshots of legal pages and contact form.
- Email stub/log evidence.
- Cookie consent test output.

---

## Slice 17 - Review reminder system

### Goal

Send one polite review reminder per user/product after configured delay.

### Product capability

Unlocking a product schedules a reminder; cron sends it when due.

### Implementation

- Create reminder on unlock.
- Admin product field for `review_delay_days`.
- Cron route `/api/cron/review-reminders`.
- Resend email template.
- Status tracking: pending/sent/failed/cancelled.
- Cron secret protection.

### TDD/unit tests

- Test schedule date calculation.
- Test duplicate reminder prevention.
- Test due reminder selection.
- Test email copy data builder.

### Integration tests

- Unlock creates pending reminder.
- Cron sends due reminder and marks sent.
- Cron does not send future reminders.
- Duplicate reminders are not created.

### E2E/manual verification

- Unlock product.
- Check reminder row exists.
- Adjust seed/reminder date to due.
- Trigger cron manually with secret.
- Confirm status is sent and email stub/log exists.

### Done evidence

- Database check before/after cron.
- Cron response output.
- Email log/stub evidence.

---

## Slice 18 - Analytics and business events

### Goal

Track product success without violating consent choices.

### Product capability

Owner can measure registrations, unlocks, downloads, Amazon clicks, and consented analytics.

### Implementation

- Analytics helper.
- GA4 only after analytics consent.
- Custom event calls.
- Database-backed critical events where needed.
- Admin-visible simple counts if easy.

### TDD/unit tests

- Test analytics helper respects consent.
- Test event payload builders.
- Test required business event names.

### Integration tests

- Unlock creates business event/row where applicable.
- Download creates `download_events`.
- Amazon click emits event.

### E2E/manual verification

- Reject analytics and confirm GA4 script absent.
- Accept analytics and confirm GA4 script present.
- Trigger Amazon click/download/unlock and inspect event behavior.

### Done evidence

- Browser inspection screenshot or Playwright assertion.
- Database event/download row check.
- Test output.

---

## Slice 19 - SEO, sitemap, robots, and production metadata

### Goal

Make the public site indexable and shareable.

### Product capability

Published products have correct metadata, sitemap entries, and social previews.

### Implementation

- Metadata generation for home/catalog/product/static pages.
- Open Graph data.
- Structured data for products/books.
- Sitemap.
- Robots.txt.
- Noindex for private/auth/admin/download surfaces.

### TDD/unit tests

- Test metadata fallback.
- Test canonical URL builder.
- Test sitemap includes published products only.
- Test robots/noindex policy helpers.

### Integration tests

- Sitemap endpoint returns published products.
- Draft/archived products are excluded.
- Product metadata includes expected title/description.

### E2E/manual verification

- Inspect product page metadata.
- Open sitemap.
- Confirm private routes are not indexable.

### Done evidence

- Test output.
- Screenshot/HTML inspection summary.
- Sitemap output sample.

---

## Slice 20 - Responsive UI polish and production readiness

### Goal

Close the product for first production use.

### Product capability

The full core journey works smoothly on desktop and mobile.

### Implementation

- Fix visual issues.
- Improve loading/empty/error states.
- Add accessibility basics.
- Review copy.
- Check mobile layout.
- Configure production env docs.
- Final seed/launch checklist.

### TDD/unit tests

- Add unit tests only for any new logic discovered during polish.
- Avoid snapshot-heavy visual tests unless they catch real regressions.

### Integration tests

- Run full integration suite.
- Validate migrations from clean database.

### E2E/manual verification

Run full manual and automated smoke:

- Home.
- Catalog search/filter.
- Product page.
- Register/login.
- QR unlock.
- Premium download.
- My Library.
- Admin create/publish product.
- Admin upload media.
- Admin export CSV.
- Privacy/Terms/contact.
- Cookie consent.

Check desktop and mobile.

### Done evidence

- Full E2E output.
- Final screenshots for core pages.
- Database checks for unlock/download/reminder.
- Production readiness checklist completed.

---

# 5. Definition of Done Per Slice

Every slice must satisfy:

- All new unit tests pass.
- Existing test suite passes.
- Integration tests pass for touched data/auth/storage paths.
- E2E or manual verification is completed.
- Evidence is captured.
- No known critical regression remains.
- Source of truth is updated if implementation reveals a necessary decision change.

---

# 6. Minimum Evidence Log Format

Use this format in commits, PR notes, or a future progress document:

```md
## Slice X - Name

Status: done

Automated tests:
- Unit: pass
- Integration: pass
- E2E: pass/manual pass

Manual evidence:
- Screenshot: path/to/screenshot.png
- Database check: table/row verified
- Storage check: object/path verified

Notes:
- ...
```

---

# 7. Suggested First Implementation Order

1. Slice 0 - Project bootstrap and quality gates.
2. Slice 1 - Database foundation with seed product.
3. Slice 2 - Public home page and brand segmentation.
4. Slice 3 - Public catalog with filtering, sorting, and search.
5. Slice 4 - Product detail page with SEO and Amazon link tracking.
6. Slice 5 - Auth: unlock-context registration, login, logout, reset password.
7. Slice 6 - Email verification gate.
8. Slice 7 - Manual premium code unlock.
9. Slice 8 - QR code unlock flow through auth.
10. Slice 9 - Premium downloads with signed URLs.
11. Slice 10 - My Library.
12. Slice 11 - Admin access guard and dashboard shell.
13. Slice 12 - Admin product CRUD, translations, and publish flow.
14. Slice 13 - Admin taxonomy and Amazon links.
15. Slice 14 - Admin media and premium file upload.
16. Slice 15 - Admin users and email export.
17. Slice 16 - Static pages, contact form, and legal consent.
18. Slice 17 - Review reminder system.
19. Slice 18 - Analytics and business events.
20. Slice 19 - SEO, sitemap, robots, and production metadata.
21. Slice 20 - Responsive UI polish and production readiness.

This order intentionally reaches the public customer journey before expanding admin complexity, then returns to admin capabilities once the core product path is proven.

---

# 8. Notes for Implementation Discipline

- Do not write all tests upfront.
- Do not build all UI screens before connecting them to data.
- Do not create large abstractions before the second or third concrete use.
- Prefer one behavior test, then one implementation step.
- Refactor only when green.
- Keep each slice releasable or at least demonstrable.
- When a slice touches security or access control, include a negative test.
- When a slice creates data, verify the database.
- When a slice touches UI, verify with browser screenshots.
- When a slice touches storage, verify both object existence and access denial/allow behavior.
 
---

# 9. Admin CRUD Slice Update - 2026-05-31

The audit and implementation described in `docs/admin-crud-gap-audit.md` closed the major local admin CRUD gaps earlier than the original milestone order:

- Slice 12 product CRUD is implemented for local demo/content-store mode.
- Slice 13 taxonomy and Amazon link management is implemented for local demo/content-store mode.
- The metadata side of Slice 14 is implemented: admin can define cover/gallery/video/public download/premium download asset rows and the app enforces the public vs premium visibility classification.
- Binary upload to Supabase Storage remains the next storage-specific slice.
- Production Supabase activation remains a separate hardening slice because the connected remote project currently has no public tables and the app still uses demo-cookie auth for local flows.
