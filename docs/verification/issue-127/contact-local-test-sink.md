# Controlled local Contact mail sink

The Contact API has no fake success fallback. A missing mail provider returns 503 and leaves the browser draft intact. Provider responses are accepted only when there is no provider error and a message ID is present.

For an authorized **local** browser run, configure `LAMILIA_BACKEND=local`, the repository's normal local backend permission/configuration, a loopback `NEXT_PUBLIC_APP_URL`, and `LAMILIA_CONTACT_TEST_SINK=1` before starting the application through the normal local test workflow. Use only synthetic test names, addresses ending in `.test`, and non-identifying messages. No mail provider credentials are needed. Do not enable this flag in a hosted environment.

The sink requires all of: the explicit flag, local backend mode, a loopback request URL, and a loopback browser Origin. Same-origin validation still applies. Successful acceptance atomically creates one JSON file in `.data/contact-test-outbox/`, keyed by a digest of the request ID and exact normalized message payload. That directory is ignored by Git. A retry with the same ID and unchanged payload reuses the file; a changed payload gets a different delivery key. The response never returns the message content. Each fixture must remove only the exact file it created after asserting persistence.

The provider path uses the same payload-bound key with Resend idempotency. Client timeouts do not imply delivery failed; the draft and request ID remain available for a safe retry. Double submission is also blocked in the client. The form keeps inline results independently of transient notifications.

Executed evidence is in `.task/ux127/contact-auth-tests.log`: direct handler tests exercise real local filesystem acceptance/idempotency, provider rejection stubs and origin guards; component tests cover validation, draft preservation, timeout and duplicate submit. These are focused tests, not a browser or running Supabase/backend acceptance result. Browser/backend runtime evidence must be produced by the final QA run on the exact candidate SHA; the focused tests above do not substitute for it.
