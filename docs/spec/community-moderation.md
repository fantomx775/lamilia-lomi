# Community moderation

The Polish admin queue is available at `/admin/community`, including while public gallery and upload flags are off. Every API request resolves the current signed-in user and database-backed role. Admin operations use the existing service-only repository and moderation RPC; UI state never sets an artwork status directly.

## Admin API

- `GET /api/admin/community/artworks` accepts `status`, `productId`, `creator`, `cursor`, and `limit` (maximum 50). It returns an allowlisted page, an opaque keyset cursor, and status counts. Counts are bounded database count queries and do not load artwork rows into the application.
- `GET /api/admin/community/artworks/:id` returns the owner-safe artwork projection and at most 100 append-only history entries. History uses a generic `Administrator` label; it never returns the moderator UUID or account email.
- `POST /api/admin/community/artworks/:id/moderation` accepts only `{ action, revision, reason? }`. Reject and remove require a trimmed 1–500 character reason. The server verifies the current admin role, then the database checks the expected revision and allowed status transition atomically.

The preview uses the private media route directly, never the Next image optimizer or a provider URL. Each request rechecks current authorization and publication eligibility; responses are private and non-cacheable. Removal and edits therefore hide public bytes without waiting for a CDN purge.

The list and history projections exclude auth UUIDs, email, storage paths, provider details, and internal moderation actor IDs. Existing curated `product_reader_artworks` remains separate from the community queue.
