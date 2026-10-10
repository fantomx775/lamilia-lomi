# R2 image storage and CDN runbook

## Current behavior and image-quality evidence

The current production code uses one source image for catalog cards, product galleries, and the detail preview. Public requests to `/api/media/:assetId` require a published product and a public, active, non-premium asset, then redirect to a short lived storage URL. An authenticated admin can also preview saved public-kind assets on draft or archived products; those previews use a private signed URL. The image components set `unoptimized` for that route, so the configured responsive `sizes` values do not generate resized source variants. The browser also crops product cards and gallery tiles with `object-cover`.

That establishes two app-side quality limits: there are no app-generated thumbnail variants, and the same source can be cropped or displayed at a larger size. It does not prove that any particular production image is low resolution; this work did not download or inspect production media. The R2 path below enables responsive Next.js image variants for published R2 images. The Next optimizer receives the original CDN image and the existing component `sizes` hints. Supabase and local media keep their protected or existing paths.

Category images are not part of this change. The current category model has no image reference or upload flow; Issue #24 can add that against the provider-aware media reference introduced here.

## Scope and access rules

- Only public `cover` and `gallery` images can upload to R2.
- R2 uploads first land under `staging/` in a private bucket. The browser receives a short lived signed PUT URL and also uploads the same bytes to the existing private Supabase bucket as a rollback mirror.
- Saving the product verifies both copies, promotes the R2 private object to its stable key, and writes provider metadata in the same database transaction.
- A published product marks an eligible image `r2_public_pending` before copying it to the public R2 bucket. That state continues to serve from private R2. The row changes to `r2_public` only after the public copy and custom-domain response are verified; provider changes include the exact storage path and serialize with product saves.
- Draft and archived assets stay private. Before unpublish, archive, asset removal, or product deletion, the app moves the row to `r2_public_revoking`, which serves from private R2 and fences concurrent product saves from starting another public promotion. It verifies the private copy, deletes the public object, and returns the row to `r2_private` before changing product state. If deletion fails, the mutation stops and the row remains `r2_public_revoking` so a retry can find the possible public copy.
- Video, public downloads, premium files, and all existing rows default to Supabase. The premium authorization path is unchanged.
- Public R2 objects and optimized Next images use a one minute TTL to bound stale delivery after unpublish or deletion. A Cloudflare cache rule must honor the origin TTL; a rule that overrides it can extend the revocation window.
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

Local focused checks cover the provider configuration, safe URL construction, upload-target selection, and existing Supabase media protections. A real R2 data-plane upload, Cloudflare edge cache check, backfill, and published/unpublished browser run require the external buckets, S3 credentials, CORS setup, and custom domain listed above. Production source dimensions also remain unverified until a read-only media sample is authorized and available.
