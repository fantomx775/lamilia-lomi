# Community moderation email notifications

## Delivery model

Approve/reject audit events enqueue one private outbox row in the same database transaction. Other decisions do not send email. The decision response succeeds independently of delivery. A protected maintenance worker drains retries; the moderation request may also attempt one queued send after commit.

Only the existing Resend client is used. No API key means the item remains queued. Local mode never sends external mail. The recipient is looked up at dispatch time and must still have a confirmed Auth email and active adult community profile with current rules acceptance. Deleted, unverified, revoked, suspended, or stale-rules profiles are suppressed.

Dispatcher results distinguish `ready` (including an empty queue), `disabled` for the local backend, and `unconfigured` for a missing email provider or missing/short fingerprint secret. Missing configuration does not claim or mutate outbox rows. The authenticated maintenance endpoint completes its cleanup and retention work, then returns HTTP 503 with `notifications_unconfigured` and a safe reason enum when dispatch is unconfigured. Its result includes notification counts; these measure processing/provider acceptance, not inbox delivery. The response and log contain no configuration values or recipient data. Local mode remains a successful maintenance run with notification status `disabled`.

Messages contain only the generic approval/review state and a My Creations link. They contain no moderation reason, user artwork, report text, storage path, or public file URL. The sender uses the existing LamiliaLomi sender identity.

## Retry and privacy bounds

- Resend idempotency key: `community-moderation/<moderation_event_id>`.
- The worker persists an HMAC fingerprint of the recipient and exact message/template; it does not persist the email address or message body.
- Retries use the same event key and exact payload within Resend's 24-hour idempotency window.
- A changed recipient/template or expired provider window becomes `uncertain` for manual review; the worker does not issue a new key or claim delivery.
- Claims use a three-minute lease and fencing token. Retry backoff is bounded; after eight failed attempts the item becomes uncertain. Provider error details are not logged or stored.
- Queue state distinguishes provider acceptance (`sent`) from inbox delivery; no delivery claim is made.

Scheduled dispatch has an independent ten-second I/O budget, before provider media cleanup. Its cancellation signal reaches the current Resend SDK's native fetch (covered by a transport contract regression) and the account/profile/outbox requests. Cancellation may leave an accepted-but-unacknowledged request; its fenced lease, payload fingerprint, event idempotency key and existing uncertain-window rules remain authoritative. The worker stops issuing further writes after its budget expires rather than attempting an unbounded compensating write or a fresh send.

The configured Resend account, domain, legal sender/contact facts, and actual dispatch readiness still require owner review. Email availability does not enable public flags or constitute launch approval. Resend documents a 24-hour key lifetime and exact-payload matching in its [idempotency guidance](https://resend.com/docs/dashboard/emails/idempotency-keys).
