# Coloring Club — implementation contract

Status: accepted P0 specification, 2026-10-25  
Canonical product source: `LamiliaLomi_SOURCE_OF_TRUTH.md` §32

This contract supersedes older “no community” and PL/DE/ES public-routing statements. Public storefront routing is EN-only; admin is Polish. Existing product translations and data remain preserved. Community work must leave premium unlocks, product media, the admin-curated `product_reader_artworks` table, and the product “Look Inside” experience intact.

## Product and routes

- `/en/club`: anonymous approved-artwork gallery; filters by published book and audience (Kids/Adults) plus safe sort (recent/popular); no social feed.
- `/en/club/artworks/[id]`: approved artwork detail and creator link.
- `/en/club/creators/[username]`: public creator profile and that creator’s approved work only.
- `/en/library/creations`: signed-in member’s own submissions and statuses.
- `/en/account`: member’s private club settings, opt-in/rules status, and leave-club action.
- `/admin/community`: Polish moderation queue, detail drawer, report queue, and audit history.
- Product detail: one “Colored by Our Readers” community section integrated with the existing curated reader gallery. Keep “Look Inside” separate and unchanged. Do not duplicate the community heading.

All routes and underlying data/media access are gated server-side. Anonymous visitors may read approved public projections when the public flag is on. A disabled or unavailable feature responds as unavailable (404 for public routes/media; 404 or feature-disabled response for authenticated mutations), with no data leakage.

## Authorization matrix

| Capability | Anonymous | Signed-in, unverified/non-member | Verified opted-in member | Admin |
| --- | --- | --- | --- | --- |
| Read approved gallery/detail/profile | Yes, public flag ON | Yes, public flag ON | Yes, public flag ON | Yes |
| Read pending/rejected/removed or private media | No | No | Own records/status only; never via public URL | Authorized moderation view only |
| Join/leave club, set username | No | Must verify email; adult opt-in and rules acceptance required | Manage own profile/consent | Admin support via audited server action only |
| Submit artwork | No | No | Upload flag ON, verified email, active opt-in, current rules accepted, relevant published product unlocked | No author impersonation |
| Edit own description/delete own work | No | No | Own submission only; status rules below | Moderation action only |
| Like approved work | No | No | Yes, no book unlock requirement | Same eligible-member rule |
| Report approved work | No | Authenticated account required | Yes | Review/resolve; cannot alter report authorship |
| Approve/reject/remove | No | No | No | Admin role, server checked; reason required for reject/remove |

Never expose auth UUIDs, email, unlock history, private object paths, reports, report reasons, internal moderation reasons, or moderation event details in public projections. Public creator identifier is username only. Owner projections may include own status and rejection reason. Admin projections may include private moderation/report data.

## Participation and username policy

A member must be authenticated, have verified email, self-attest that they are an adult, opt into the community, and accept the current rules version. Store opt-in and acceptance timestamps plus accepted rules version; revocation prevents new submissions and likes. Submission requires the member to own an unlock for the selected currently published product. Existing data is preserved if a product later archives, while its community work becomes non-public until policy permits again.

Username format is unique `@username`, 3–24 ASCII lowercase characters matching `[a-z0-9_]{3,24}`. Normalize case before uniqueness checks and enforce uniqueness in the database to handle races. Reject reserved route, staff, and impersonation names (including `admin`, `administrator`, `support`, `help`, `official`, `lamilialomi`, `api`, `club`, `creators`, and localized equivalents). No emails, display-name free text, or avatar uploads. Avatar is deterministic/generated from a safe profile seed.

## Artwork state and revision transitions

States: `pending`, `approved`, `rejected`, `removed`.

```text
new submission -> pending
pending --admin approve--> approved
pending --admin reject + reason--> rejected
pending --owner edits description--> pending (new revision)
approved --owner edits description--> pending (publicly hidden immediately; new revision)
approved --admin removes + reason--> removed
rejected --owner edits/resubmits--> pending (new revision)
removed --admin restores explicitly--> pending
pending/rejected/removed --owner deletes--> deleted_at set (terminal tombstone)
approved --owner deletes--> deleted_at set (publicly hidden immediately; terminal tombstone)
```

