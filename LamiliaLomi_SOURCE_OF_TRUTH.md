# LamiliaLomi - Source of Truth for Implementation

Status: accepted for implementation
Date: 2026-05-31

This document is the canonical implementation source of truth for the first full-product iteration of LamiliaLomi. It supersedes the previous working notes and question checklist. Earlier documents remain useful as historical context, but product and technical decisions should be implemented according to this file.

---

# 1. Product Goal

LamiliaLomi is a content platform supporting Amazon KDP sales, brand building, and mailing list growth.

The core customer journey is:

1. A customer buys or receives a physical book.
2. The customer scans a QR code inside the book.
3. The customer lands on the product page.
4. The customer creates an account or logs in.
5. The customer unlocks premium content for that specific product.
6. The customer downloads bonus materials and can return later through their library.
7. The admin can manage products, files, premium codes, users, and mailing exports without developer help.

Success for the first iteration means this full journey works in production.

---

# 2. First Iteration Scope

The first iteration should attempt to deliver the full small product, not a reduced MVP. Work should still be implemented in internal milestones so the app remains runnable throughout development.

## Must-have

- Next.js App Router application.
- Vercel hosting.
- Supabase Auth, Database, and Storage.
- Public product catalog.
- Product detail page with gallery, video, Amazon link, and premium CTA.
- Registration, login, email verification, password reset.
- Premium unlock by code and QR URL per product.
- Private premium files served through signed URLs.
- Polish admin panel under `/admin`.
- Admin management for products, translations, categories, tags, media, premium files, premium codes, users, and email export.
- Frontend in English and Polish.
- SEO basics: metadata, Open Graph, sitemap, robots.txt, structured data where useful.
- Privacy, Terms, and cookie consent.
- Resend for system emails.

## Should-have

- Review reminder email after configurable delay.
- GA4 plus custom business events.
- User "My Library" page.
- Manual ordering for products and galleries.
- Simple admin editing for static pages.

## Could-have

- Product import from CSV/XLSX.
- Advanced admin analytics.
- Multiple codes per product beyond the initial shared-code model.
- German language version.
- Automatic Amazon geotargeting.

## Explicitly out of scope

- Payments.
- Subscriptions.
- Marketplace functionality.
- User reviews hosted on the site.
- Comments/community features.
- AI content generation.
- Complex CMS/page builder.
- Advanced coupon system beyond premium unlock codes.

---

# 3. Product Segments and Navigation

The brand has two main audience worlds:

- Kids.
- Adults.

This should be modeled as a product audience/segment, not as a replacement for product type. Product types remain separate.

Recommended product type examples:

- Coloring books.
- Picture books.
- Audiobooks.

The home page should immediately communicate the LamiliaLomi brand and give clear entry into Kids and Adults, with real product covers visible in the first experience.

---

# 4. User Roles and Access Model

## Guest

A guest can:

- Browse published products.
- Browse categories and tags.
- Search products.
- View public product information.
- View public gallery/media.
- Watch public flipthrough video.
- Click Amazon affiliate links.

A guest cannot:

- Download protected files.
- Access premium materials.
- Access user library.
- Access admin.

## Registered User

A registered user can:

- Log in with email and password.
- Verify email address.
- Reset password.
- View public product content.
- Unlock premium content using a product code.
- Download unlocked premium files.
- See their unlocked products in "My Library".

## Premium Access

Premium is not a global user role. Premium access is stored per user and per product.

One product unlock gives access only to the premium materials for that product.

## Admin

The first version has one admin user, but the system should support future admins through a `role` field.

Admin can:

- Manage products.
- Manage product translations.
- Manage categories and tags.
- Manage media and files.
- Manage premium codes.
- View users.
- View user unlocks.
- Export emails.
- Configure review reminder delay per product.
- Edit static pages in a simple Markdown/text editor if implemented in the first iteration.

---

# 5. Main User Flows

## QR to Premium Unlock

1. User scans a QR code inside a physical book.
2. QR opens a product URL with a code parameter, for example:

   `/en/products/my-book?code=LOMI-BOOK-2026`

3. User lands on the product page.
4. If not logged in, user is prompted to register or log in.
5. The code from the URL is preserved through auth.
6. After login and email verification, the product unlock is completed or shown as a prefilled confirmation action.
7. Unlock is stored permanently for that user/product.
8. User can download premium files.

