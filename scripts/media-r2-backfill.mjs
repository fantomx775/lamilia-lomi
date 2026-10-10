import { createHash } from "node:crypto";

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

import { parseBackfillArgs, parseReconcileProductId } from "./media-r2-backfill-cli.mjs";
import {
  assertR2TargetConfirmation,
  cleanupFailedPublicBackfill,
  finalizePublicMediaBackfill,
  reconcilePublicProductImages,
  rollbackPublicMediaAsset,
} from "./media-r2-backfill-lifecycle.mjs";
import { isValidProductImagePath, planProductImageBackfill } from "./media-r2-backfill-plan.mjs";
import { createBackfillReportWriter } from "./media-r2-backfill-report.mjs";
import {
  assertObjectBytesMatch as verifyR2ObjectBytesMatch,
  ensurePrivateR2Object,
  verifyPublicMediaDeliveryBytes,
} from "./media-r2-backfill-integrity.mjs";

const { args, values } = parseBackfillArgs(process.argv.slice(2));

const apply = args.has("--apply");
const rollback = args.has("--rollback");
const reconcilePublic = args.has("--reconcile-public");
if (rollback && !isUuid(values.get("--asset-id") ?? "")) {
  fail("--rollback requires one UUID supplied with --asset-id.");
}
if (rollback && reconcilePublic) {
  fail("--rollback cannot be combined with --reconcile-public.");
}