Only an admin can approve, reject, remove, or restore. Every moderation decision is an atomic status/revision compare-and-set with actor and timestamp audit event; stale concurrent actions fail and reload current state. Owners may edit/resubmit descriptions only while pending, approved, or rejected; edits to approved or rejected work create a new revision and return it to pending. Removed work stays removed unless an admin explicitly restores it; the author cannot edit it back into review. Admin decisions apply to the revision reviewed. Rejection/removal reasons are visible to the author and admins, but never public. Removal and deletion immediately revoke public reads and media delivery; deletion sets a terminal `deleted_at` tombstone, schedules storage cleanup, and retains only the minimum audit metadata required by policy. Owner receives status notification best-effort; notification failure never rolls back a valid decision.

## Data and API sketch

Implementation may adapt names to existing migration conventions, while preserving these boundaries. Community tables are additive and do not repurpose `product_reader_artworks`.

- `community_profiles`: `user_id` (auth FK, private), unique normalized `username`, generated `avatar_seed`, adult opt-in/timestamp, `participation_revoked_at`, `suspended_at`, rules version/acceptance timestamp, created/updated timestamps.
- `community_artworks`: UUID, `author_id` (private auth FK), `product_id`, private object key, description, status, revision, `deleted_at`, timestamps, moderation reason, approved timestamp; checks for allowed status and valid ownership. `deleted_at` is a terminal tombstone and is not an additional moderation status.
- `community_moderation_events`: artwork/revision, actor, from/to status, private reason, timestamp; admin-readable only.
- Later slices add `community_artwork_likes` with unique `(artwork_id,user_id)` and private `community_artwork_reports` with constrained reason/status and dedupe/rate controls.

RLS defaults deny. Public SQL/view/API projection returns only approved rows for published products and excludes all private fields. Owner policies permit only own profile, own artwork metadata/status, own edits and deletion; owner cannot set author, storage key, status, moderation reason, counters, or approval fields. Admin checks use trusted server-side role. Do not grant clients direct state transitions or raw Storage reads.

Proposed server APIs/actions: `GET /api/community/artworks` (approved projection/filter/page); `GET /api/community/artworks/[id]`; `GET /api/community/creators/[username]`; authenticated `POST /api/community/join`, `PATCH /api/community/profile`, `POST /api/community/uploads`, `PATCH /api/community/artworks/[id]`, `DELETE /api/community/artworks/[id]`; member `POST/DELETE /api/community/artworks/[id]/heart`, `POST /api/community/artworks/[id]/reports`; admin `POST /api/admin/community/artworks/[id]/approve|reject|remove|restore`, report resolution, and private media read. All mutations validate session, email verification, current opt-in/rules, ownership, product publication/unlock as applicable, flag state, schema, rate limit, and CSRF/origin protections where applicable.

## Media lifecycle and privacy

Uploads use private storage and opaque server-generated object keys. Pending/rejected/removed objects have no stable public URL and are unavailable through storage provider URLs, CDN, image optimization endpoints, and caches. Approved image bytes are served only by an application media route that checks current artwork status, published product, suspension/consent state, and feature flag on every request, then streams bytes from private storage. Every response is private and `no-store`. Never disclose provider object URLs or signed URLs to browsers or public projections; provider signed URLs, if used, are internal to the server fetch only. Do not use a CDN or cache for these bytes. This ensures every read after removal/rejection/product archive is denied immediately even if object deletion is delayed. No cache purge can substitute for the per-request status gate.

Validate actual bytes, allowed JPG/PNG/WebP formats and decoded dimensions; enforce 4 MiB per image and batch maximum three. Decode/re-encode and strip EXIF/GPS; store normalized output only. Safe generated key; no user-supplied path. Upload flow reserves an idempotency key, creates private object, then pending row; retries return the same submission. On any failed row write, compensate by deleting uploaded object. A cleanup job removes expired reservations/orphaned objects. Avoid duplicate records on retry and report cleanup failure operationally without exposing private paths.

Public projection is allow-listed: artwork id, approved image delivery URL/route, description, safe product id/title/slug, creator username/generated avatar, approved timestamp, and aggregate heart count. It never includes auth UUID, email, storage key, rejection/removal reason, report data, unlock history, or audit events. Owner projection contains own status and private rejection reason as permitted; admin projection contains required private moderation data.

## Hearts, reports, notifications, deletion, abuse controls

Hearts are one per opted-in verified member per artwork, unique at database level, toggleable atomically, and allowed without a product unlock. Counter derives from rows or a transactionally maintained safe aggregate. Popular sorting uses approved public items only; no child rankings.

Reports require authenticated users and a constrained reason plus optional short text. Report data is private to admins and reporter receipt; never expose reporter identity/reason publicly. Deduplicate repeat reports and apply server-side per-account/IP rate limits to uploads, hearts, and reports. Admin action is auditable. Email notifications are best-effort and cannot determine moderation success.