## Manual Code Unlock

Users can also manually enter a code on the product page.

Codes should be case-insensitive and friendly to type.

## Returning User

1. User logs in.
2. User opens "My Library".
3. User sees unlocked products.
4. User opens a product and downloads premium files again.

Downloads are not limited.

---

# 6. Product Model

Published products should have at least one complete English translation and at least one Amazon link.

Products should support draft and archived states.

## Product fields

Minimum product fields:

- Internal ID.
- Slug.
- Status: `draft`, `published`, `archived`.
- Audience: `kids`, `adults`, or future values.
- Product type.
- Categories.
- Tags.
- Cover image.
- Gallery images.
- Public flipthrough video.
- Public/basic downloads if needed.
- Premium downloads.
- Amazon links per market.
- SEO metadata.
- Manual sort order.
- Created/updated timestamps.

## Product translations

Translatable fields:

- Title.
- Short description.
- Long description.
- SEO title.
- SEO description.

English is the primary language. Polish is the second language. Missing Polish content can fall back to English.

## Product statuses

- `draft`: visible only to admin.
- `published`: visible publicly.
- `archived`: hidden from normal catalog but retained in the database.

---

# 7. Amazon Links

Supported Amazon markets at launch:

- `amazon.com`.
- `amazon.de`.

The data model should allow more markets later.

Published products should have at least one Amazon link.

Default behavior:

- Show the primary `amazon.com` link.
- Optionally show market choices if multiple links exist.
- Do not implement automatic geotargeting in the first version.

Amazon link clicks should be tracked as analytics events.

---

# 8. Premium Content

Premium content is assigned to a specific product.

Supported file types:

- PDF as the primary format.
- JPG/PNG/WebP for bonus coloring pages if needed.

Premium files live in private storage and are accessed via short-lived signed URLs after access checks.

Download count is not limited, but downloads should be tracked.

---

# 9. Admin Panel

Admin panel path:

- `/admin`

Admin panel language:

- Polish.

## Admin must support

- Product list.
- Create/edit product.
- Draft/publish/archive product.
- Manage EN/PL product translations.
- Manage categories.
- Manage tags.
- Upload cover image.
- Upload/reorder gallery images.
- Upload public video.
- Upload premium files.
- Manage Amazon links.
- Manage premium code per product.
- View users.
- View user unlocks.
- Export email list to CSV.
- Configure review reminder delay per product.

## Admin should support

- Manual product ordering.
- Manual gallery ordering.
- Static page editing for Privacy and Terms using a simple Markdown/text field.

No complex page builder is needed.

---

# 10. Internationalization

Frontend locales:

- `en` as default.
- `pl` as secondary.

Routing:

- `/en/...`
- `/pl/...`

Language behavior:

- Detect browser language on first visit.
- Store preferred language in a cookie.
- Provide a manual language selector in the header.
- Fall back to English when Polish translation is missing.

Admin:

- Polish only.
- Admin does not need locale routing.

---

# 11. SEO

SEO is required from the first version.

Implement:

- SSR through Next.js App Router.
- Metadata per page.
- Product metadata per locale.
- Open Graph images/metadata.
- Canonical URLs.
- Sitemap.
- Robots.txt.
- Structured data where useful, especially `Product` or `Book`.

Admin should be able to edit SEO title and description per product per language.

If SEO fields are empty, generate fallback metadata from product title and description.

Private premium download URLs and authenticated pages should not be indexed.

---

# 12. Email

Email provider:

- Resend.

Emails to support:

- Email verification.
- Password reset.
- Product unlock confirmation.
- Review reminder.
- Contact form notification to the author.

Tone:

- Warm.
- Calm.
- Premium.
- Helpful.
- Not pushy.

Review reminder:

- One reminder per user per product.
- Delay configurable by admin per product.
- Recommended default delay: 14 days after unlock.
- Reminder links to the product's Amazon page.

---

# 13. Legal, Consent, and Privacy

Legal pages:

- `/privacy`
- `/terms`

These can be simple static/admin-editable pages in the first version.

Consent model:

- Terms/privacy acceptance is required to create an account.
- Marketing consent should be a separate checkbox.
- Marketing consent should not be checked by default.
- Marketing consent should be stored on the user profile.

Important legal note:

- Do not force marketing consent as a condition of account creation unless this has been explicitly reviewed legally. The recommended implementation separates required account consent from optional marketing consent.

