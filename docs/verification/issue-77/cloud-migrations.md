# Verified cloud migration application

Applied serially through official Supabase `apply_migration` to verified project `ebyhoawczbexwtioywuk` on 2026-10-26. Each generated version was read back immediately from migration history. The nine source filenames now match those actual versions; SQL bytes remain unchanged from reviewed candidate `87f0ae1ca941c2d8f84c8f3a0cc88f3fe739e968`. No existing migration record was rewritten.

| Original tested version | Actual applied version | Name | SQL SHA-256 |
| --- | --- | --- | --- |
| `20261025220052` | `20261026204551` | `community_foundation` | `69fb26cf6f36bf5ec55669e8e765de0c7581f5ca969a1749dfc3629ce4c36cbe` |
| `20261025230955` | `20261026204919` | `community_uploads` | `53094e89b258678e2f78ea0216ab94bb520096a353fb10ca51263a99a0592cfb` |
| `20261026011319` | `20261026204921` | `community_hearts` | `ab87236f843bc7bc2a55f96c78f9c41f514d3daa7292c16b66eae26a2f1fc0de` |
| `20261026021720` | `20261026204923` | `community_reports_and_retention` | `f7e4c469e7fefd65772c2c98dade2217bb29f79d5c315ad59e08fd05ee764265` |
| `20261026022942` | `20261026204925` | `community_moderation_notifications` | `09b1ab512a0cfae8478abebed40439eff001f0e7ece43feb1ab7c42f0f190e9b` |
| `20261026023850` | `20261026204927` | `community_product_deletion_fence` | `b2bd514322fcb3b4dd36a2581a2029346ed691f1b6f1ac1bce2a73671d7b4d42` |
| `20261026024957` | `20261026204930` | `community_account_deletion_cleanup` | `e008162bcf6da8ee7e008323df57147cd2fd10f77c99cae3dad8a9282cb84c77` |
| `20261026031432` | `20261026204933` | `community_service_role_privilege_fence` | `2c739a292abf029cbf1587d853f0d45c4b3c226994b1bc9ee3c40406d6351b4a` |
| `20261026032436` | `20261026204934` | `community_reports_bounded_unresolved_retention` | `97529c1fe93e7cc300a900874fc41156abec2c9b8269ac15b0defa72153223cd` |

Readback: 11 community tables, all RLS enabled, no direct anonymous/authenticated SELECT grants, no anonymous RPC grants, only the two administrator-authorized product-deletion RPCs exposed to authenticated callers. No invalid indexes or unvalidated constraints. Append-only audit tables retain no service-role DELETE privilege. Existing Storage policies remain restricted; all four buckets remain private.

Preservation check before/after: 8 Auth users, 8 profiles, 8 products, 65 product assets, 1 curated reader artwork, 2 premium codes (0 redeemed), and 0 unlock rows unchanged, including ordered ID digests. This is a schema/data readback; hosted application verification remains a separate release gate. Public and upload flags remain OFF pending launch-readiness facts.
