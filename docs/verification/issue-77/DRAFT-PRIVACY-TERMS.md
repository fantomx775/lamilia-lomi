# Draft Privacy Notice, Terms and Retention Proposal — owner review required

**Status: INTERNAL DRAFT ONLY. Do not publish this file or copy it into `static_pages`.** The live Privacy and Terms pages are separate CMS content. The controller identity, privacy contact, legal bases, provider locations and final retention periods are still unknown. Text in `[OWNER INPUT REQUIRED: …]` must be completed and checked by the owner and their adviser before publication or public feature enablement. This draft is not legal advice and does not claim legal compliance.

## Privacy Notice — proposed English public text

**Last updated:** `[OWNER INPUT REQUIRED: publication date]`

### Who is responsible for your information?

The controller is **[OWNER INPUT REQUIRED: the actual person or legal entity that operates Lamilia Lomi, including its registered/legal name and postal address]**. Contact us about privacy or data requests at **[OWNER INPUT REQUIRED: monitored privacy email address]**. If a data protection officer or EU representative is required, their contact details are **[OWNER INPUT REQUIRED: name/contact, or confirm that none is appointed/required]**.

The website's contact form at `/en/contact` is a usable privacy contact route only after the owner confirms that it delivers messages to a monitored address. Until that is confirmed, do not present it as the only way to exercise a privacy right.

### What information the service handles

Depending on the features you use, the service may handle:

- Account email address, email-verification state, login/session data, account preferences and marketing-consent choice.
- Product-unlock and single-use code redemption records needed to provide access and prevent code reuse.
- For Coloring Club participation: your chosen public username, generated avatar seed, your adult and current-guidelines attestations, and timestamps for joining, withdrawal, suspension or account deletion.
- Artwork files and their product, description, processing, publication and moderation status. Unapproved artwork is private. Approved artwork may be shown publicly with your username and chosen description. Private storage paths, account IDs, email addresses, report details and moderation reasons are not part of the public artwork card.
- Hearts, abuse reports and optional report details. Reports and the reporter's identity are visible only to authorized moderators; report text is not public.
- Operational security data such as hashed account/IP rate-limit keys, upload and cleanup state, moderation-notification delivery state, and technical request logs. The production log contents and retention must be confirmed before launch.
- Information you submit through contact forms, such as name, email address and message. Contact messages may be sent using Resend when configured; the actual recipient, provider configuration and retention must be confirmed.

The community is for account holders who attest that they are at least 18. A child is not invited to create a community account. A parent or guardian managing an adult's account must not submit identifiable photographs or personal details about children. Do not upload faces of identifiable children, contact details, precise location/GPS data, or material you do not have the right to share.

### Why information is used

The service uses information to operate accounts and product access; receive and display eligible artwork; keep unapproved work private; moderate content and reports; prevent abuse; protect service availability; handle account deletion and private-media cleanup; respond to support requests; and send a short moderation-status email if the transactional email provider is configured and the account remains eligible.

**[OWNER INPUT REQUIRED: adviser-verified legal basis for each purpose and any applicable legitimate interests.]** Do not treat a required checkbox or this draft as evidence that a legal basis has been established. Marketing messages, if any, must remain separate from community participation and follow the site's separate marketing-consent flow.

### What is public and what stays private

Before approval, an artwork is not available in public galleries. After approval, the service may show the image through an application route, the author's chosen community username, a generated avatar and the submitted description. A product that is unpublished or an author account that is suspended, withdrawn or deleted makes the artwork unavailable to the public. Hearts show aggregate counts; the service does not publish a list of people who liked an artwork.

Administrators can see private submission and report information when needed to review safety or rights concerns. Email addresses, authentication IDs, private storage URLs/paths, report text and private moderation reasons are not public. A public work may still be copied or retained by people who saw it while it was available; removal from this service cannot recall copies already made by others or guarantee immediate removal from provider backups.

### Providers and recipients

The source code currently includes integrations for Supabase authentication/database, private image storage through the configured storage adapter, Vercel hosting, Resend transactional email, and Google Analytics 4 after analytics consent. **This is an implementation inventory, not confirmation that every provider is active in production.** Before publication, confirm which providers and storage regions the live deployment actually uses, their legal entities, processing locations, transfer safeguards, contract terms, sub-processors and retention settings:

- `[OWNER INPUT REQUIRED: production hosting and request-log provider/location/retention]`
- `[OWNER INPUT REQUIRED: Supabase project/database/Auth/Storage region and backup retention]`
- `[OWNER INPUT REQUIRED: whether private community images use Supabase Storage, Cloudflare R2 or another configured provider, including region and deletion behavior]`
- `[OWNER INPUT REQUIRED: whether Resend is configured, the sending identity, provider terms/location and message retention]`
- `[OWNER INPUT REQUIRED: whether Google Analytics is active in production, its configuration/retention and transfer settings]`

