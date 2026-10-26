# Community moderation email notifications

## Delivery model

Approve/reject audit events enqueue one private outbox row in the same database transaction. Other decisions do not send email. The decision response succeeds independently of delivery. A protected maintenance worker drains retries; the moderation request may also attempt one queued send after commit.

Only the existing Resend client is used. No API key means the item remains queued. Local mode never sends external mail. The recipient is looked up at dispatch time and must still have a confirmed Auth email and active adult community profile with current rules acceptance. Deleted, unverified, revoked, suspended, or stale-rules profiles are suppressed.

Messages contain only the generic approval/review state and a My Creations link. They contain no moderation reason, user artwork, report text, storage path, or public file URL. The sender uses the existing LamiliaLomi sender identity.

## Retry and privacy bounds

- Resend idempotency key: `community-moderation/<moderation_event_id>`.
- The worker persists an HMAC fingerprint of the recipient and exact message/template; it does not persist the email address or message body.
- Retries use the same event key and exact payload within Resend's 24-hour idempotency window.
- A changed recipient/template or expired provider window becomes `uncertain` for manual review; the worker does not issue a new key or claim delivery.
- Claims use a three-minute lease and fencing token. Retry backoff is bounded; after eight failed attempts the item becomes uncertain. Provider error details are not logged or stored.
- Queue state distinguishes provider acceptance (`sent`) from inbox delivery; no delivery claim is made.

The configured Resend account, domain, legal sender/contact facts, and actual dispatch readiness still require owner review. Email availability does not enable public flags or constitute launch approval. Resend documents a 24-hour key lifetime and exact-payload matching in its [idempotency guidance](https://resend.com/docs/dashboard/emails/idempotency-keys).