const includeR2 = true;
const useR2 = apply || rollback || reconcilePublic;
let reconcileProductId;
try {
  reconcileProductId = parseReconcileProductId(args, values);
} catch (error) {
  fail(error instanceof Error ? error.message : "--product-id requires a product UUID.");
}
if (reconcileProductId && !reconcilePublic) {
  fail("--product-id is supported only with --reconcile-public.");
}
const config = readConfig({ includeR2, requireR2Credentials: useR2 });
const projectRef = new URL(config.supabaseUrl).hostname.split(".")[0];
const confirmedProject = values.get("--confirm-project");
if (apply && confirmedProject !== projectRef) {
  fail(`Write mode requires --confirm-project ${projectRef}. No credentials or objects were changed.`);
}
if (apply) {
  try {
    assertR2TargetConfirmation({
      confirmedTarget: values.get("--confirm-r2-target"),
      accountId: config.accountId,
      privateBucket: config.privateBucket,
      publicBucket: config.publicBucket,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : "Write mode requires the exact R2 account and bucket confirmation.");
  }
}
if (includeR2) {
  console.log(`R2 target: account ${config.accountId}, private bucket ${config.privateBucket}, public bucket ${config.publicBucket}.`);
}

const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const s3 = useR2 ? new S3Client({
  endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
  region: "auto",
  forcePathStyle: true,
  credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
}) : null;

if (rollback) {
  await rollbackAsset(values.get("--asset-id"), apply);
} else if (reconcilePublic) {
  await reconcilePublicBucketMedia(apply, reconcileProductId);
} else {
  await backfillProductImages();
}

async function reconcilePublicBucketMedia(write, productId) {
  const eligiblePublicPaths = await readPotentiallyEligiblePublicImagePaths(productId);
  const revokingRows = await readRevokingPublicAssetRows(productId);
  const rowsToRecover = new Map(revokingRows.map((row) => [row.id, row]));
  const result = await reconcilePublicProductImages({
    listPublicKeys: () => listPublicProductImageKeys(productId),
    eligiblePublicPaths,
    preparePublicObjectDeletion: async (key) => {
      const prepared = await prepareStalePublicObjectForDeletion(key);
      for (const row of prepared.fencedRows) rowsToRecover.set(row.id, row);
      return prepared.shouldDelete;
    },
    deletePublicObject: async (key) => {
      await s3.send(new DeleteObjectCommand({ Bucket: config.publicBucket, Key: key }));
    },
    apply: write,
  });

  console.log(
    `${write ? "APPLY" : "DRY RUN"}: scanned ${result.scannedObjects} public product-image objects; ${result.stalePaths.length} are stale${result.retainedPaths.length ? `; retained ${result.retainedPaths.length} that became eligible during apply` : ""}.`,
  );
  for (const key of result.stalePaths) {
    console.log(`${write ? "Removed" : "Would remove"} ${key}`);
  }
  for (const key of result.retainedPaths) {
    console.log(`Retained ${key}; a current eligible public or publishing image references this path.`);
  }
  const publicPaths = new Set(result.publicPaths);
  const removedPaths = new Set(result.stalePaths);
  const pathsToRecover = [...rowsToRecover.values()].filter((row) =>
    removedPaths.has(row.path) || !publicPaths.has(row.path) || eligiblePublicPaths.has(row.path),
  );
  for (const row of pathsToRecover) {
    console.log(`${write ? "Returned to private" : "Would return to private"} ${row.path} (r2_public_revoking)`);
    if (write) await setProviderIfExists(row.id, row.path, "r2_private");
  }
}

async function prepareStalePublicObjectForDeletion(storagePath) {
  let rows = await readPublicPathAssetRows(storagePath);
  if (rows.some(isPotentiallyEligiblePublicAsset)) {
    return { shouldDelete: false, fencedRows: [] };
  }

  const fencedRows = [];
  for (const row of rows) {
    if (!validRow(row)) continue;
    if (row.storage_provider === "r2_public_revoking") {
      fencedRows.push(row);
      continue;
    }
    if (!["r2_private", "r2_public_pending", "r2_public"].includes(row.storage_provider)) continue;

    const { data, error } = await supabase.rpc("begin_stale_product_asset_public_revocation", {
      requested_asset_id: row.id,
      requested_path: row.path,
    });
    if (error) fail(`Could not fence stale public media ${row.path}: ${error.message}`);
    if (data === true) {
      fencedRows.push(row);
      continue;
    }

    rows = await readPublicPathAssetRows(storagePath);
    if (rows.some(isPotentiallyEligiblePublicAsset)) {
      return { shouldDelete: false, fencedRows: [] };
    }
    const current = rows.find((candidate) => candidate.id === row.id && candidate.path === row.path);
    if (current?.storage_provider === "r2_public_revoking") {
      fencedRows.push(current);
      continue;
    }
    if (!current || current.storage_provider === "supabase") continue;
    fail(`Could not confirm the revocation fence for ${row.path}; the public object was left untouched.`);
  }

  return { shouldDelete: true, fencedRows };
}

async function readPublicPathAssetRows(storagePath) {
  const { data, error } = await supabase
    .from("product_assets")
    .select("id, product_id, kind, bucket, path, content_type, size_bytes, storage_provider, is_active, is_public, products!product_assets_product_id_fkey(status)")
    .eq("path", storagePath);
  if (error) fail(`Could not recheck public media path ${storagePath}: ${error.message}`);
  return data ?? [];
}

async function readPotentiallyEligiblePublicImagePaths(productId) {
  const paths = new Set();
  for (let offset = 0; ; offset += 200) {
    let query = supabase
      .from("product_assets")
      .select("id, product_id, kind, bucket, path, content_type, size_bytes, storage_provider, is_active, is_public, products!product_assets_product_id_fkey!inner(status)")
      .in("storage_provider", ["r2_public_pending", "r2_public"])
      .eq("products.status", "published")
      .eq("is_active", true)
      .eq("is_public", true)
      .eq("bucket", "public-media")
      .in("kind", ["cover", "gallery"])
      .like("path", "products/%")
      .order("path")
      .range(offset, offset + 199);
    if (productId) query = query.eq("product_id", productId);
    const { data, error } = await query;
    if (error) fail(`Could not read eligible public or publishing media rows: ${error.message}`);

    for (const row of data ?? []) {
      if (validRow(row)) paths.add(row.path);
    }
    if (!data || data.length < 200) break;
  }

  return paths;
}

async function readRevokingPublicAssetRows(productId) {
  const rows = [];
  for (let offset = 0; ; offset += 200) {
    let query = supabase
      .from("product_assets")
      .select("id, product_id, kind, bucket, path, content_type, size_bytes, storage_provider")
      .eq("storage_provider", "r2_public_revoking")
      .eq("bucket", "public-media")
      .in("kind", ["cover", "gallery"])
      .like("path", "products/%")
      .order("path")
      .range(offset, offset + 199);
    if (productId) query = query.eq("product_id", productId);
    const { data, error } = await query;
    if (error) fail(`Could not read revoking public media rows: ${error.message}`);

    for (const row of data ?? []) {
      if (validRow(row)) rows.push(row);
    }
    if (!data || data.length < 200) break;
  }

  return rows;
}

async function* listPublicProductImageKeys(productId) {
  let continuationToken;
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: config.publicBucket,
      Prefix: productId ? `products/${productId}/` : "products/",
      ContinuationToken: continuationToken,
    }));
    yield (page.Contents ?? []).map((object) => object.Key).filter((key) => typeof key === "string");

    if (!page.IsTruncated) break;
    if (!page.NextContinuationToken || page.NextContinuationToken === continuationToken) {
      fail("R2 returned an invalid pagination token while reconciling public product media.");
    }
    continuationToken = page.NextContinuationToken;
  } while (true);
}

