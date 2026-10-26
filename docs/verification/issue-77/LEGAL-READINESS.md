# Community launch readiness: owner facts still needed

This is a preparation note for #85, not a legal opinion, final policy, or professional review. Code/database delivery remains authorized by the owner; public enablement stays conditional on the actual privacy/operational prerequisites in the original task.

Read-only inspection of the verified Lamilia Supabase target `ebyhoawczbexwtioywuk` found that the served EN `static_pages` privacy and terms bodies are still replacement placeholders. Query: `select slug, locale, title, body from public.static_pages where slug in ('privacy','terms') and locale='en' order by slug`. No cloud rows were changed. The current community guidelines are a separate English route and do not replace those pages.

An asynchronous owner clarification asks for the controller's actual person/business name and address, plus a working privacy/report contact mailbox. No identity, address, reviewed policy, processing location or legal basis will be invented. Useful independent read-only preparation was performed by actual reviewer task `/root/preflight_review`.

The internal [Privacy/Terms draft and retention matrix](DRAFT-PRIVACY-TERMS.md) now supplies concrete English text for owner/advisor review. Before enabling public features, complete its factual placeholders and establish:

- Actual controller identity/contact and a functioning request/report/appeal destination.
- Adult account operation, submission rights, and exclusion of identifiable children's photographs/private contact/location data.
- Account/premium, publication, moderation/reports, notifications, abuse controls and consent-dependent analytics processing and recipients.
- Actual configured providers, agreements/processing locations/transfers and backup/deletion behavior; do not infer cloud vendor regions from an unrelated project's configuration.
- Explicit operational retention for images, failed uploads, free-text reports/reasons, events, notifications, abuse buckets and backup copies. Engineering defaults are proposals for owner review, not claimed statutory deadlines.
- Account deletion's effect on existing unlocks and consumed single-use premium codes, explained before the user confirms deletion.

The candidate now implements verified self-service Auth-account deletion with an explicit confirmation and disclosure of lost unlocks and consumed premium codes. A durable no-FK ledger captures artwork/reservation object paths before Auth cascades, immediately tombstones/redacts authored works and removes public access, and retries physical media deletion after active-writer leases plus a safety margin. Controlled real database/Storage browser tests verified immediate denial and later physical deletion. Community withdrawal remains a separate action. These are candidate/local verification facts, not a claim that cloud already runs the change; see CC07.md.

Primary background consulted for drafting scope: [EDPB small-business guidance on transparency and individual rights](https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en), [EDPB privacy-information FAQ](https://www.edpb.europa.eu/sme/find-practical-info/faq_en?page=2), and [European Commission guidance on handling rights requests](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/dealing-requests-individuals_en). These explain why an accurate notice/contact and workable request process are needed; they do not certify this application or establish its particular legal bases/retention periods.

The earlier harness limitation has been addressed in commits8ea0fa2 andc7bbb3a. The committed validator/runner supports narrowly defined negative HTML404 checks for the owner-authorized gated release. Independent reviewer `/root/preflight_review` inspected the implementation and required same-SHA positive ON browser evidence plus a distinct OFF run with an approved private fixture. The final release still must supply fresh records and pass every normal gate; capability implementation is not release approval.

The allowlist accepts only canonical no-query EN `/en/club`, `/en/club/artworks/<valid lowercase UUID>` and `/en/club/creators/<valid normalized handle>`, with exact `text/html`, the application not-found sentinel, unchanged origin/path and no redirect. Other HTML404 remains unsupported. Wrong mappings, malformed paths, missing/stale ON/OFF proof, unexpected statuses or provider/protection pages fail closed. The final smoke never changes feature flags.

POST-only APIs support an explicit bodyless POST denial probe with expected401/403/404 and application text. It sends no caller body, Origin, application credentials or application session cookie. One deployment-protection cookie is required before fetch;405 and redirects fail. Positive authenticated mutations require separate actual browser/backend evidence. Same-SHA implementation/browser/review, CI, migration, route-coverage, GitHub merge rules and exact immutable Vercel deployment checks remain binding. See [harness documentation](../../agent-harness.md). Never claim a disabled or unverified feature is live.
