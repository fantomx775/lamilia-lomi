# Community launch readiness: owner facts still needed

This is a preparation note for #85, not a legal opinion, final policy, or professional review. Code/database delivery remains authorized by the owner; public enablement stays conditional on the actual privacy/operational prerequisites in the original task.

Read-only inspection of the verified Lamilia Supabase target `ebyhoawczbexwtioywuk` found that the served EN `static_pages` privacy and terms bodies are still replacement placeholders. Query: `select slug, locale, title, body from public.static_pages where slug in ('privacy','terms') and locale='en' order by slug`. No cloud rows were changed. The current community guidelines are a separate English route and do not replace those pages.

An asynchronous owner clarification asks for the controller's actual person/business name and address, plus a working privacy/report contact mailbox. No identity, address, reviewed policy, processing location or legal basis will be invented. Useful independent read-only preparation was performed by actual reviewer task `/root/preflight_review`.

Before enabling public features, prepare concrete Privacy/Terms/Guidelines text for owner/advisor review and establish:

- Actual controller identity/contact and a functioning request/report/appeal destination.
- Adult account operation, submission rights, and exclusion of identifiable children's photographs/private contact/location data.
- Account/premium, publication, moderation/reports, notifications, abuse controls and consent-dependent analytics processing and recipients.
- Actual configured providers, agreements/processing locations/transfers and backup/deletion behavior; do not infer cloud vendor regions from an unrelated project's configuration.
- Explicit operational retention for images, failed uploads, free-text reports/reasons, events, notifications, abuse buckets and backup copies. Engineering defaults are proposals for owner review, not claimed statutory deadlines.
- Account deletion's effect on existing unlocks and consumed single-use premium codes, explained before the user confirms deletion.

The existing application has no self-service Auth-account deletion route. Community withdrawal only revokes participation. Current FKs can leave artwork metadata after profile deletion and can cascade away unfinished upload reservations before their files are cleaned. #85 must stage a durable cleanup record independent of the removed account, revoke public access first, retry physical deletion and minimize/purge retained identifying/free-text audit fields according to the reviewed policy. Do not label soft deletion as completed physical cleanup.

Primary background consulted for drafting scope: [EDPB small-business guidance on transparency and individual rights](https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en), [EDPB privacy-information FAQ](https://www.edpb.europa.eu/sme/find-practical-info/faq_en?page=2), and [European Commission guidance on handling rights requests](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/dealing-requests-individuals_en). These explain why an accurate notice/contact and workable request process are needed; they do not certify this application or establish its particular legal bases/retention periods.