async function backfillProductImages() {
  let candidates = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase
      .from("product_assets")
      .select("id, product_id, kind, bucket, path, content_type, size_bytes, storage_provider, is_active, is_public, products!product_assets_product_id_fkey!inner(status)")
      .in("kind", ["cover", "gallery"])
      .order("product_id")
      .order("id")
      .range(offset, offset + 199);
    if (error) fail(`Could not read candidate media rows: ${error.message}`);
    candidates = candidates.concat(data ?? []);
    if (!data || data.length < 200) break;
  }

  console.log(`${apply ? "APPLY" : "DRY RUN"}: inventorying ${candidates.length} cover/gallery rows in Supabase project ${projectRef}.`);

  const reportWriter = await createBackfillReportWriter({
    requestedPath: values.get("--report-file"),
    mode: apply ? "apply" : "dry-run",
    projectRef,
    target: {
      privateBucket: config.privateBucket,
      publicBucket: config.publicBucket,
      publicBaseUrl: config.publicBaseUrl,
    },
  });
  const assets = [];
  let verifiedSourceBytes = 0;
  let successfulCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const listedRow of candidates) {
    let row = listedRow;
    let plan = planProductImageBackfill(row);
    const record = backfillInventoryRecord(row, plan);

    try {
      if (apply) {
        await reportWriter.appendAsset({ phase: "started", ...record, result: "in_progress" });
        const current = await readBackfillAsset(row.id);
        if (!current) throw new Error("Asset row no longer exists; refresh the inventory before retrying.");
        row = current;
        plan = planProductImageBackfill(row);
        Object.assign(record, backfillInventoryRecord(row, plan));
      }

      if (plan.disposition === "skip") {
        record.result = "skipped";
        record.reason = plan.reason;
        skippedCount += 1;
      } else {
        const { data: source, error } = await supabase.storage.from(row.bucket).download(row.path);
        if (error || !source) throw new Error("Supabase source image could not be read.");
        const bytes = Buffer.from(await source.arrayBuffer());
        if (row.size_bytes !== null && row.size_bytes !== undefined && bytes.byteLength !== Number(row.size_bytes)) {
          throw new Error("Supabase source size does not match its database record.");
        }

        const sha256 = createHash("sha256").update(bytes).digest("hex");
        verifiedSourceBytes += bytes.byteLength;
        record.source = { byteLength: bytes.byteLength, sha256, contentType: row.content_type };
        record.result = apply ? "migrated" : "planned";
        record.target = {
          privateBucket: config.privateBucket,
          key: row.path,
          publicBucket: plan.publicEligible ? config.publicBucket : null,
          publicUrl: plan.publicEligible ? `${config.publicBaseUrl}/${encodePath(row.path)}` : null,
        };

        if (apply) {
          record.finalProvider = await migrateProductImage(row, bytes, sha256);
          successfulCount += 1;
        }
      }
    } catch (error) {
      record.result = "failed";
      record.failure = safeFailureMessage(error);
      failedCount += 1;
      process.exitCode = 1;
    }

    assets.push(record);
    console.log(JSON.stringify({ type: "asset", ...record }));
    await reportWriter.appendAsset({ phase: "finished", ...record });
  }

  const summary = {
    inventoryCount: assets.length,
    eligibleCount: assets.filter((asset) => asset.disposition === "migrate").length,
    plannedCount: assets.filter((asset) => asset.result === "planned").length,
    migratedCount: successfulCount,
    privateCount: assets.filter((asset) => asset.finalProvider === "r2_private").length,
    publicCount: assets.filter((asset) => asset.finalProvider === "r2_public").length,
    failedCount,
    skippedCount,
    verifiedSourceBytes,
    supabaseOriginalsDeleted: 0,
  };
  await reportWriter.finish(summary);
  console.log(`${apply ? "APPLY" : "DRY RUN"} summary: ${JSON.stringify(summary)}`);
  console.log(`Reviewable, resumable per-asset JSONL report: ${reportWriter.path}`);

  if (skippedCount > 0) process.exitCode = 1;
}

