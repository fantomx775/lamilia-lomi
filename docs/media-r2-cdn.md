# R2 image storage and CDN runbook

## Current behavior and image-quality evidence

Product covers and gallery entries each use one uploaded source image. Public R2 custom-domain URLs pass through the Next image optimizer, which can return responsive variants based on each component's `sizes` hint. Supabase/local media continue through `/api/media/:assetId`; that route enforces published/public/active/non-premium access and redirects to a short-lived storage URL, while authenticated admins can preview public-kind assets on drafts through a private signed URL. Those protected proxy paths remain unoptimized. Product cards crop covers with `object-cover`; gallery tiles and the enlarged preview use `object-contain`.

This does not create separately authored thumbnails: the optimizer derives variants from the uploaded original, and it cannot add detail beyond that source. A read-only Production sample on 2026-10-14 found a 2758×3565 cover and a 1533×2000 gallery image. The optimizer returned the gallery at its source dimensions even for a requested 3840-pixel variant, so it did not enlarge the file. At a 76rem preview width and 2× device pixel ratio, however, that 1533-pixel source is below the 2432-pixel display target; inspect the actual content at intended desktop/mobile sizes before concluding sharpness is sufficient. See the dated [Production image audit](verification/issue-23/production-image-audit-2026-10-14.md).

Category images use the provider-aware reference and upload flow added by PR #46. Admins can upload, replace, or remove an image; R2-backed images use UUID-versioned public URLs, and legacy Supabase images use the category-media route and a short-lived signed redirect. The category image path is covered with synthetic/local fixtures, but Production had three categories and no assigned category images in the 2026-10-12 read recorded on Issue #23. A representative live category render therefore remains unverified.

## Scope and access rules

- Only public `cover` and `gallery` images can upload to R2.
- R2 uploads first land under `staging/` in a private bucket. The browser receives a short lived signed PUT URL and also uploads the same bytes to the existing private Supabase bucket as a rollback mirror.
- Saving the product verifies both copies, promotes the R2 private object to its stable key, and writes provider metadata in the same database transaction.
- A published product marks an eligible image `r2_public_pending` before copying it to the public R2 bucket. That state continues to serve from private R2. The row changes to `r2_public` only after the public copy and custom-domain response are verified; provider changes include the exact storage path and serialize with product saves.
- Draft and archived assets stay private. Before unpublish, archive, asset removal, or product deletion, the app moves the row to `r2_public_revoking`, which serves from private R2 and fences concurrent product saves from starting another public promotion. It verifies the private copy, deletes the public object, and returns the row to `r2_private` before changing product state. If deletion fails, the mutation stops and the row remains `r2_public_revoking` so a retry can find the possible public copy.
- Video, public downloads, premium files, and all existing rows default to Supabase. The premium authorization path is unchanged.
- The application writes `public, max-age=60, s-maxage=60, must-revalidate` to newly promoted public R2 objects. A read-only S3 `HeadObject` on 2026-10-15 confirmed that metadata on a sampled Production object. The same object's public custom-domain response advertised `max-age=14400, s-maxage=60`; Cloudflare documents a default four-hour Browser Cache TTL that can override a lower origin browser TTL. The effective Cloudflare edge TTL is not exposed by these response headers. The optimized Next.js response advertised `max-age=3600`, but a repeated read was marked `X-Vercel-Cache: STALE` with `Age` over 29 hours while the source still existed. `images.minimumCacheTTL: 60` is a minimum, not a maximum. These observations do not prove a one-minute stale-delivery bound, or a hard one-hour optimizer revocation bound. They also do not establish what the optimizer serves after its source is deleted. See the dated [Production cache probe](verification/issue-23/production-cache-probe-2026-10-15.md) for exact evidence and limits.
- Product and category replacement uploads use a new UUID in the object key, so the storefront moves to a new URL instead of overwriting a cached image. Unpublish, archive, asset removal, and product deletion remove the public R2 object before completing the state change, but cannot recall copies already held by browsers, the image optimizer, or an edge cache. Non-public, draft, and premium media remain on protected private/signed paths; an image that was public can remain available at its old URL while caches serve it. If the owner chooses a shorter future browser-cache window for direct media, configure the Cloudflare media-host Browser Cache TTL to respect existing origin headers. This would not invalidate already-fresh browser copies or the separate Vercel image-optimization cache. For a deleted source image, the Vercel project owner can delete all transformed variants by source image with `vercel cache dangerously-delete --srcimg <absolute-source-image-url>` from the linked project; verify a subsequent optimized request returns the expected miss/error rather than stale image bytes. This operation was not run. See the dated cache probe for the exact source URL and official CLI guidance. No Production Cloudflare or Vercel cache change was made.
- The migration is additive and retains Supabase objects. Backfill has dry-run as its default and never deletes a source object.

## Cloudflare setup

Create two Lamilia-specific R2 buckets in the intended Cloudflare account:

1. A private bucket with no public development URL or custom domain.
2. A public bucket bound to the intended HTTPS media custom domain.

