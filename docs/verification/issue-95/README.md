# Community maintenance execution isolation

Issue #95, part of #77. This change implements the execution budget safeguard. Scheduler frequency, account-plan decisions, hosted notification verification and operational queue monitoring remain separate launch work.

## Reproduction seam and correction

The previous protected route permitted 100 sequential private-object removals, each with a 60-second provider timeout, before attempting retention and notifications. Its platform limit is 60 seconds. A single stalled Storage request could consume the entire invocation and prevent both unrelated duties. A thrown stage also prevented all later work.

The new runner performs retention and notification attempts first, then the two independent deletion stages, with 5/10/15/10-second budgets. Native transport cancellation reaches affected queue claims, Auth/profile lookup, RPC finalization, private Storage deletion and Resend. There is no Promise.race or unawaited retry. Leases remain durable and fenced when an outcome is unknown. No migration, flag, scheduler or provider-window change is included.

The combined readiness candidate includes the notification configuration safeguard and this budget change. Local filesystem unlink is not cancelable; production rejects the local backend. The bounded transport guarantee applies to Supabase/R2/Resend, with deterministic tests against cancellation and durable lease behavior.

## Verification ownership

The implementation worker did not install dependencies or run tests while the coordinator owned validation. The coordinator subsequently ran the seven focused files below plus the isolated-target refusal suite: **96 PASS / 0 FAIL**. An initial route test could not import the new server-only module; the missing test-boundary mock was corrected before that passing run.

Proposed focused command:

```powershell
node node_modules/vitest/vitest.mjs run src/lib/community/maintenance.test.ts src/lib/community/cleanup-cancellation.test.ts src/lib/community/notifications.test.ts src/lib/community/notifications.transport.test.ts src/lib/collection-image-cleanup.test.ts src/lib/supabase/admin.test.ts src/app/api/internal/community/cleanup/route.test.ts --maxWorkers=1 --pool=forks
```

Changed-file lint passed. Final-head CI, independent review and real isolated cleanup/retry verification are recorded separately in the PR. The Resend transport regression uses the actual installed SDK with mocked native fetch and synthetic credentials; it sends no external email and does not prove provider or inbox delivery.