async function migrateProductImage(listedRow, bytes, sha256) {
  await ensureR2Object(config.privateBucket, listedRow.path, bytes, listedRow.content_type, sha256, "private, no-store");

  let current = await readBackfillAsset(listedRow.id);
  if (!current || current.path !== listedRow.path) {
    throw new Error("Asset path changed during migration; the verified R2 copy was retained for review.");
  }
  let plan = planProductImageBackfill(current);
  if (plan.disposition === "skip") throw new Error(`Asset became ineligible during migration: ${plan.reason}.`);
  if (current.storage_provider === "r2_public_revoking") {
    throw new Error("An R2 public revocation is in progress; reconcile public media and retry this asset.");
  }

  if (current.storage_provider === "supabase") {
    await setProviderOrConfirm(current.id, current.path, "r2_private");
    current = await readBackfillAsset(current.id);
    if (!current || current.path !== listedRow.path) {
      throw new Error("Asset path changed after the private provider transition.");
    }
    plan = planProductImageBackfill(current);
    if (plan.disposition === "skip") throw new Error(`Asset became ineligible during migration: ${plan.reason}.`);
  }

  if (plan.publicEligible) {
    if (current.storage_provider === "r2_public") {
      await verifyExistingR2PublicCopy(current, sha256, bytes.byteLength);
      return "r2_public";
    }
    await publishBackfilledImage(current, sha256, bytes.byteLength);
    return "r2_public";
  }

  await returnBackfilledImageToPrivate(current);
  let latest = await readBackfillAsset(current.id);
  if (!latest || latest.path !== listedRow.path) {
    throw new Error("Asset disappeared after private migration; rerun the inventory to confirm its final state.");
  }
  if (latest.storage_provider === "r2_public_revoking") {
    throw new Error("The asset remains r2_public_revoking; reconcile public media and retry this asset.");
  }
  plan = planProductImageBackfill(latest);
  if (plan.disposition === "skip") throw new Error(`Asset became ineligible during migration: ${plan.reason}.`);
  if (plan.publicEligible) {
    if (latest.storage_provider === "r2_public") {
      await verifyExistingR2PublicCopy(latest, sha256, bytes.byteLength);
      return "r2_public";
    }
    if (latest.storage_provider === "r2_private" || latest.storage_provider === "r2_public_pending") {
      await publishBackfilledImage(latest, sha256, bytes.byteLength);
      return "r2_public";
    }
    throw new Error(`Asset became public-eligible with unexpected provider ${latest.storage_provider}.`);
  }
  if (latest.storage_provider === "r2_public_pending" || latest.storage_provider === "r2_public") {
    await returnBackfilledImageToPrivate(latest);
    latest = await readBackfillAsset(latest.id);
  }
  if (!latest || latest.path !== listedRow.path || latest.storage_provider !== "r2_private") {
    throw new Error("The asset did not settle on a verified private R2 provider; rerun after reconciliation.");
  }
  return "r2_private";
}

