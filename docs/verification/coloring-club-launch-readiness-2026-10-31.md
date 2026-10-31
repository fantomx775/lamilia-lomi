# Coloring Club launch readiness — 2026-10-31

**Decision: NO-GO for public launch.** Keep Production
`COLORING_CLUB_PUBLIC_ENABLED=false` and
`COLORING_CLUB_UPLOADS_ENABLED=false`. No change in this work authorizes
public visibility, writes, a Production migration or deployment.

## Verified baseline and evidence classes

- Production/main: `aff7125f4eaf3243234818e1f31cf33f4a0d2dce`.
  Vercel Git deployment `dpl_9WPDkhLi2jX1SK63ptp8iyYxVyLn`, READY,
  bound to `www.lamilialomi.com`.
- All 31 repository migrations, including nine community versions, are in
  the read-only Production migration inventory. Both flags are false.
  Production metadata contains the Resend, fingerprint and cron secrets;
  presence does not establish delivery or scheduler health.
- The final PR #91 application/schema/specification candidate `f12ef904…`
  is byte-identical to current main in those paths. Its
  [final acceptance record](https://github.com/fantomx775/lamilia-lomi/pull/91#issuecomment-6427605932)
  and [actual delivery record](https://github.com/fantomx775/lamilia-lomi/pull/91#issuecomment-6428526972)
  supersede earlier CC00–CC09 checkpoint notes. Those results are historical,
  not tests rerun today. They describe initial failures and later confirmations.
- This run created an exclusive local Supabase project,
  `lomi-stabilize-20261031`, on loopback API/DB ports 55421/55422.
  All 31 unchanged migrations were replayed as its local `supabase_admin`.
  Auth, PostgREST and Storage health returned 200. Local Mailpit is on 55424;
  it is separate from hosted email/inbox delivery.
- Fresh SQL: `community-foundation.sql` **60 PASS**;
  `community-uploads.sql` **28 PASS**; `community-hearts.sql` **35 PASS**;
  `community-85-lifecycle-security.sql` **95 PASS**. Total **218 PASS / 0 FAIL**,
  using the verified local Docker endpoint and immutable database ID.
- Fresh focused readiness tests before the maintenance-budget follow-up:
  **76 PASS / 0 FAIL**, including three actual local Auth/PostgREST repository
  cases. Mocks cover configuration/provider failures; they do not prove Resend
  or hosted delivery. Final-candidate commands, counts, browser provenance,
  review and CI are recorded in its exact-head PR comments.
- The maintenance-budget follow-up and portable-target refusals subsequently
  passed **96 tests / 0 FAIL** across eight files. Four actual coordinated
  PostgreSQL races also passed against the verified owned database. These
  additional results do not imply hosted provider retry or inbox acceptance.
- Admin incident #94 is fixed in reviewed PR #98, with 73 focused tests,
  two real-backend desktop/mobile browser cases and exact-head CI passing.
  Its harness says READY_FOR_MERGE. Production still has the reproduced
  failure until an explicitly approved normal release and deployed acceptance.

## Journey matrix

| Journey | Implemented safeguards and evidence | Remaining acceptance |
| --- | --- | --- |
| Join / adult membership | Verified current Auth user, current profile role, explicit adult/rules opt-in, unique normalized username; SQL and real local repository checks | Current isolated browser journey and owner-approved final rules version |
| Registration / confirmation / login / return | Existing Auth return-flow implementation; historical real Mailpit and cross-device tests | Actual hosted confirmation, mailbox receipt and second-device return, #30; local Mailpit is insufficient |
| Premium entitlement | Server/database published-product unlock checks; SQL role matrix, existing premium regression coverage | Deployed critical-flow acceptance after authorized release; no Production codes used as fixtures |
| Private uploads | Private Storage, byte/decode/pixel validation, EXIF/GPS removal, reservations and compensating cleanup | Current isolated Storage/browser rerun; dedicated isolated R2 acceptance if that provider is used |
| My Creations | Owner-only pending/approved/rejected/removed states, revision rules, edit/delete and immediate public revocation | Current desktop/mobile persistence and failure/retry rerun |
| Moderation | Current admin role, optimistic concurrency, required reasons and append-only audit | Current isolated moderator race/takedown journey; staffed moderation and escalation operations |
| Public gallery / creators | Approved projections, no email/internal path exposure, server kill switch, one integrated product gallery | Enabled testing only in an exclusive loopback/isolated environment; never infer Production launch readiness from mocks |
| Hearts / sorting | Atomic unique reactions and durable rate limits; fresh SQL and coordinated concurrency coverage | Current isolated UI rollback/cross-tab/popular-sort verification |
| Reports | Private reports, duplicate/rate controls, admin review and bounded retention | Current report/browser rerun plus a monitored reporting mailbox and operational response process |
| Notifications | Transactional outbox, fenced leases, frozen payload fingerprint and event idempotency key; explicit disabled/unconfigured/ready status | Hosted provider failure/retry/inbox proof and scheduling inside the safe idempotency window; #95 |
| Account deletion / retention | Immediate tombstones, durable media jobs without deleted-user FK, retry leases and retention SQL | Current actual byte cleanup/browser rerun; owner-approved retention/backups and appeals policy |
| Role/privacy boundaries | Raw community tables/RPCs deny anon/user access; narrow server projections; spoofed metadata denied | Fresh isolated tests are separate from hosted enabled-environment acceptance |
| Desktop/mobile | Historical reviewed 390/768/1440 captures and real browser journeys; fresh admin desktop/Pixel 7 proof | Current final-head community captures and browser errors/network/persistence checks |

## GO / NO-GO checklist

| Gate | Status / owner action |
| --- | --- |
| Technical QA | Partial current evidence above; require final-head targeted checks, real isolated critical journeys, independent review and CI for every new candidate. Never turn historical/mock results into fresh hosted PASS. |
| Production admin reliability | PR #98 ready; owner-authorized harness delivery and deployed role/runtime acceptance still required. |
| Security | Preserve RLS, grants, private Storage, current-role checks, version/lease fences and no-store community media. No anonymous grant workaround. Resolve all material review findings. |
| Storage/CDN | BLOCKED for actual isolated Lamilia R2 upload/display/replace/delete/fallback and cache behavior. Current connected bucket inventory provides no confirmed dedicated Lamilia test target; Production credentials are not test-resource authorization. Need a scoped dedicated account/bucket target and exact candidate runtime. No Production purge/rule changes. |
| Isolated hosted environment | BLOCKED: Supabase development-branch inventory is empty; no confirmed hosted enabled Stage target. Existing Preview metadata does not prove an isolated database/storage/email setup. |
| Moderation operations | Owner must name moderators, coverage, escalation, takedown/appeal workflow and accountable operator. Software implementation does not establish staffing. |
| Privacy / Terms / community rules | Drafts/code are available for owner/legal review. Do not invent legal facts or claim formal compliance. |
| Controller / contact | Owner must confirm accurate identity and contact details before publication. |
| Reporting mailbox | Owner must provision/confirm ownership, delivery and monitoring; a mailto link or API acceptance is not inbox proof. |
| Retention / deletion | SQL/cleanup implementation exists; owner must approve timelines, backup treatment and operational deletion verification. |
| Notification scheduler | NO-GO: daily cron cannot reliably retry a cron-origin failure before the 24-hour provider-idempotency cutoff. Configure an approved scheduler/plan/owner within the window; do not extend provider guarantees or blindly resend uncertain messages. |
| Monitoring | Verify protected cron authentication, dispatch configuration status, queue age, retries, uncertain deliveries, cleanup failures and moderation backlog. Safe enums/counts only; no recipient/credential logging. |
| Rollback | Before launch, verify both feature-OFF controls, no-store byte revocation, continuing private cleanup/retention while paused and operator recovery for durable jobs. Schema remains compatible; do not drop user data as rollback. |
| Launch approval | Explicit owner approval after the preceding gates; do not enable either Production flag as part of stabilization delivery. |

## Delivery and backlog

#77 remains the open public-launch effort. #78 can close as specification/config
delivery, independently of launch. #79–#84 should be reconciled against final
PR #91 evidence and current regression results; no blanket closure from a
merged feature flag alone. #85 is historically closed; newly discovered
operational gaps are tracked explicitly in #95–#97.

PR #70 reconstruction retains newer galleries and the deliberate exclusion of
community media from Next Image. Local image-quality evidence does not close
#23's real R2/CDN lifecycle gate. #30 remains blocked on hosted email acceptance.
#16/#21 still need comparable authenticated navigation/device timings. #32
remains open through unfinished media/auth acceptance.

Journal #87 and Challenges #86 remain after the actionable P0 stability/readiness
work. No comments, forum or direct messaging are introduced.