Account deletion or opt-out removes public visibility immediately. Product/artwork deletion revokes media before asynchronous object cleanup. Keep minimal non-identifying audit data only where retention policy requires it. Add security events/metrics for rate limits and cleanup failures without logging image bytes, emails, or private report text.

## UX and accessibility contract

Mobile-first layouts at 390px, 768px, and 1440px. Gallery composition follows `docs/design/coloring-club/README.md` and its ten reference screenshots: photo-first two-column grid at 390px when image and creator metadata fit, falling back to one column for constrained/empty/detailed states; two or three columns at 768px; four columns at 1440px in a readable max-width container. Filters use compact visible controls or a labeled mobile sheet, with no horizontal page scroll. Detail/profile use balanced image-and-metadata layouts. Cards use stable image aspect ratio, lazy loading, clear creator/book labels, and explicit loading/empty/error states. Empty gallery explains how approved work appears; empty My Creations links to join/upload when eligible; errors provide retry without implying publication. Artwork detail and creator profile keep essential metadata usable at all widths. Upload flow supports up to three independent previews, file-specific validation, progress/retry, clear pending status, and keyboard-accessible remove/edit actions. Admin moderation uses a queue plus preview/actions on desktop and a single scrolling full-screen flow on mobile; focus is trapped/restored, decisions require clear labels, and rejection/removal reason is required before submit.

Use semantic headings, alt text, visible focus, keyboard operation, labels and error associations, sufficient contrast, reduced-motion support, and status announcements. Do not convey status by color alone. Screen-reader names describe heart state and count; dialogs announce title and errors.

Before any future UI edits, inspect all ten PNG references listed in that README. Treat them as composition guidance; issue behavior, privacy, and backend authorization rules remain authoritative.

Suggested member copy: EN “Join the Coloring Club”, “Only adults can join”, “Your artwork is private until approved”, “Pending review”, “Your description changed. This artwork is pending review again.”; PL admin: “Społeczność”, “Oczekujące prace”, “Zatwierdź”, “Odrzuć”, “Powód decyzji (widoczny dla autora i zespołu)”.

## SEO, launch gates, feature flags

Index only approved gallery/detail/profile pages when public flag is on. Use canonical EN URLs and safe creator usernames; noindex private member/admin routes and all non-approved detail routes. Do not include private media URLs in metadata, sitemap, structured data, or social cards. Takedown must immediately stop route and image delivery and remove/invalidate indexable metadata.

Server-only switches: `COLORING_CLUB_PUBLIC_ENABLED` and `COLORING_CLUB_UPLOADS_ENABLED`; exact string `true` enables, every other value including absent/empty/malformed is false. Default both OFF in every environment. Public flag gates pages, API reads, product integration, and media. Upload flag gates upload initiation and mutation endpoints; it does not independently make content public. The flags module imports `server-only` and must not be imported by client/shared config. UI hiding is supplementary; every server path enforces flags.

Public launch readiness is not established by this spec. Keep public feature OFF until owner confirms readiness after the completed authorization/RLS, moderation, takedown/cache, abuse, and operational paths are verified and legal/privacy/child-safety terms have been reviewed by the appropriate owner/advisor. Do not claim professional legal review or compliance without evidence. Uploads remain OFF until upload validation/storage cleanup and moderation are operational.

## P0 order and exclusions

1. #78 spec/UX/server flags.
2. #79 additive community schema, RLS, repository.
3. #80 usernames, adult opt-in, profiles.
4. #81 uploads and My Creations.
5. #82 admin moderation.
6. #83 public gallery/profile/product integration.
7. #84 hearts.
8. #85 reports, notifications, deletion, rate limits, release/security verification.

#86–#90 are out of scope. Also excluded: comments, messaging, follower systems, child accounts/participation, user avatar uploads, public pending media, changes to premium entitlement, modification/migration of admin-curated artworks, community feed, and restoring PL/DE/ES public routing.

## PR #70 overlap and release notes

PR #70 overlaps `next.config.ts`, the media route, content repository, and product image gallery. CC-00 does not edit those files. Later community integration must be reconciled against the actual merged/base version of PR #70 before touching those seams; do not merge PR #70 as part of CC-00. Community database changes must be additive, tested on local/Stage PostgreSQL, and keep existing application reads compatible. Public and upload flags remain OFF until the corresponding gated runtime is verified. The linked Supabase project verified for this run is `ebyhoawczbexwtioywuk` (22 applied migrations, 20 public tables); check current migration history again before any schema deployment.