Cookie consent:

- Required if GA4 or analytics cookies are used.
- Support at least essential and analytics consent.
- Load GA4 only after analytics consent.

---

# 14. Analytics

Analytics tools:

- GA4.
- Custom events.

GA4 should load only after cookie consent for analytics.

Track these events:

- Page view.
- Amazon link click.
- Registration.
- Email verification success.
- Unlock success.
- Unlock failure.
- Premium file download.
- Video play.
- Contact form submit.
- Language change.

Business metrics:

- Number of registrations.
- Number of verified users.
- Number of product unlocks.
- QR to account conversion.
- Account to download conversion.
- Amazon clicks.
- Marketing consents.
- Premium downloads.

Critical business events such as unlocks and downloads should also be represented in the database where useful.

---

# 15. Visual Direction

Style:

- Calm.
- Feminine.
- Premium.
- Creative.
- Mobile-first.

Visual palette:

- Off-white base.
- Earthy pastels.
- Sage.
- Terracotta.
- Dusty pink.

UI feel:

- Soft shadows.
- Rounded corners.
- Elegant typography.
- Spacious layout.
- No aggressive popups.
- No distracting header social links.

Social links:

- Footer.
- Author page.

Home page:

- Brand/product signal visible immediately.
- Real product covers or product imagery should be visible early.
- Entry into Kids/Adults should be clear.

---

# 16. Technical Architecture

Application:

- Next.js App Router.
- One application for public frontend, authenticated user area, API routes, and admin.
- Hosted on Vercel.

Backend:

- Supabase Database.
- Supabase Auth.
- Supabase Storage.
- Server Actions for form mutations and admin operations.
- Route Handlers for signed URLs, cron, webhooks, and technical endpoints.

Email:

- Resend.

i18n:

- `next-intl`.

Analytics:

- GA4 after consent.

Search:

- PostgreSQL full-text search.

---

# 17. Suggested Route Map

Public:

- `/`
- `/en`
- `/pl`
- `/[locale]/products`
- `/[locale]/products/[slug]`
- `/[locale]/categories/[slug]`
- `/[locale]/tags/[slug]`
- `/[locale]/author`
- `/[locale]/privacy`
- `/[locale]/terms`
- `/[locale]/contact`

Auth:

- `/[locale]/login`
- `/[locale]/register`
- `/[locale]/reset-password`
- `/[locale]/auth/callback`

User:

- `/[locale]/library`
- `/[locale]/account`

Admin:

- `/admin`
- `/admin/products`
- `/admin/products/new`
- `/admin/products/[id]`
- `/admin/categories`
- `/admin/tags`
- `/admin/users`
- `/admin/pages`
- `/admin/settings`

API/Route handlers:

- `/api/downloads/[assetId]`
- `/api/contact`
- `/api/cron/review-reminders`

Exact route names can change during implementation if the architecture needs it, but the capabilities should remain.

---

# 18. Database Model

The exact migration can evolve, but the implementation should start from this model.

## `profiles`

- `id` UUID, references `auth.users.id`.
- `email` text.
- `role` text: `user` or `admin`.
- `marketing_consent` boolean.
- `terms_accepted_at` timestamptz.
- `preferred_locale` text.
- `created_at` timestamptz.
- `updated_at` timestamptz.

## `products`

- `id` UUID.
- `slug` text unique.
- `status` text: `draft`, `published`, `archived`.
- `audience` text.
- `product_type` text.
- `cover_asset_id` UUID nullable.
- `video_asset_id` UUID nullable.
- `review_delay_days` integer default 14.
- `sort_order` integer.
- `created_at` timestamptz.
- `updated_at` timestamptz.

## `product_translations`

- `id` UUID.
- `product_id` UUID.
- `locale` text.
- `title` text.
- `short_description` text.
- `long_description` text.
- `seo_title` text nullable.
- `seo_description` text nullable.
- Unique: `product_id`, `locale`.

## `categories`

- `id` UUID.
- `slug` text unique.
- `sort_order` integer.
- `created_at` timestamptz.

## `category_translations`

- `id` UUID.
- `category_id` UUID.
- `locale` text.
- `name` text.
- `description` text nullable.
- Unique: `category_id`, `locale`.

## `tags`

- `id` UUID.
- `slug` text unique.
- `created_at` timestamptz.