Do not infer any provider's location from a separate project or from source code alone.

### Cookies and optional analytics

Essential browser storage supports the site and your choice. The consent interface offers an essential-only choice and a separate option to allow Google Analytics. The analytics script is loaded only after the choice is allowed; you can change your choice from Cookie settings. The current implementation sends limited community event names (artwork submitted/approved/rejected, gallery view and heart created) without artwork/user IDs or descriptions, and sanitizes creator/artwork identifiers from page paths. Other site events and the exact essential-cookie inventory should be rechecked against the production build before publication.

**[OWNER INPUT REQUIRED: confirm the exact cookie/local-storage inventory, purpose and duration; confirm the live Analytics settings and any third-country transfer information.]**

### How long information is kept

The actual periods depend on the data type and provider. The engineering retention proposal is below and is not yet an approved legal schedule. Account deletion immediately hides public community content and queues private media for deletion after active upload leases expire; physical object removal is retried, and provider backups may have separate schedules.

**[OWNER INPUT REQUIRED: approve or replace each period, including backups, provider logs, email, and the operational reasons for keeping any audit data.]**

### Your choices and requests

You can change analytics consent in Cookie settings, edit or withdraw community participation, remove your own artwork through account controls, and request account deletion while signed in. Account deletion removes login access and product unlock access associated with the account; redeemed single-use premium codes remain consumed and cannot be reused. Private-media cleanup may finish asynchronously after a safety delay.

Subject to applicable law and exceptions, you may have rights to ask for access, correction, erasure, restriction, portability or to object, and to complain to your data protection authority. Contact **[OWNER INPUT REQUIRED: monitored privacy email/address and competent authority/contact instructions]**. The owner must establish a workflow to verify requests safely, respond within applicable deadlines, record the outcome minimally, and explain any refusal or extension. Do not request passwords or more identity documents than are necessary.

### Contact and changes

Privacy questions and requests: **[OWNER INPUT REQUIRED: monitored contact]**. General contact: `/en/contact` only after its delivery path is confirmed. This notice will be revised when processing or providers change; the owner must choose how material changes will be communicated and update the date above.

## Terms — proposed Coloring Club addendum

**Last updated:** `[OWNER INPUT REQUIRED: publication date]`

These proposed terms describe Coloring Club participation and supplement the site's actual product, purchase and account terms. They are a draft only. **[OWNER INPUT REQUIRED: confirm the contracting entity, governing-law/jurisdiction wording, consumer/refund terms, service limitations and an appeal/contact route with an adviser.]**

### Who may participate

Coloring Club submission and public-profile features are for verified account holders who attest that they are 18 or older and accept the current Community Guidelines. Do not create a community account for a child or upload identifiable information about children. Adult-oriented product audiences do not change this rule.

### Work you submit

Submit only work that you created or have permission to share. You remain responsible for your work and for the permissions needed to display it. You give **[OWNER INPUT REQUIRED: operator legal name]** a limited, non-exclusive permission to store, process, resize/convert, moderate and display a submission within the service, including public display after approval. This permission ends when the work is removed, except for copies/records that must remain for a documented safety, dispute, backup or legal purpose. **Have an adviser confirm the duration and exact scope before publishing this clause.** No transfer of copyright ownership is intended.

Do not submit another person's private information; identifiable children's faces or personal details; contact details or precise location/GPS data; unlawful, infringing, abusive or harmful material; or work that you are not authorized to share. Do not use the service to harass, impersonate, evade a moderation action, or interfere with its security.

### Review, publication and reports

New work stays private while pending. Administrators may approve, reject, remove or restore work under the Guidelines. An edit to an approved work returns it to review. A removal reason is shared with the author in account controls and is not displayed publicly. Verified members can report public work; guests can use the contact route once the owner confirms it is monitored. A report does not guarantee a particular outcome or response time. **[OWNER INPUT REQUIRED: provide a monitored appeal/privacy contact and review target before public launch.]**

The service may limit or suspend participation to protect people, copyright and service integrity. Decisions are reviewed by people; automated systems do not make final moderation decisions. **[OWNER INPUT REQUIRED: confirm this operational statement against the deployed process.]**

### Accounts, access and deletion

Keep your login credentials secure and provide accurate account information. Deleting an account ends login access and removes access to product unlocks linked to that account. A redeemed single-use premium code remains consumed; it cannot be reused after deletion. Account deletion hides submitted community work and schedules private image cleanup; it does not promise immediate removal from every backup or copy previously obtained by another person.

### No sale or reuse of community work by the operator

