# CC-85 lifecycle remediation plan (read-only design)

## Product deletion

Policy: hard deletion is refused whenever *any* `community_artworks` row or `community_upload_reservations` row references the product. The check includes soft-deleted artwork and all reservation states because the database FKs do. Show a conflict that offers the existing archive action. Do not cascade community artwork, reservation, or moderation history. This keeps the book-to-artwork audit relationship and prevents purge of author content as an incidental product operation.

The current wrapper must not remove reader-artwork files/rows or revoke product assets until deletion is known to be eligible. A guard query alone is racy: reserve/finalize takes a product `FOR SHARE` lock, while the delete RPC locks the product `FOR UPDATE`; an upload can insert a reservation after a standalone guard and before the destructive cleanup.

Minimal race-safe hard-delete protocol:

1. Add a durable product deletion marker/lease, set by a service/admin RPC in a transaction that locks the product row. The RPC rejects if *any* community artwork or reservation reference exists. If references exist, return a conflict without changing product state. If clear, set the marker and commit.
2. Make product edits/unarchive and all community create/reserve/finalize paths reject a marked product. They must read/check the marker while holding the product row lock (same lock order as existing product status checks). This serializes in-flight reserve/finalize: if one commits first, the marker RPC sees its FK row and refuses; if marker commits first, the writer sees the marker and refuses. Do not rely only on checking `status = archived`, because an admin could unarchive while storage cleanup is in progress.
3. Only after the marker commits, run the existing external/media sequence: clean reader artwork and product media, revoke public R2 assets, then call a final transactional purge RPC. The final RPC rechecks no community refs, locks the product, and deletes it. If external cleanup fails, keep the marker and retry cleanup; do not reopen uploads/unarchive against partly cleaned assets. A protected retry/resume path should be idempotent.
4. For the simpler dev-stage alternative, disable hard-delete for community-referenced products and instruct admins to archive. The marker is still needed to make hard deletion of an unreferenced product safe against a concurrent upload. Existing `archive_product` has a public-media-revocation precondition, so it is not itself a pre-cleanup deletion fence.

Do not switch `product_id` to `ON DELETE SET NULL` as a shortcut: it loses the historical book association, and does not remove community bytes or handle pending reservations safely.

## Account deletion and durable media cleanup

The current FK graph means direct Auth deletion can cascade profile -> reservations, set artwork author to null, and set moderation actor to null. Those FK actions do not remove objects, and reservation cascade can erase the only persisted storage path. Create a durable cleanup ledger whose rows have no FK to `auth.users`, `community_profiles`, or the reservations being deleted. Store only provider, validated storage key, creation/retry state, and a `not_before` time; unique `(provider, storage_path)` makes enqueue idempotent. Avoid retaining email/username or duplicating author PII in the ledger.

Capture both finalized artwork paths and reservation paths transactionally before cascade removes them. The strongest small implementation is a `BEFORE DELETE` trigger on `community_profiles` that copies keys from artworks and reservations into the independent ledger; this also covers Auth deletion outside the app wrapper. Then let the existing FKs remove the profile/reservations and null artwork/event actor references. Mark authored artwork private/deleted as policy requires, but retain only the approved minimal append-only moderation history. A single mandatory account-deletion RPC is acceptable only if all Auth deletion is proven to go through it; direct Supabase Auth admin deletion otherwise bypasses the capture step.

Respect active upload leases. Reservation currently grants a 10-minute lease and upload/provider operations are bounded to about 60 seconds. A request can be writing bytes outside the DB while account deletion commits, so the ledger job must not delete the deterministic object key immediately. Set `not_before` to at least lease expiry plus the maximum upload/function duration and a safety margin (e.g. 12 minutes from capture); cleanup retries then remove any late successful put. Keep the queue row until object removal succeeds; stale finalize/mark-stored calls fail because the account/profile is gone. Cleanup must be idempotent for both already-missing objects and retries.

The scheduled cleanup endpoint/worker should claim jobs with a short DB lease, delete by provider/key through the existing storage abstraction, and mark completion. Failed storage deletion leaves a retryable row with bounded diagnostics that do not include PII or secrets. Do not delete the cleanup ledger on profile/Auth deletion.

## Local adapter parity

Mirror user-visible semantics in local mode: product deletion refuses when any community row/reservation references the product, while archive remains available; never delete curated/media files before the guard. Persist a local cleanup queue independent of local profile records, capture artwork/reservation storage keys before removing account data, delay active-lease cleanup by the same policy, and retry idempotently. Keep the queue local to the private demo data directory, excluded from version control. A local-only implementation must not claim database-cascade or object-store guarantees; report the backend mode in evidence.

## Minimum regression evidence

1. Wrapper-level regression: with a community artwork or reservation reference, deletion returns a specific conflict and mocks assert **zero** reader-file deletion, R2 revocation, and product-media cleanup calls.
2. Real Postgres concurrency test, two coordinated sessions: race reserve against the deletion-marker RPC. Assert either the reservation commits and marker refuses with no external cleanup, or marker commits and reserve/finalize is denied. Also cover an already-active reservation lease and prevent unarchive/edit while marked.
3. Real Postgres hard-delete test: archived/unreferenced product can enter marker, external cleanup can be retried, final purge succeeds; a failure leaves the marker recoverable and does not permit publication.
4. Real Auth/Postgres account deletion tests: completed artwork plus reserved and stored reservation paths are captured in the no-FK ledger before profile cascade; reservation rows disappear, artwork/event identities are nulled as intended, audit remains append-only, and ledger persists. Assert `not_before` is after lease expiry plus upload bound/margin.
5. Cleanup-worker integration test: at/after eligibility, remove a real isolated private object; repeat the job safely; verify no public or cross-account read path and no stale lease can recreate retained community metadata.
6. Local adapter tests for the same conflict/queue behavior, including filesystem cleanup retry. Keep real DB evidence separate from local/mock evidence.