## `tag_translations`

- `id` UUID.
- `tag_id` UUID.
- `locale` text.
- `name` text.
- Unique: `tag_id`, `locale`.

## `product_categories`

- `product_id` UUID.
- `category_id` UUID.
- Primary key: `product_id`, `category_id`.

## `product_tags`

- `product_id` UUID.
- `tag_id` UUID.
- Primary key: `product_id`, `tag_id`.

## `product_assets`

- `id` UUID.
- `product_id` UUID.
- `kind` text: `cover`, `gallery`, `video`, `public_download`, `premium_download`.
- `bucket` text.
- `path` text.
- `filename` text.
- `content_type` text.
- `size_bytes` bigint nullable.
- `locale` text nullable.
- `title` text nullable.
- `sort_order` integer.
- `is_public` boolean.
- `created_at` timestamptz.

## `amazon_links`

- `id` UUID.
- `product_id` UUID.
- `market` text, for example `amazon.com`.
- `url` text.
- `is_primary` boolean.
- `created_at` timestamptz.

## `premium_codes`

- `id` UUID.
- `product_id` UUID.
- `code` text unique.
- `active` boolean default true.
- `created_at` timestamptz.

There should be one shared code per product in the first version, but this table allows expansion later.

## `user_product_unlocks`

- `id` UUID.
- `user_id` UUID references `auth.users.id`.
- `product_id` UUID.
- `premium_code_id` UUID nullable.
- `unlocked_at` timestamptz.
- Unique: `user_id`, `product_id`.

## `download_events`

- `id` UUID.
- `user_id` UUID.
- `product_id` UUID.
- `asset_id` UUID.
- `created_at` timestamptz.

## `review_reminders`

- `id` UUID.
- `user_id` UUID.
- `product_id` UUID.
- `scheduled_for` timestamptz.
- `status` text: `pending`, `sent`, `failed`, `cancelled`.
- `sent_at` timestamptz nullable.
- `last_error` text nullable.
- Unique: `user_id`, `product_id`.

## `static_pages`

- `id` UUID.
- `slug` text.
- `locale` text.
- `title` text.
- `body` text.
- `updated_at` timestamptz.
- Unique: `slug`, `locale`.

---

# 19. Auth and Authorization

Auth provider:

- Supabase Auth.

Auth methods:

- Email/password.
- Email verification required.
- Password reset required.

Profile creation:

- Create a `profiles` record for each auth user.
- Recommended implementation: Supabase trigger for consistency.

Admin:

- Admin identified through `profiles.role = 'admin'`.
- First admin can be assigned manually in Supabase or through a seed script.

---

# 20. RLS and Storage Security

RLS should be enabled for application tables.

Public read:

- Published products.
- Published translations.
- Categories.
- Tags.
- Public assets metadata.
- Public Amazon links.

User read:

- Own profile.
- Own unlocks.
- Own library data.

Admin read/write:

- All product/admin-managed content.
- Users/profile overview.
- Unlocks.
- Reminder records.

Premium downloads:

- Premium files must not be public.
- Server checks `user_product_unlocks`.
- Server generates a signed URL with short TTL.
- Download event is logged.

Wrong-code attempts:

- Track as analytics event.
- Optional database table can be added later if abuse monitoring is needed.

---

# 21. Storage

Recommended buckets:

- `public-media` for covers and gallery images.
- `public-videos` or `videos` for flipthrough videos.
- `premium-files` as a private bucket for PDFs and premium assets.

Signed URL TTL:

- 5 to 15 minutes.

Admin should upload files directly from the admin panel.

Supabase Storage is accepted for video hosting in the first version. File sizes and transfer costs should be monitored.

---

# 22. Codes and QR

Code format:

- Human-readable.
- Case-insensitive.
- Example: `LOMI-BOOK-2026`.

QR URL format:

- `/en/products/[slug]?code=[CODE]`

Code behavior:

- One shared code per product.
- Many users can use the same code.
- Code unlock is permanent for that user/product.
- Code has an `active` field for emergency deactivation, even though printed codes are intended to remain valid.

---

# 23. Search and Filtering

Search engine:

- PostgreSQL full-text search.

Search scope:

- Product title.
- Product description.
- Tags.
- Categories.

Search should work in the active locale with fallback to English.

Filtering:

- Product type.
- Audience.
- Category.
- Tag.

