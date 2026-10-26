# Community reports and retention

## Reporting

- Signed-in, email-verified accounts may report currently public, approved artwork. A community profile or product unlock is not required.
- `POST /api/community/artworks/:id/report` accepts only a reason (`rights`, `privacy`, `harmful`, `other`) and optional text up to 500 characters. Same-origin and bounded JSON checks run before submission.
- Server-side account limits are five reports per hour; a valid platform client IP also receives a 25-per-hour bucket. Only a hash of each limit key is persisted. Account limits still apply if the IP header is absent or invalid.
- One report per reporter and artwork is accepted. A repeat receives a generic duplicate acknowledgement. Raw report tables and report history are private; public artwork projections never include report data.
- Admin access is checked from the current verified session and database role. The queue exposes a generic signed-in reporter label, not an email, Auth UUID, or IP. Admin decisions use revision checks.
- Guests can sign in and return to the artwork, or use the existing contact form. The operating contact destination and final report handling commitments still require owner confirmation.

## Operational retention draft

This is an engineering proposal for owner/legal review, not an approved legal retention period or legal certification. Private report details, reporter identity and event actor links have a maximum retention of 90 days from report creation. Reviewing a report does not extend that deadline. Resolving or dismissing it shortens the deadline to 30 days from that decision, capped by the original 90-day deadline. Expiry clears those private details and identity links while preserving report status, reason/category, artwork context and non-identifying event times. Account deletion also scrubs a reporter's text/linkage even when the account never joined the community. Open and reviewed reports remain in the staff queue after the deadline until handled; the seven-day overdue label remains, and expiry does not dismiss or resolve a report. The scheduled maintenance worker purges expired private details for any status. The owner and adviser must review or replace these periods before public launch.

## Consent-aware analytics

Community events use the existing browser consent gate and send no per-artwork or per-creator dimensions. Creator handles, artwork identifiers, query strings, and fragments are removed from page-location telemetry. No server-side analytics bypass is used.