The proposed Club permission above is for service operation and display. It is not a permission to sell, sublicense as stock art, or use member artwork to train generative AI. **[OWNER INPUT REQUIRED: confirm this policy and any exceptions in the final published terms.]**

### Terms and contact

The operator may update these terms when the service changes and will identify material updates **[OWNER INPUT REQUIRED: state the notice/acceptance process]**. Questions, reports and appeals: **[OWNER INPUT REQUIRED: verified monitored contact]**.

## Retention proposal — operational draft, not statutory periods

Current code implements a proposed 90-day maximum from report creation for private report text and identity links; resolution/dismissal shortens that to 30 days, capped by the original 90-day deadline. Reviewing does not extend it. Expiry scrubs details and identity links for any report status but preserves unresolved cases in the staff queue. These are engineering defaults pending owner/adviser review, not legally approved periods. The code also stores private cleanup jobs until object removal succeeds and delays account-deletion cleanup until the active upload lease plus a safety margin. Other periods below are proposals; do not represent them as legally approved.

| Data | Proposed operational rule | Current implementation/evidence gap |
|---|---|---|
| Account/profile and unlock records | Keep while account is active; on verified deletion, remove account/profile/unlocks and anonymize community works, retaining only a minimal audit record where approved. | Account deletion path exists; legal retention for account/business records and provider backups needs owner/adviser approval. |
| Public/private artwork bytes | Keep while the author leaves the work available; upon delete, takedown or account removal, revoke access immediately, then remove bytes after any in-flight lease can no longer write. Retry until provider confirms absence. | Status-gated reads, private storage and cleanup queues exist. Exact provider backup/object-version retention still needs confirmation. |
| Upload reservations and cleanup jobs | Remove reservation data after finalization/cleanup when no idempotency or audit need remains; retain cleanup path only until deletion is confirmed, then delete it. | Account cleanup ledger deletes successful jobs; upload reservation/idempotency cleanup horizon and storage-provider backup behavior need final review. |
| Report details and reporter/event identity | Engineering proposal: maximum 90 days from creation for all statuses; resolution/dismissal shortens to 30 days, capped by the original 90-day deadline. Review does not extend the deadline. Scrub details and identity links but preserve status, reason/category, artwork context and non-identifying times. | Implemented as an operational default, not owner/adviser-approved or legally certified. Expiry does not close unresolved cases; they remain in the staff queue with overdue status. |
| Moderation reasons and history | Keep a reason only while needed for the author's appeal and safety review; proposal: scrub free-text reason 30 days after final closure, retaining minimal action/status/revision/time audit data without actor identity where no longer needed. | Account deletion clears moderation reasons, but no general 30-day reason purge is implemented. Add or explicitly reject this policy before launch. |
| Email outbox | Keep pending/retry rows until sent, suppressed or manually marked uncertain; proposal: delete/redact delivery IDs and author links 30 days after terminal state, retaining only aggregate operational counts. | Durable outbox and suppression exist; terminal-row purge and final period are not implemented. Email provider's own retention needs confirmation. |
| Rate-limit/abuse data | Keep hashed account/IP identifiers only for short abuse windows; proposal: purge fixed-window buckets after 48 hours, with no raw IP retained in app tables. | Hashing and persistent limits exist. Verify and implement scheduled Supabase bucket cleanup; local cleanup is bounded, but the production retention job is not evidenced. |
| Web/server/provider logs and backups | Minimize request fields and define provider-specific log and backup deletion periods before launch. | Production settings, regions, backup lifecycle and log access are owner/provider inputs; not established by this draft. |

No retention period in this table should be described as legally required or final without owner and adviser review. Public flags must remain OFF until the controller/contact/provider facts, rights-request workflow, policy copy and implemented retention choices are approved.

## Owner checklist before publication

- Fill controller/entity name and postal address; monitored privacy, report and appeal mailbox; applicable authority; DPO/representative status.
- Confirm live hosting, Auth, database, storage, email, analytics vendors/regions, contracts, sub-processors, transfers, backups and log retention.
- Approve or replace legal bases, artwork display permission, account-age policy, retention table, legal-claims exceptions and change-notice process.
- Verify the deployed analytics and cookie inventory, consent behavior, contact delivery route, moderation notifications and account-deletion UI against this copy.
- Obtain qualified review for policies, children's-content handling, sale/refund terms and any processing of children's content before enabling community features publicly.

## Drafting references

- [GDPR Regulation (EU) 2016/679, EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679), including transparency, data minimisation, storage limitation and notice provisions.
- [European Data Protection Board: Respect individuals' rights](https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en), including accessible request channels and response workflow guidance.
- [European Commission: Dealing with requests from individuals](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/dealing-requests-individuals_en), including the general one-month response framework and identity-check guidance.

These sources inform the checklist; they do not determine this operator's legal basis, applicability, final wording or retention schedule.