Sorting:

- Newest.
- A-Z.
- Manual sort order.

Filtering and search should be server-side.

---

# 24. Review Reminder System

Review reminders should be included if time allows in the first full iteration.

Behavior:

1. User unlocks a product.
2. App creates `review_reminders` record.
3. `scheduled_for` is based on product `review_delay_days`.
4. Vercel Cron runs once daily.
5. Cron sends due reminders through Resend.
6. Reminder is marked `sent`.

Duplicate prevention:

- Unique constraint on `user_id`, `product_id`.
- Status fields prevent duplicate sends.

---

# 25. Environment Variables

Expected environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `NEXT_PUBLIC_GA4_ID`
- `NEXT_PUBLIC_APP_URL`
- `CRON_SECRET`
- `ADMIN_SEED_EMAIL`
- `AMAZON_TRACKING_ID_US`
- `AMAZON_TRACKING_ID_DE`

Names can be adjusted to match implementation conventions.

---

# 26. Deployment

Required services:

- Vercel project.
- Supabase project.
- Resend account and verified sending domain.
- GA4 property.
- Production domain.
- Amazon Associates tracking IDs.

Environments:

- Local development.
- Production.

Stage environment is recommended if budget and setup time allow, but not mandatory for the small first version.

---

# 27. Seed Data

Seed data should include:

- One admin user/profile.
- Base categories.
- Base tags.
- 3 to 5 sample products.
- At least one complete product with:
  - EN translation.
  - PL translation or EN fallback.
  - Cover.
  - Gallery images.
  - Video.
  - Amazon link.
  - Premium code.
  - Premium PDF.

Production launch should use real product content as soon as available.

---

# 28. Testing and Verification

Required test coverage:

- Premium unlock success.
- Premium unlock failure.
- Access denied for premium file without unlock.
- Signed URL generation only after access check.
- User can see own unlocks.
- Admin access protected.
- RLS policies for core tables.

Recommended E2E flows:

- QR URL -> auth -> unlock -> download.
- Guest cannot download premium file.
- Admin creates product and publishes it.

Browser verification:

- Desktop and mobile.
- Home page.
- Catalog.
- Product page.
- Auth pages.
- Library.
- Admin product form.
- Unlock flow.
- Download flow.

UI verification should check that text does not overlap, buttons fit their labels, and mobile layouts remain usable.

---

# 29. Implementation Milestones

## Milestone 1 - Project foundation

- Next.js setup.
- Styling/design system baseline.
- Supabase client/server integration.
- Auth wiring.
- i18n routing.
- Basic layout.

## Milestone 2 - Data model

- Supabase migrations.
- RLS policies.
- Storage buckets.
- Seed data.

## Milestone 3 - Public catalog

- Home page.
- Catalog.
- Product detail page.
- Search/filter/sort.
- Amazon links.
- SEO metadata.

## Milestone 4 - Auth and user area

- Register/login/logout.
- Email verification.
- Password reset.
- Account page.
- My Library.

## Milestone 5 - Premium unlock

- QR code URL handling.
- Manual code entry.
- Unlock persistence.
- Premium file access checks.
- Signed download URLs.
- Download tracking.

## Milestone 6 - Admin

- Admin guard.
- Product CRUD.
- Translation editing.
- Category/tag management.
- Media upload.
- Premium file upload.
- Premium code management.
- User list.
- Email export.

## Milestone 7 - Emails and reminders

- Resend setup.
- Auth-related emails where applicable.
- Unlock confirmation.
- Contact form.
- Review reminder cron.

## Milestone 8 - Legal, analytics, and polish

- Privacy and Terms.
- Cookie consent.
- GA4.
- Custom events.
- Visual refinement.
- Mobile verification.
- Production readiness.

---

# 30. Owner Inputs Still Needed

These are not unresolved product decisions; they are concrete assets/content needed during implementation.

- Logo.
- Brand colors if already chosen.
- Preferred fonts if already chosen.
- Product covers.
- Product descriptions.
- Product Amazon links.
- Premium PDFs.
- Gallery images.
- Flipthrough videos.
- Author bio.
- Social links.
- Privacy Policy.
- Terms.
- Resend sending domain.
- GA4 ID.
- Amazon Associates tracking IDs.
- Production domain.

Implementation can begin with placeholder/sample data, then swap in final assets before launch.