Create S3 API credentials scoped to these buckets and use the account ID, Access Key ID, Secret Access Key, bucket names, and custom-domain origin in the application environment. The Cloudflare management API token is not an R2 S3 data-plane credential. R2 S3 requests use the account endpoint and S3 credentials. [Cloudflare R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/), [Cloudflare R2 S3 setup](https://developers.cloudflare.com/r2/get-started/s3/).

Configure private-bucket CORS for `PUT` from only the production app origins and the local development origin used for verification. Allow the `Content-Type` request header. Do not enable public access on the private bucket. Configure HTTPS and public read only on the public bucket's custom domain. Set a lifecycle rule to remove `staging/` objects after one day; those are incomplete browser uploads, not saved product assets.

The repository does not create buckets, bind domains, configure CORS, or change bucket access. Do those actions through the account's approved Cloudflare workflow, then verify them with a small synthetic image before enabling the app setting.

## Application configuration

Set these server-side environment variables for the target deployment:

```text
MEDIA_STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_PRIVATE_BUCKET=
R2_PUBLIC_BUCKET=
R2_PUBLIC_BASE_URL=https://media.example.com
```

The public base must be an HTTPS origin with no path or query. The private and public bucket names must differ. Keep `MEDIA_STORAGE_PROVIDER=supabase` until the migration and all Cloudflare checks have succeeded. Missing R2 configuration fails the R2 upload setup rather than silently issuing a Supabase-only upload under an R2 request.

Failed cloud product saves and direct admin upload cleanup retain uploaded objects. Immediate deletion can race with another in-flight save that is using the same asset path, so the admin endpoint reports `cleanupDeferred` for cloud objects. Incomplete R2 uploads under `staging/` expire after one day; stable cloud objects without a saved asset reference must be reviewed and cleaned up separately during a controlled maintenance window.

## Database migration and upload cutover

1. Apply `supabase/migrations/20261008120000_r2_media_storage_provider.sql`, `supabase/migrations/20261008224035_r2_media_publication_pending.sql`, and `supabase/migrations/20261009113000_r2_media_publication_revoking.sql` through the normal database migration process before deploying code that uses the R2 provider. The first adds `storage_provider`, defaulting all existing rows to `supabase`; the second adds the private-serving publication-pending state and path-bound RPC while preserving the old RPC signature for rolling deploys; the third adds the private-serving revocation fence and prevents a concurrent save from clearing it. The compatibility overload rejects the old pre-copy `r2_public` transition.
2. Deploy the application with `MEDIA_STORAGE_PROVIDER=supabase`. Existing product saves continue to call the original `save_product` RPC until R2 metadata is needed.
3. Verify the private bucket signed PUT, CORS response, Supabase mirror upload, product save, and private GET authorization using a synthetic unpublished product.
4. Set `MEDIA_STORAGE_PROVIDER=r2` only after those checks pass. New cover/gallery uploads use both storage systems. Other asset kinds continue to use Supabase.
5. Publish a synthetic product and verify the row moves through `r2_public_pending` to `r2_public` only after the public custom-domain image loads and `/_next/image` produces responsive variants. Then unpublish it and verify the provider returns to `r2_private` and the public object is removed.

The repository has no configured R2 S3 keys, Lamilia-specific buckets, or media custom domain at the time this runbook was written, so no live R2 upload or cutover has been performed.

## Existing-image backfill

Run the script with configuration supplied by the local environment. `--env-file` is a Node.js option; use a private environment file outside Git when one is approved. Dry run needs the Supabase project and R2 target names/domain so it can print the destination mapping; only apply and R2 reconciliation/rollback need R2 S3 credentials.

```text
node --env-file=.env.local scripts/media-r2-backfill.mjs
```

The default dry run inventories all cover/gallery rows attached to products, including drafts and archived products. It downloads each migratable Supabase source, checks its recorded size when present, and records its byte length and SHA-256. Published, active, public images map to both the private and public R2 targets. Draft, unpublished, archived, and inactive images map only to the private bucket. Each asset is printed as a JSON line and saved to a unique JSONL report under `.media-r2-backfill-reports/`; pass `--report-file [path]` to choose a different new report path. The report is flushed after each item, so an interrupted apply leaves a durable progress prefix that can be reviewed and resumed. It includes skipped rows and their reasons. Legacy `is_public=false` rows and unfinished `r2_public_revoking` rows are reported but skipped: the current database contract cannot safely transition the former, and the latter must be reconciled first. Dry run performs no database or object writes.

After reviewing the dry run, run any `--apply` mode only in a maintenance window after product media saves and publishing have stopped and all in-flight saves have drained. Keep them stopped until the command completes, and run only one apply command at a time. This applies to backfill, public-bucket reconciliation, and rollback. The write mode requires the exact Supabase project reference and the exact R2 account plus both bucket names:

```text
node --env-file=.env.local scripts/media-r2-backfill.mjs --apply --confirm-project [project-ref] --confirm-r2-target [account-id/private-bucket/public-bucket]
```

Apply re-reads each row before copying, hashes the Supabase source, and reads back and hashes the private R2 object before changing its provider. Non-published products and inactive images remain `r2_private`; only currently published, active, public images proceed through `r2_public_pending`, public-object byte/content-type verification, and custom-domain verification before `r2_public`. A concurrent revocation that finishes before an in-flight public copy is finalized causes the backfill to remove that late copy while preserving or reacquiring the revocation fence. Reruns verify existing private and public copies. A row marked `r2_public` with a missing public object is reported for review rather than recopied without the pending-state lifecycle. The Supabase original stays intact. If final publication or cleanup fails, the item is recorded as failed and the process continues to inventory other rows; the report and nonzero exit status make unresolved items visible for retry. Provider states and retained originals allow safe resumption.

If a process stops after a public copy is written, reconcile the public bucket before resuming the cutover. The default mode lists product cover/gallery objects and keeps only paths whose database row is still `r2_public`, active, public, and attached to a published product:

```text
node --env-file=.env.local scripts/media-r2-backfill.mjs --reconcile-public
```

To inspect or reconcile one product's public images only, add its UUID. This scopes both the database queries and the R2 listing to that product's `products/<uuid>/` prefix:

```text
node --env-file=.env.local scripts/media-r2-backfill.mjs --reconcile-public --product-id [product-uuid]
```

After reviewing the scoped dry run, the same UUID can be supplied to the confirmed apply command:

```text
node --env-file=.env.local scripts/media-r2-backfill.mjs --reconcile-public --product-id [product-uuid] --apply --confirm-project [project-ref] --confirm-r2-target [account-id/private-bucket/public-bucket]
```

Review the dry-run paths. Keep the maintenance window in place through apply, so a concurrent promotion cannot create an object after it was checked:

```text
node --env-file=.env.local scripts/media-r2-backfill.mjs --reconcile-public --apply --confirm-project [project-ref] --confirm-r2-target [account-id/private-bucket/public-bucket]
```

The dry run and apply output identify the R2 account and both buckets; the exact confirmation prevents applying a reviewed path list to a different configured target. Apply rechecks every listed path while holding the product save lock where an R2 row exists. It fences stale R2 rows before deleting their public objects and retains any path that became eligible before deletion. It also returns interrupted `r2_public_revoking` rows to `r2_private` after their public object is gone. After cleanup, run the backfill again to restore public delivery for any still-eligible image that had been left revoking. A revoking row serves privately while it waits for recovery. If an admin mutation reports an unfinished revocation, it stops without changing the product; run this reconciliation during the maintenance window, then retry the mutation.

The apply mode deletes only public-bucket product cover/gallery paths with no currently eligible `r2_public` row. It does not touch Supabase originals or other object paths. Reconciliation needs public-bucket list access; apply also needs delete access.

## Rollback

To stop new R2 uploads, set `MEDIA_STORAGE_PROVIDER=supabase`. Existing R2 rows can be switched back one asset at a time after verifying the Supabase mirror:

```text
node --env-file=.env.local scripts/media-r2-backfill.mjs --rollback --asset-id [asset-uuid]
```

The rollback dry run also needs read access to both R2 buckets so it can verify that the Supabase mirror matches the retained private R2 object. After reviewing it, use the apply command below to switch that one row. Apply mode acquires the revocation fence, deletes the public R2 copy, switches the row through `r2_private`, then switches to Supabase. Once the private switch is confirmed, later failures leave the asset on a private-serving provider with the private R2 copy available. If the revocation fence cannot be acquired, the script leaves the public object untouched; run public-media reconciliation before retrying. For a broad cutover reversal, first run the script's dry run and then apply per asset through the approved maintenance process. Do not delete either bucket or Supabase source objects as part of rollback.

Rollback apply uses the same maintenance window and exact project/R2 confirmations as backfill:

```text
node --env-file=.env.local scripts/media-r2-backfill.mjs --rollback --asset-id [asset-uuid] --apply --confirm-project [project-ref] --confirm-r2-target [account-id/private-bucket/public-bucket]
```

## Verification evidence and limits

The local Playwright run captured the [desktop product catalog](media-r2-evidence/product-catalog.png), [desktop detail cover](media-r2-evidence/product-detail-cover.png), [mobile gallery preview](media-r2-evidence/mobile-gallery-preview.png), [admin upload previews](media-r2-evidence/admin-upload-previews.png), and [replacement/reorder after save and reload](media-r2-evidence/admin-replacement-saved.png). It uses built-in demo images and synthetic local upload fixtures; it verifies rendering and the admin replacement flow, not R2 delivery or production image sharpness.

Local focused checks cover the provider configuration, safe URL construction, upload-target selection, and existing Supabase media protections. The dated audit verifies public Production source dimensions, optimizer output dimensions, and response headers without writing to Production. It does not verify an R2 upload/replacement/delete lifecycle, cache behavior after unpublish, or a representative category render. Those require a local/Stage fixture or authorized Production category assignment, plus a deliberate cache configuration/object-metadata correction and a follow-up read-only probe.
