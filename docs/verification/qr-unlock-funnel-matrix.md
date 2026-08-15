# QR → Unlock → Library → Download verification matrix

Date: 2026-08-15
Branch: `codex/core-unlock-funnel`
Baseline: `93df7575b133b165dece9e9d2dd691a822aef265`

## Result

All 37 applicable scenarios pass. Nine rows have focused automated unit/integration evidence and 28 rows have browser evidence. The browser evidence runs the funnel in Chromium and mobile emulation; the focused funnel suite is 16/16 and the complete browser suite is 22/22 when run with one worker.

Evidence sources:

- `src/lib/unlock-funnel.test.ts` — explicit state-machine transitions and outcome mapping.
- `src/lib/return-to.test.ts` and `src/lib/auth.test.ts` — return-target, auth-context, session-signature, and registration safety.
- `src/lib/premium.test.ts` — code normalization, code/product binding, idempotency, download authorization, and signed URL behavior.
- `tests/e2e/unlock-funnel.spec.ts` — end-to-end QR, auth, verification, redemption, Library, download, error, locale, and mobile checks.
- `tests/e2e/smoke.spec.ts` — existing public browse, login, and admin protection regression checks.

## Matrix

| ID | Required scenario | Evidence | Result |
| --- | --- | --- | --- |
| E1 | Known QR slug resolves to the selected product and premium anchor | Browser: `valid QR entry keeps product and locale context` | PASS |
| E2 | Unknown QR slug is a controlled 404 | Browser: `unknown QR product, guest download, and external return targets are controlled` | PASS |
| E3 | QR locale is preserved through the product context | Browser: PL QR case and locale loop | PASS |
| E4 | Product context remains explicit before auth/redeem | Browser: product heading, owner copy, and guest state assertions | PASS |
| A1 | Guest can choose login from the product unlock state | Browser: `guest login preserves code intent without putting code in the auth return URL` | PASS |
| A2 | Guest can choose registration from the product unlock state | Browser: `registration and verification resume the unlock journey` | PASS |
| A3 | Premium code is absent from login/register return URLs | Browser: URL assertions before and after login | PASS |
| A4 | External, protocol-relative, and wrong-locale return targets fall back safely | Automated: `return-to.test.ts`, `auth.test.ts` | PASS |
| A5 | Code intent survives auth return and page reload | Browser: PL login flow and reload assertion | PASS |
| V1 | Authenticated but unverified user is blocked from redeeming | Browser: registration flow reaches `unlock-verification-state` | PASS |
| V2 | Verification resumes the same product unlock journey | Browser: demo verification action reaches `unlock-code-state` | PASS |
| V3 | Already verified users are not trapped in verification | Browser: verified owner redemption flow | PASS |
| V4 | Auth redirect preserves locale and only allows internal targets | Browser: DE/PL auth paths; automated auth redirect coverage | PASS |
| R1 | Valid code is product-bound, case-insensitive, and whitespace-tolerant | Browser: owner flow submits `  lomi-book-2026 ` and succeeds | PASS |
| R2 | Invalid code does not create access | Automated: `premium.test.ts` invalid-code case | PASS |
| R3 | Inactive code is denied | Automated: `premium.test.ts` inactive-code case | PASS |
| R4 | Wrong-product code is denied | Automated: `premium.test.ts` wrong-product case | PASS |
| R5 | Already unlocked is a positive, non-duplicating outcome | Automated: `premium.test.ts` existing-unlock case | PASS |
| R6 | Friendly code normalization is deterministic | Automated: `premium.test.ts` normalization case | PASS |
| R7 | Repeated redemption is idempotent | Automated: `premium.test.ts` double-apply case | PASS |
| R8 | Failed redemption is recoverable and does not expose raw backend errors | Browser: invalid-code recovery and generic localized alert | PASS |
| L1 | Newly unlocked product appears in Library | Browser: DE registration → unlock → Library | PASS |
| L2 | Library ownership survives reload | Browser: DE Library reload assertion | PASS |
| L3 | Authenticated locked reader sees an actionable empty state | Browser: `empty Library state is actionable for an authenticated locked reader` | PASS |
| L4 | Locked reader sees no premium download action | Browser: invalid-code flow asserts zero download links | PASS |
| D1 | Verified owner receives the private PDF through the authorized route | Browser: status 200, PDF signature, filename, and download route | PASS |
| D2 | Guest download is denied with a safe locale-aware login target | Browser: status 401 and `/es/login?returnTo=...` assertion | PASS |
| D3 | Unverified and locked sessions cannot authorize a download | Automated: `premium.test.ts` authorization-denial cases | PASS |
| D4 | Cross-product asset cannot be authorized by another unlock | Automated: `premium.test.ts` product mismatch case | PASS |
| D5 | Former public premium path is not downloadable | Browser: `/demo-premium/moon-garden-bonus.pdf` returns 404 | PASS |
| M1 | Funnel controls are usable at 375px | Browser: mobile project at 375px | PASS |
| M2 | Funnel has no horizontal overflow at 375px | Browser: `scrollWidth <= clientWidth` for EN/PL/DE/ES | PASS |
| M3 | Polish funnel copy and labels render | Browser: PL title and `Kod premium` assertions | PASS |
| M4 | English funnel copy and labels render | Browser: EN route and `Premium code` assertions | PASS |
| M5 | German and Spanish funnel copy render | Browser: DE and ES title assertions | PASS |
| M6 | Labels, alerts, keyboard submit, and pending controls are present | Browser: accessible labels, Enter submit, alert, and disabled pending button | PASS |
| M7 | Existing public browse/login/admin smoke paths remain green | Browser: `tests/e2e/smoke.spec.ts`, complete suite | PASS |

## Complete verification commands

| Command | Result |
| --- | --- |
| `npm ci` | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test -- --reporter=dot` | PASS — 18 files, 78 tests |
| `npm run build` | PASS — Next build and 62/62 static pages |
| `npm run e2e -- tests/e2e/unlock-funnel.spec.ts` | PASS — 16/16 Chromium/mobile executions |
| `npx playwright test --workers=1` | PASS — 22/22 complete browser executions |

The build emits non-fatal Next image performance warnings for pre-existing gallery/video assets and a non-fatal file-tracing warning for the local demo download adapter. No test or build gate is blocked by them.

## Boundary audit

- No `supabase/` file changed.
- No migration, schema, RLS policy, service-role, storage-policy, or competing production persistence implementation was added.
- The only persistence introduced by this workstream is the short-lived HTTP-only unlock-intent cookie, which carries prefill/navigation context only and cannot authorize unlock or download.
- The demo PDF moved outside `public/` so it is served only through the authorization route.