async function publishBackfilledImage(row, sha256, byteLength) {
  const current = await readBackfillAsset(row.id);
  if (!current || current.path !== row.path) throw new Error("Asset path changed before public promotion.");
  const plan = planProductImageBackfill(current);
  if (plan.disposition !== "migrate" || !plan.publicEligible) {
    throw new Error("Asset is no longer eligible for public R2 delivery.");
  }

  await setProviderOrConfirm(row.id, row.path, "r2_public_pending");
  const existingPublic = await findExisting(config.publicBucket, row.path);
  if (existingPublic) {
    if (existingPublic.ContentLength !== byteLength) {
      throw new Error("Existing public R2 object has a different size; it was left untouched.");
    }
    await assertObjectBytesMatch(config.publicBucket, row.path, byteLength, sha256);
  }

  try {
    await ensureR2PublicCopy(row, sha256, byteLength);
  } catch (error) {
    try {
      await cleanupFailedPublicBackfill({
        readCurrentAsset: () => readBackfillAssetSnapshot(row.id, row.path),
        hasOtherEligibleReference: () => hasOtherEligiblePublicReference(row),
        beginPublicRevocation: () => beginProductAssetPublicRevocation(row.id, row.path),
        deletePublicObject: () => s3.send(new DeleteObjectCommand({
          Bucket: config.publicBucket,
          Key: row.path,
        })),
        setPrivateProvider: () => setProviderOrConfirm(row.id, row.path, "r2_private"),
      });
    } catch (cleanupError) {
      throw new Error(
        `Public copy verification failed: ${safeFailureMessage(error)}. Cleanup status: ${safeFailureMessage(cleanupError)}`,
        { cause: cleanupError },
      );
    }
    throw error;
  }

  await finalizeBackfilledPublicImage(row, sha256, byteLength);
}

async function returnBackfilledImageToPrivate(row) {
  const existingPublic = await findExisting(config.publicBucket, row.path);
  if (!existingPublic && row.storage_provider === "r2_private") return;

  if (row.storage_provider === "supabase") {
    await setProviderOrConfirm(row.id, row.path, "r2_private");
  }
  const acquired = await beginProductAssetPublicRevocation(row.id, row.path);
  if (!acquired) {
    const latest = await readBackfillAsset(row.id);
    if (latest?.storage_provider === "r2_public_revoking") {
      throw new Error("An R2 public revocation is in progress; reconcile public media and retry this asset.");
    }
    throw new Error("Could not acquire the public revocation fence for this ineligible image.");
  }

  const rowsForPath = await readPublicPathAssetRows(row.path);
  const anotherEligibleReference = rowsForPath.some(isPotentiallyEligiblePublicAsset);
  if (existingPublic && !anotherEligibleReference) {
    await s3.send(new DeleteObjectCommand({ Bucket: config.publicBucket, Key: row.path }));
  }
  await setProviderOrConfirm(row.id, row.path, "r2_private");
}

