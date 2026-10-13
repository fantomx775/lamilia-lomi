# PR #54 local database verification

Verification date: 2026-10-13

Environment: Windows 11 / PowerShell 7.6.5 / WSL2 Docker Desktop backend

## Docker and local Supabase

- Recovered the Docker Desktop WSL2 backend after its telemetry socket became stale and inaccessible. Removed that one stale socket and restarted Docker Desktop; no Docker reinstall, data reset, volume deletion, or unrelated container cleanup was performed.
- Docker Engine 26.1.1 and Compose 2.27.0 are operational. `docker info`, `docker ps`, and `docker compose version` succeed. The `com.docker.service` Windows helper remains stopped, while Docker Desktop and both WSL distributions (`Ubuntu`, `docker-desktop`, `docker-desktop-data`) are running and the LinuxKit daemon is healthy.
- Supabase CLI 2.118.0, Node 22.15.0, and npm 10.9.2 were used. The disposable project ID is `lamilia-issue49-pr54-56171a88`; its PostgreSQL, Auth, Storage, Realtime, Inbucket, Kong, and REST containers are running. PostgreSQL/Auth/Storage/Realtime/Kong report healthy; PostgreSQL accepts connections, Auth and REST return HTTP 200, and the Storage bucket API returns HTTP 200 with the `collection-media` bucket present.
- App and Supabase ports used: 3030, 54321, and 54322. Studio port 54323 and optional Studio/Analytics/pg_meta/Vector/edge services were left stopped to conserve host memory. About 14.6 GiB disk and 0.82 GiB RAM were free at the final preflight.

## Historical migration and local baseline

The historical `20260815120000_supabase_production_foundation.sql` assumes ownership of `storage.objects` when enabling RLS and creating policies. On a fresh local stack, that table is owned by `supabase_storage_admin`, while the migration runner connects as `postgres`, which is not its owner. This caused the earlier `must be owner of table objects` error.

For this disposable local database only, the test copy of that historical migration used the Storage owner role around its Storage policy section and local-only role/schema/function grants. No historical migration in the repository or Production was changed. The original migration file hash remained unchanged. The local migration ledger contains 20 applied versions, through `20261013084706` (including `20261011204732_issue_49_collections_admin.sql` and the latest main migration `20261013084706_issue_51_atomic_rich_text_v2_compatibility_guard.sql`).

## Collections schema, RLS, and pgTAP

- `20261011204732_issue_49_collections_admin.sql` applied successfully to the disposable local database.
- Catalog inspection confirmed `collections` and `product_collections` have RLS enabled; the unique collection name/slug/image-path indexes; a unique `product_id` assignment; the collection lookup index; and product/collection foreign keys. Deleting a collection cascades its assignment rows; it does not delete products.
- The `collections_admin_all`, `product_collections_admin_all`, and `admins_manage_collection_images` policies are present. The `collection-media` bucket is private and its policies allow admin management.
- The focused test run used the repository's `collections-rls.test.sql` and `collections-security-extended.test.sql`: **2 files, 46 tests, PASS**. It verified admin CRUD and Storage writes, non-admin CRUD/assignment/Storage denials, unique product assignment, and preservation of product category/tag relationships.
- `production-foundation-rls.sql` was also applied as a local SQL integration check; its printed assertions passed. Baseline data remained 4 products, 3 categories, and 3 tags after browser-fixture cleanup.

Project-default discovery also ran unrelated SQL files. The two Collections files passed; `atomic-product-save-concurrency.sql` stopped at its administrator guard before producing TAP, and `catalog_settings_rls_test.sql` had 3 expectation mismatches (the uniqueness check returned the table check-constraint message). Those files exercise separate product-save/catalog-settings behavior and were not changed for Issue #49. The Collections tests were then isolated and rerun successfully as listed above.

## Database-backed Browser Use

The Playwright test `tests/e2e/issue-49-supabase.spec.ts` explicitly required `LAMILIA_BACKEND=supabase`, loopback-only URLs, and the disposable local Supabase keys. It ran against the local app on Chromium desktop and Pixel 7 mobile: **2 passed**.

The flow created, renamed, and deleted a collection; uploaded, reloaded, removed, and replaced its image; created a product with categories/tags; assigned, cleared, and restored its collection; confirmed persistence after reload; verified collection/category/tag cells and the 50-tag `+48` overflow; checked non-admin UI, PostgREST, API, and Storage write denials; and confirmed deleting the collection left its product and taxonomy relationships intact. Temporary users, products, tags, collections, and image objects were removed successfully.

Screenshots (Chromium desktop and Pixel 7 mobile):

- [Collection editor](supabase-collection-editor-chromium.png) · [mobile](supabase-collection-editor-mobile.png)
- [Image after reload](supabase-collection-image-reloaded-chromium.png) · [mobile](supabase-collection-image-reloaded-mobile.png)
- [Products with taxonomy](supabase-products-taxonomy-chromium.png) · [mobile](supabase-products-taxonomy-mobile.png)
- [50-tag overflow](supabase-products-tag-overflow-chromium.png) · [mobile](supabase-products-tag-overflow-mobile.png)
- [Collections list](supabase-collections-chromium.png) · [mobile](supabase-collections-mobile.png)

The independent review of the updated Supabase E2E fixture and assertions found no remaining concrete issues.

## Targeted candidate checks

- `npm run typecheck`: passed.
- `npm run lint -- tests/e2e/issue-49-supabase.spec.ts src/lib/supabase-content-admin.test.ts`: passed.
- `npx vitest run src/lib/supabase-content-admin.test.ts`: 47 passed.
- `git diff --check`: passed.
