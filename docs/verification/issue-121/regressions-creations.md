# My Creations regression investigation

The action group previously closed synchronously on `blur` when `relatedTarget`
was null. A Safari touch can blur the trigger without supplying the next focus
target; removing the action button at that point prevents its click handler.
The fix dismisses only on an actual outside `pointerdown` or `focusin` target,
while preserving Escape dismissal and focus restoration. Unit regression tests
explicitly dispatch null-relatedTarget blur before activating Edit and Delete.

The public artwork detail now exposes “Edit or delete your artwork” only after
an owner-scoped read. It links to the matching anchored card in My Creations.
Existing canEdit/canDelete separation remains: editing requires active membership
and uploads enabled; a verified owner can still delete. PATCH/DELETE continue to
use owner-checked SQL and expected revisions. A stale edit returns 409 and keeps
the description draft; the unavailable/ownership response deliberately also uses
409 so a stranger cannot distinguish missing and foreign records.

## Verification

- PASS `npm test -- src/components/community/community-creation-manager.test.tsx`: 5 tests, including null-target blur and save/delete concurrency.
- PASS `npx eslint src/components/community/community-creation-manager.tsx src/components/community/community-creation-manager.test.tsx tests/e2e/community-creations-regressions.spec.ts`.
- PASS Chromium real isolated database flow (18.2s): create/upload, publish,
  follow owner link, open menu, blur, edit, retain failed-conflict draft, reload
  fresh revision, save, reload pending status and persisted description, deny
  stranger PATCH/DELETE with unchanged row, delete confirmation, delete, reload
  empty list, media no longer accessible.
- PASS Mobile WebKit real isolated flow: 1 test passed in 27.8s (test 25.6s), log `/tmp/lamilia-crud-webkit.log`. A first run completed deletion but exceeded 120s during final checks under concurrent dev-server compilation; the focused rerun confirms the entire flow.

The test runs against dedicated local Supabase project
`lamilia-coloring-club-p0` (API 55421/database 55422), with real Auth, private
Storage and SQL RPCs. No production test fixtures are created. The browser uses
local HTTPS at 3443. Private reusable runners in `/tmp/lamilia-p0-preflight/`
read credentials without printing them; they are intentionally not committed.

Screenshots under `regressions/issue-121/` capture persisted saved state,
confirmation, and deleted empty state. These are working-tree checkpoints;
final SHA/run provenance must be refreshed by the coordinator. Playwright
mobile WebKit is engine evidence, not a claim of physical iPhone testing.