async function beginProductAssetPublicRevocation(assetId, storagePath) {
  const { data, error } = await supabase.rpc("begin_product_asset_public_revocation", {
    requested_asset_id: assetId,
    requested_path: storagePath,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

async function finalizeBackfilledPublicImage(row, sha256, byteLength) {
  await finalizePublicMediaBackfill({
    setPublicProvider: () => setProviderOrConfirm(row.id, row.path, "r2_public"),
    beginPublicRevocation: () => beginProductAssetPublicRevocation(row.id, row.path),
    readCurrentAsset: () => readBackfillAssetSnapshot(row.id, row.path),
    deletePublicObject: () => s3.send(new DeleteObjectCommand({ Bucket: config.publicBucket, Key: row.path })),
    setPrivateProvider: () => setProviderOrConfirm(row.id, row.path, "r2_private"),
    setPendingProvider: () => setProviderOrConfirm(row.id, row.path, "r2_public_pending"),
    restorePublicObject: () => ensureR2PublicCopy(row, sha256, byteLength),
    hasOtherEligibleReference: () => hasOtherEligiblePublicReference(row),
  });
}

async function hasOtherEligiblePublicReference(row) {
  const rows = await readPublicPathAssetRows(row.path);
  return rows.some((candidate) => (
    candidate.id !== row.id && isPotentiallyEligiblePublicAsset(candidate)
  ));
}

async function readBackfillAsset(assetId) {
  const { data, error } = await supabase
    .from("product_assets")
    .select("id, product_id, kind, bucket, path, content_type, size_bytes, storage_provider, is_active, is_public, products!product_assets_product_id_fkey!inner(status)")
    .eq("id", assetId)
    .maybeSingle();
  if (error) throw new Error("Could not refresh the current product image row.");
  return data ?? null;
}

async function readBackfillAssetSnapshot(assetId, storagePath) {
  const current = await readBackfillAsset(assetId);
  if (!current || current.path !== storagePath) return null;
  const product = Array.isArray(current.products) ? current.products[0] : current.products;
  return {
    storageProvider: current.storage_provider,
    isActive: current.is_active,
    isPublic: current.is_public,
    productStatus: product?.status,
  };
}

function isPotentiallyEligiblePublicAsset(row) {
  const product = Array.isArray(row.products) ? row.products[0] : row.products;
  return (
    validRow(row) &&
    ["r2_public_pending", "r2_public"].includes(row.storage_provider) &&
    row.is_active === true &&
    row.is_public === true &&
    product?.status === "published"
  );
}

function backfillInventoryRecord(row, plan) {
  const product = Array.isArray(row.products) ? row.products[0] : row.products;
  const canTargetPrivate =
    plan.disposition === "migrate" &&
    validRow(row) &&
    row.is_public === true &&
    row.storage_provider !== "r2_public_revoking";
  const publicEligible = plan.disposition === "migrate" && plan.publicEligible;
  return {
    assetId: row.id,
    productId: row.product_id,
    productStatus: product?.status ?? plan.productStatus,
    kind: row.kind,
    source: {
      bucket: row.bucket,
      key: row.path,
      recordedBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
      contentType: row.content_type,
    },
    currentProvider: row.storage_provider,
    active: row.is_active === true,
    public: row.is_public === true,
    disposition: plan.disposition,
    result: plan.disposition === "skip" ? "skipped" : "pending",
    reason: plan.reason ?? null,
    target: canTargetPrivate
      ? {
          privateBucket: config.privateBucket,
          privateKey: row.path,
          publicBucket: publicEligible ? config.publicBucket : null,
          publicUrl: publicEligible ? `${config.publicBaseUrl}/${encodePath(row.path)}` : null,
        }
      : null,
  };
}

function safeFailureMessage(error) {
  const message = error instanceof Error ? error.message : "Unknown migration failure.";
  return message
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b((?:access[_-]?key|secret(?:[_-]?access)?key|token|password)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/([?&](?:token|key|signature)=)[^&\s]+/gi, "$1[redacted]");
}

function encodePath(storagePath) {
  return storagePath.split("/").map(encodeURIComponent).join("/");
}

async function rollbackAsset(assetId, write) {
  const { data: row, error } = await supabase
    .from("product_assets")
    .select("id, product_id, kind, bucket, path, content_type, size_bytes, storage_provider")
    .eq("id", assetId)
    .maybeSingle();
  if (error || !row) fail(`Asset ${assetId} was not found in Supabase project ${projectRef}.`);
  if (!validRow(row)) {
    fail(`Asset ${assetId} does not match the public product media path contract.`);
  }

  const { data: source, error: sourceError } = await supabase.storage.from(row.bucket).download(row.path);
  if (sourceError || !source) fail(`Supabase mirror for asset ${assetId} is unavailable.`);
  if (row.kind !== "cover" && row.kind !== "gallery") {
    fail(`Asset ${assetId} is not a public cover or gallery image.`);
  }
  const sourceBytes = Buffer.from(await source.arrayBuffer());
  if (row.size_bytes !== null && row.size_bytes !== undefined && sourceBytes.byteLength !== Number(row.size_bytes)) {
    fail(`Supabase mirror for asset ${assetId} does not match its recorded size.`);
  }
  const sha256 = createHash("sha256").update(sourceBytes).digest("hex");

  if (row.storage_provider !== "supabase") {
    const privateObject = await s3.send(new GetObjectCommand({ Bucket: config.privateBucket, Key: row.path }));
    const privateBytes = await bodyToBuffer(privateObject.Body, `R2 private copy for asset ${assetId}`);
    const privateSha256 = createHash("sha256").update(privateBytes).digest("hex");
    if (
      privateBytes.byteLength !== sourceBytes.byteLength ||
      privateSha256 !== sha256 ||
      (privateObject.Metadata?.sha256 && privateObject.Metadata.sha256 !== sha256) ||
      (row.content_type && privateObject.ContentType && privateObject.ContentType !== row.content_type)
    ) {
      fail(`Supabase mirror for asset ${assetId} does not match the retained private R2 object; no provider or public object was changed.`);
    }
  }

  console.log(`${write ? "ROLLBACK" : "DRY RUN"}: asset ${assetId} currently uses ${row.storage_provider}; Supabase mirror sha256 ${sha256} matches the retained private R2 copy where applicable.`);

  if (write) {
    const rollback = await rollbackPublicMediaAsset({
      storageProvider: row.storage_provider,
      hasOtherEligibleReference: async () => {
        const rows = await readPublicPathAssetRows(row.path);
        return rows.some((candidate) => (
          candidate.id !== row.id && isPotentiallyEligiblePublicAsset(candidate)
        ));
      },
      beginPublicRevocation: async () => {
        const { data, error } = await supabase.rpc("begin_product_asset_public_revocation", {
          requested_asset_id: row.id,
          requested_path: row.path,
        });
        if (error) throw new Error(error.message);
        return data === true;
      },
      deletePublicObject: () => s3.send(new DeleteObjectCommand({ Bucket: config.publicBucket, Key: row.path })),
      setPrivateProvider: () => setProviderOrConfirm(row.id, row.path, "r2_private"),
      setSupabaseProvider: () => setProviderOrConfirm(row.id, row.path, "supabase"),
    });
    console.log(rollback.publicObjectDeleted
      ? `Asset ${assetId} now uses Supabase. The private R2 copy was retained for recovery; the public R2 copy was removed.`
      : `Asset ${assetId} now uses Supabase. The public R2 copy was retained because another eligible R2 image references the same key.`);
  }
}

async function ensureR2Object(bucket, key, bytes, contentType, sha256, cacheControl) {
  return ensurePrivateR2Object({
    bucket,
    key,
    bytes,
    contentType,
    sha256,
    cacheControl,
    findExisting: () => findExisting(bucket, key),
    putObject: (input) => s3.send(new PutObjectCommand(input)),
    readObject: () => s3.send(new GetObjectCommand({ Bucket: bucket, Key: key })),
  });
}

async function ensureR2PublicCopy(row, sha256, byteLength) {
  await s3.send(new CopyObjectCommand({
    Bucket: config.publicBucket,
    Key: row.path,
    CopySource: `/${config.privateBucket}/${row.path.split("/").map(encodeURIComponent).join("/")}`,
    MetadataDirective: "REPLACE",
    ContentType: row.content_type || "application/octet-stream",
    CacheControl: "public, max-age=60, s-maxage=60, must-revalidate",
    Metadata: { sha256 },
  }));

  const verified = await s3.send(new HeadObjectCommand({ Bucket: config.publicBucket, Key: row.path }));
  if (
    verified.ContentLength !== byteLength ||
    verified.ContentType !== (row.content_type || "application/octet-stream") ||
    (verified.Metadata?.sha256 && verified.Metadata.sha256 !== sha256)
  ) {
    fail(`R2 public object ${row.path} failed post-copy verification.`);
  }
  await assertObjectBytesMatch(config.publicBucket, row.path, byteLength, sha256);
  await verifyR2PublicDelivery(row, byteLength, sha256);
}

async function verifyExistingR2PublicCopy(row, sha256, byteLength) {
  const existing = await findExisting(config.publicBucket, row.path);
  if (!existing) {
    throw new Error(`Asset ${row.id} is marked r2_public but its R2 object is missing; inspect the provider state before retrying.`);
  }
  if (
    existing.ContentLength !== byteLength ||
    existing.ContentType !== (row.content_type || "application/octet-stream")
  ) {
    fail(`R2 public object ${row.path} does not match the published asset metadata; it was left untouched.`);
  }
  await assertObjectBytesMatch(config.publicBucket, row.path, byteLength, sha256);
  await verifyR2PublicDelivery(row, byteLength, sha256);
  // Finalize through the revocation-aware path so a concurrent
  // archive/unpublish is observed before this row is reported as verified.
  await finalizeBackfilledPublicImage(row, sha256, byteLength);
}

async function verifyR2PublicDelivery(row, byteLength, sha256) {
  const publicUrl = `${config.publicBaseUrl}/${row.path.split("/").map(encodeURIComponent).join("/")}`;
  await verifyPublicMediaDeliveryBytes({
    url: publicUrl,
    key: row.path,
    expectedByteLength: byteLength,
    expectedSha256: sha256,
    expectedContentType: row.content_type || "application/octet-stream",
  });
}

async function setProviderOrConfirm(assetId, storagePath, provider) {
  const { data, error } = await supabase.rpc("set_product_asset_storage_provider", {
    requested_asset_id: assetId,
    requested_provider: provider,
    requested_path: storagePath,
  });
  if (!error && data === true) return;

  const { data: current, error: readError } = await supabase
    .from("product_assets")
    .select("storage_provider")
    .eq("id", assetId)
    .eq("path", storagePath)
    .maybeSingle();
  if (readError || !current) {
    throw new Error(`Could not confirm media provider for asset ${assetId}; no further public object changes were made.`);
  }
  if (current.storage_provider === provider) return;
  throw new Error(`Could not switch asset ${assetId} to ${provider}; current provider remains ${current.storage_provider}.`);
}

async function setProviderIfExists(assetId, storagePath, provider) {
  const { data, error } = await supabase
    .from("product_assets")
    .select("id")
    .eq("id", assetId)
    .eq("path", storagePath)
    .maybeSingle();
  if (error) fail(`Could not confirm asset ${assetId} before provider recovery: ${error.message}`);
  if (!data) return;
  await setProviderOrConfirm(assetId, storagePath, provider);
}

async function assertObjectBytesMatch(bucket, key, expectedBytesOrLength, expectedSha256) {
  await verifyR2ObjectBytesMatch({
    readObject: () => s3.send(new GetObjectCommand({ Bucket: bucket, Key: key })),
    key,
    expectedBytesOrLength,
    expectedSha256,
  });
}

async function bodyToBuffer(body, description) {
  if (!body || typeof body.transformToByteArray !== "function") {
    fail(`${description} could not be read for byte verification.`);
  }
  return Buffer.from(await body.transformToByteArray());
}

async function findExisting(bucket, key) {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey") return null;
    throw error;
  }
}

function validRow(row) {
  return (
    (row.kind === "cover" || row.kind === "gallery") &&
    row.bucket === "public-media" &&
    isValidProductImagePath(row)
  );
}

function readConfig({ includeR2, requireR2Credentials }) {
  const missing = [];
  const requireValue = (name) => {
    const value = process.env[name]?.trim();
    if (!value) missing.push(name);
    return value;
  };
  const optionalValue = (name) => process.env[name]?.trim() ?? "";
  const config = {
    supabaseUrl: requireValue("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseServiceKey: process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    accountId: includeR2 ? requireValue("R2_ACCOUNT_ID") : "",
    accessKeyId: requireR2Credentials ? requireValue("R2_ACCESS_KEY_ID") : optionalValue("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireR2Credentials ? requireValue("R2_SECRET_ACCESS_KEY") : optionalValue("R2_SECRET_ACCESS_KEY"),
    privateBucket: includeR2 ? requireValue("R2_PRIVATE_BUCKET") : "",
    publicBucket: includeR2 ? requireValue("R2_PUBLIC_BUCKET") : "",
    publicBaseUrl: includeR2 ? requireValue("R2_PUBLIC_BASE_URL") : "",
  };
  if (!config.supabaseServiceKey) missing.push("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) fail(`Missing required environment variable names: ${missing.join(", ")}.`);
  if (includeR2 && config.privateBucket === config.publicBucket) fail("Private and public R2 buckets must be different.");
  if (includeR2) {
    let publicUrl;
    try {
      publicUrl = new URL(config.publicBaseUrl);
    } catch {
      fail("R2_PUBLIC_BASE_URL must be an HTTPS origin.");
    }
    if (publicUrl.protocol !== "https:" || publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash) {
      fail("R2_PUBLIC_BASE_URL must be an HTTPS origin without a path, query, or fragment.");
    }
    config.publicBaseUrl = publicUrl.origin;
  }
  return config;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}
