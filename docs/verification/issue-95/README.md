# Community maintenance execution isolation

Issue#95, part of#77. This change implements the per-invocation starvation/budget safeguard only. The scheduler frequency, account-plan decision, hosted notification verification and operational queue monitoring remain separate launch work.

## Reproduction seam and correction

The previous protected route permitted100sequential private-object removals, each with a60second provider timeout, before attempting retention and notifications. Its platform limit is60seconds. A single stalled Storage request could therefore consume the entire invocation and prevent both unrelated duties. A thrown stage also prevented all later work.

The new runner performs retention and notification attempts first, then the two independent deletion stages, with5/10/15/10second budgets. Native transport cancellation is threaded explicitly through affected queue claims, Auth/profile lookup, RPC finalization, private Storage deletion and Resend. There is no Promise.race or unawaited retry. Leases remain durable and fenced when an outcome is unknown. No migration, flag, scheduler or provider-window change is included.

The implementation branch is stacked on the notification-readiness change originally authored as`18512ad0b5ad008e1fd7546d9dd929b6063feb8f` (local cherry-pick`1ef8d9b`). Integrate this budget commit after that safeguard; the combined readiness branch may already contain it. Do not apply the preceding notification commit twice.

## Verification ownership

Worker preflight: dependencies missing, `install_reason=node_modules_missing`; no install performed. Source is isolated in`C:\lomi-maintenance`. No tests/build/browser were run by this worker while the parent owns the machine's validation window.

Proposed focused command:

```powershell
node node_modules/vitest/vitest.mjs run src/lib/community/maintenance.test.ts src/lib/community/cleanup-cancellation.test.ts src/lib/community/notifications.test.ts src/lib/community/notifications.transport.test.ts src/lib/collection-image-cleanup.test.ts src/lib/supabase/admin.test.ts src/app/api/internal/community/cleanup/route.test.ts --maxWorkers=1 --pool=forks
```

Changed-file lint, typecheck/build for the backend boundary, independent review and real isolated cleanup/retry verification remain parent-owned pending checks. No PASS is implied by this document. The actual Resend transport regression stubs native fetch with synthetic credentials and sends no external email.
