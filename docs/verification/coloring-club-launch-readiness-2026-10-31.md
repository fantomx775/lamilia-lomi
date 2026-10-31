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

## Fresh isolated browser chronology

The enabled campaign at `5061bea` ran 14 distinct cases: **11 PASS / 3 FAIL / 0 SKIP**.
The failures were a transient media connection reset, a local Docker guard
precondition timeout and an unfinished curated-image request during editor
navigation. No target guard was bypassed. A focused repeat at `ae54c9a` gave
**2 PASS / 1 FAIL**; the remaining image request exposed a missing lazy-preview
wait and server-side trust of the owned local TLS certificate. The test now
waits for the actual decoded preview. Next's custom HTTPS launcher also needs
`--experimental-https-ca`; browser `ignoreHTTPSErrors` alone cannot configure
server-side fetch trust. The final lifecycle repeat at `0fb207e` passed
**1 PASS / 0 FAIL / 0 SKIP**, with no application-source delta between those
campaigns. All 14 distinct cases therefore have fresh passing evidence; there
was no single clean 14/14 run. Original failure artifacts are preserved in the
exclusive campaign directory. Final-head replay provenance is in the PR record.

The real local Mailpit/Auth campaign first failed two cases on its hardcoded
confirmation-link origin parser. The parser now matches the exact validated
application origin and retains callback/type/token checks. At `02f3878`, both
Chromium and mobile WebKit passed: **2 PASS / 0 FAIL / 0 SKIP**, 244.7 seconds.
Both log scans found no synthetic secrets and fixture cleanup succeeded. This
is not hosted mailbox acceptance; #30 stays open.

The cases exercise actual local Auth, PostgREST, private Storage, role denial,
moderation races, report/outbox intent, atomic hearts, UI rollback and cross-tab
updates, physical account/media deletion and protected maintenance. They do not
send external email or prove hosted R2/CDN/provider/inbox behavior.

The actual feature-OFF browser case at `02f3878` passed **1 PASS / 0 FAIL /
0 SKIP**, 90.4 seconds. An approved owned fixture stayed inaccessible to
anonymous HTML/API/media reads; public mutations were disabled. The owner
could still read and delete private bytes and leave the club. The protected
worker physically cleaned owned jobs while both flags were OFF; absent local
Resend configuration correctly returned 503 rather than a false success.
This is local feature-OFF proof, separate from read-only Production checks.

## Journey matrix

| Journey | Implemented safeguards and evidence | Remaining acceptance |
| --- | --- | --- |
| Join / adult membership | Verified current Auth user, current profile role, explicit adult/rules opt-in, unique normalized username; SQL and real local repository checks | Fresh isolated browser journey passed; owner-approved final rules version remains |
| Registration / confirmation / login / return | Fresh Chromium and mobile WebKit actual local Auth/SMTP/Mailpit: 2 PASS, real token-hash callback, cross-device context, login/premium and negative cases | Actual hosted confirmation, mailbox receipt and second-device return, #30; local Mailpit is insufficient |
| Premium entitlement | Server/database published-product unlock checks; SQL role matrix, existing premium regression coverage | Deployed critical-flow acceptance after authorized release; no Production codes used as fixtures |
| Private uploads | Private Storage, byte/decode/pixel validation, EXIF/GPS removal, reservations and compensating cleanup | Fresh isolated Supabase Storage/browser passed; dedicated isolated R2 acceptance if that provider is used |
| My Creations | Owner-only pending/approved/rejected/removed states, revision rules, edit/delete and immediate public revocation | Fresh isolated persistence, failure/retry and responsive captures passed; hosted acceptance remains |
| Moderation | Current admin role, optimistic concurrency, required reasons and append-only audit | Fresh isolated moderator race/takedown journey passed; staffed moderation and escalation operations remain |
| Public gallery / creators | Approved projections, no email/internal path exposure, server kill switch, one integrated product gallery | Enabled testing only in an exclusive loopback/isolated environment; never infer Production launch readiness from mocks |
| Hearts / sorting | Atomic unique reactions and durable rate limits; fresh SQL and coordinated concurrency coverage | Fresh isolated UI rollback/cross-tab/popular-sort passed; hosted acceptance remains |
| Reports | Private reports, duplicate/rate controls, admin review and bounded retention | Fresh isolated report/browser passed; monitored reporting mailbox and operational response process remain |
| Notifications | Transactional outbox, fenced leases, frozen payload fingerprint and event idempotency key; explicit disabled/unconfigured/ready status | Hosted provider failure/retry/inbox proof and scheduling inside the safe idempotency window; #95 |
| Account deletion / retention | Immediate tombstones, durable media jobs without deleted-user FK, retry leases and retention SQL | Fresh isolated actual byte cleanup/browser passed; owner-approved retention/backups and appeals policy remain |
| Role/privacy boundaries | Raw community tables/RPCs deny anon/user access; narrow server projections; spoofed metadata denied | Fresh isolated tests are separate from hosted enabled-environment acceptance |
| Desktop/mobile | Historical reviewed 390/768/1440 captures and real browser journeys; fresh admin desktop/Pixel 7 proof | Fresh responsive captures inspected; final-head replay and errors/network/persistence provenance in PR record |

## GO / NO-GO checklist

| Gate | Status / owner action |
| --- | --- |
| Technical QA | Fresh isolated journeys and targeted evidence above; final-head review, replay and CI recorded in each candidate PR. Never turn historical/mock results into fresh hosted PASS. |
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
| Rollback | Fresh local OFF controls, no-store byte revocation and continuing private cleanup/retention passed; hosted operational recovery for durable jobs remains. Schema remains compatible; do not drop user data as rollback. |
| Launch approval | Explicit owner approval after the preceding gates; do not enable either Production flag as part of stabilization delivery. |

## Delivery and backlog

#77 remains the open public-launch effort. #78–#84 were closed as verified
technical implementation slices using final PR #91 delivery evidence and the
fresh isolated regression results. This is separate from public-launch
readiness. #85 was already historically closed; newly discovered stabilization
and operational gaps remain open in #94–#97, #23 and #30.

PR #70 reconstruction retains newer galleries and the deliberate exclusion of
community media from Next Image. Local image-quality evidence does not close
#23's real R2/CDN lifecycle gate. #30 remains blocked on hosted email acceptance.
#16/#21 still need comparable authenticated navigation/device timings. #32
remains open through unfinished media/auth acceptance.

Journal #87 and Challenges #86 remain after the actionable P0 stability/readiness
work. No comments, forum or direct messaging are introduced.

## Protected-worker release boundary

An unauthenticated `GET /api/internal/community/cleanup` returning 401 verifies
only cron authentication. It returns before the changed maintenance helpers
run. It must not be labelled positive Production worker acceptance. Local
protected-worker calls exercised actual owned cleanup and fail-closed provider
configuration; Production queue processing was **NOT RUN**. The current harness
cannot inject the cron Authorization header into a protected positive smoke.
A separately approved scoped worker acceptance procedure/owned fixture and
safe secret-in-memory invocation are required before that release gate can
be marked PASS. No scheduler, queue, Production fixture or provider window was
changed to circumvent this boundary.
