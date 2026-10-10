import "server-only";

import fs from "node:fs";
import path from "node:path";

import { getRequiredSupabaseEnv, getBackendMode } from "./config";
import { createServiceRoleClient } from "./supabase/admin";
import { createClient } from "./supabase/server";
import type { AssetKind, ProductAsset, ProductStatus } from "./types";
import { getR2StorageConfig, type MediaStorageProvider } from "./media-r2-config";
import {
  assertR2PrivateObject,
  assertR2PublicObject,
  deleteR2PublicMedia,
  demoteR2PublicObject,
  finalizeR2StagingUpload,
  promoteR2PrivateObject,
  r2StagingPath,
  verifyPublicDelivery,
} from "./media-r2";
import {
  filenameWithCollisionSuffix,
  mediaBucketForKind,
  mediaFilenameForDisplay,
  mediaFilenameForStorage,
} from "./media-upload";

export type StoredMediaFile = {
  bucket: string;
  storagePath: string;
  publicPath: string;
  filename: string;
};

export type SignedMediaUpload = StoredMediaFile & {
  uploadEndpoint: string;
  uploadToken: string;
};

export async function createSignedMediaUpload(input: {
  assetId: string;
  productId: string;
  kind: AssetKind;
  filename: string;
  authorizationToken?: string | null;
}): Promise<SignedMediaUpload> {
  if (getBackendMode() !== "supabase") {
    throw new Error("Signed Supabase uploads are unavailable in local mode.");
  }

  const filename = mediaFilenameForDisplay(input.filename);
  const storageFilename = mediaFilenameForStorage(filename);
  const bucket = mediaBucketForKind(input.kind);
  const env = getRequiredSupabaseEnv();
  const storagePath = `products/${input.productId}/${input.kind}/${input.assetId}-${storageFilename}`;
  const { data, error } = await createServiceRoleClient({
    storageAuthorizationToken: input.authorizationToken ?? undefined,
  })
    .storage
    .from(bucket)
    .createSignedUploadUrl(storagePath);

  if (error || !data?.token) {
    throw new Error(`Nie udało się przygotować uploadu w Storage: ${error?.message ?? "brak tokenu"}`);
  }

  return {
    bucket,
    storagePath,
    publicPath: bucket === "premium-files" ? storagePath : `/api/media/${input.assetId}`,
    filename,
    uploadEndpoint: resumableUploadEndpoint(env.url),
    uploadToken: data.token,
  };
}

export async function storeMediaFile(input: {
  productId: string;
  kind: AssetKind;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  authorizationToken?: string | null;
}): Promise<StoredMediaFile> {
  const filename = mediaFilenameForDisplay(input.filename);
  const storageFilename = mediaFilenameForStorage(filename);
  const bucket = mediaBucketForKind(input.kind);

  if (getBackendMode() === "local") {
    return storeLocalFile({ ...input, bucket, filename, storageFilename });
  }

  const supabase = createServiceRoleClient({
    storageAuthorizationToken: input.authorizationToken ?? undefined,
  });
  const basePath = `products/${input.productId}/${input.kind}`;

  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = filenameWithCollisionSuffix(storageFilename, suffix);
    const storagePath = `${basePath}/${candidate}`;
    const { error } = await supabase.storage.from(bucket).upload(storagePath, input.bytes, {
      cacheControl: "31536000",
      contentType: input.contentType,
      upsert: false,
    });

    if (!error) {
      return {
        bucket,
        storagePath,
        publicPath: bucket === "premium-files"
          ? storagePath
          : publicStoragePath(getRequiredSupabaseEnv().url, bucket, storagePath),
        filename,
      };
    }

    if (!isDuplicateStorageError(error)) {
      throw new Error(`Nie udało się zapisać pliku w Storage: ${error.message}`);
    }
  }

  throw new Error("Nie udało się znaleźć wolnej nazwy pliku.");
}

export async function removeUploadedMedia(input: {
  productId: string;
  kind: AssetKind;
  storagePath: string;
  storageProvider?: MediaStorageProvider;
  authorizationToken?: string | null;
}) {
  if (getBackendMode() === "local") {
    removeLocalFile(input);
    return true;
  }

  const expectedPrefix = `products/${input.productId}/${input.kind}/`;

  if (!input.storagePath.startsWith(expectedPrefix)) {
    throw new Error("Nieprawidłowa ścieżka usuwanego uploadu.");
  }

  console.warn("Odłożono usunięcie pliku chmurowego do kontrolowanego sprzątania, aby nie skasować obiektu używanego przez zapis produktu.");
  return false;
}

export async function cleanupNewMediaFromFormData(
  formData: FormData,
  authorizationToken?: string | null,
): Promise<Array<{ assetId: string; kind: AssetKind; storagePath: string }>> {
  if (getBackendMode() !== "local") {
    console.warn("Zachowano upload chmurowy po odrzuceniu zapisu produktu, aby nie usunąć pliku używanego przez równoległy zapis.");
    return [];
  }
  const productId = stringField(formData, "id");
  const ids = formData.getAll("assetId");
  const kinds = formData.getAll("assetKind");
  const paths = formData.getAll("assetPath");
  const providers = formData.getAll("assetStorageProvider");
  const uploaded = formData.getAll("assetUploaded");

  if (!productId) return [];

  const tasks: Promise<{ assetId: string; kind: AssetKind; storagePath: string } | null>[] = [];

  for (let index = 0; index < Math.max(ids.length, kinds.length, paths.length); index += 1) {
    if (stringAt(uploaded, index) !== "1") continue;

    const kind = stringAt(kinds, index);
    const storagePath = stringAt(paths, index);
    const assetId = stringAt(ids, index);

    if (isAssetKind(kind) && storagePath && assetId) {
      tasks.push(removeUploadedMedia({
        productId,
        kind,
        storagePath,
        storageProvider: providerAt(providers, index),
        authorizationToken,
      })
        .then(() => null)
        .catch(() => ({ assetId, kind, storagePath })));
    }
  }

  return (await Promise.all(tasks)).filter((failure): failure is NonNullable<typeof failure> => failure !== null);
}

export async function cleanupPersistedMedia(input: {
  previous: ProductAsset[];
  next: ProductAsset[];
}) {
  const nextReferences = new Set(
    input.next
      .map(storageReference)
      .filter((reference): reference is StorageReference => Boolean(reference))
      .map(referenceKey),
  );
  const removed = input.previous
    .map((asset) => ({ asset, reference: storageReference(asset) }))
    .filter((item): item is { asset: ProductAsset; reference: StorageReference } => {
      const reference = item.reference;
      return reference !== null && !nextReferences.has(referenceKey(reference));
    });

  await Promise.all(
    removed.map(async ({ asset, reference }) => {
      // Persisted cloud objects are rollback sources. Public R2 copies are
      // revoked before the metadata mutation, but neither those private R2
      // copies nor the original Supabase objects may be deleted here.
      if (reference.backend !== "local") return;

      try {
        await removeUploadedMedia({
          productId: asset.productId,
          kind: asset.kind,
          storagePath: reference.path,
        });
      } catch (error) {
        console.error("Nie udało się posprzątać usuniętego assetu w Storage.", error);
      }
    }),
  );
}

export async function finalizeR2MediaUploads(
  assets: ProductAsset[],
  newlyUploadedAssetIds: Set<string>,
) {
  for (const asset of assets) {
    if ((asset.storageProvider ?? "supabase") !== "r2_private") continue;
    const storagePath = asset.storagePath ?? asset.path;
    if (!storagePath.startsWith(`products/${asset.productId}/${asset.kind}/`)) {
      throw new Error("Nieprawidłowa ścieżka assetu R2.");
    }

    if (newlyUploadedAssetIds.has(asset.id)) {
      const stagingPath = r2StagingPath(storagePath);
      await finalizeR2StagingUpload({
        stagingPath,
        storagePath,
        contentType: asset.contentType,
        sizeBytes: asset.sizeBytes ?? 0,
      });
    } else {
      await assertR2PrivateObject(storagePath, asset.sizeBytes);
    }
  }
}

export async function revokeR2PublicAssetsBeforeMutation(input: {
  previousAssets: ProductAsset[];
  nextAssets: ProductAsset[];
  status: ProductStatus;
}) {
  const revokedAssetIds = new Set<string>();
  if (getBackendMode() !== "supabase") return revokedAssetIds;

  const nextById = new Map(input.nextAssets.map((asset) => [asset.id, asset]));
  for (const previous of input.previousAssets) {
    if (
      (previous.storageProvider ?? "supabase") !== "r2_public" &&
      (previous.storageProvider ?? "supabase") !== "r2_public_pending" &&
      (previous.storageProvider ?? "supabase") !== "r2_public_revoking"
    ) continue;
    const next = nextById.get(previous.id);
    const samePublicReference = Boolean(
      next &&
      (next.storageProvider === "r2_public" || next.storageProvider === "r2_public_pending") &&
      next.isActive !== false &&
      next.isPublic &&
      (next.storagePath ?? next.path) === (previous.storagePath ?? previous.path),
    );
    if (input.status === "published" && samePublicReference) continue;

    if (await revokeR2PublicAsset(previous)) revokedAssetIds.add(previous.id);
  }

  return revokedAssetIds;
}

export async function reconcileR2Publication(input: {
  assets: ProductAsset[];
  previousAssets: ProductAsset[];
  status: ProductStatus;
}) {
  if (getBackendMode() !== "supabase") return;

  let assets = input.assets;
  let previousAssets = input.previousAssets;
  let status = input.status;
  try {
    const allAssets = [...assets, ...previousAssets];
    const assetIds = [...new Set(allAssets.map((asset) => asset.id))];
    const productId = allAssets[0]?.productId;
    if (assetIds.length) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("product_assets")
        .select("id, path, storage_provider")
        .in("id", assetIds);
      if (error) throw new Error(error.message);
      const currentById = new Map((data ?? []).map((row) => [row.id, row]));
      const refresh = (source: ProductAsset[]) => source.map((asset) => {
        const current = currentById.get(asset.id);
        const storagePath = asset.storagePath ?? asset.path;
        if (!current || current.path !== storagePath) return asset;
        return { ...asset, storageProvider: storageProviderValue(current.storage_provider) };
      });
      assets = refresh(assets);
      previousAssets = refresh(previousAssets);
      if (productId) {
        const { data: currentProduct, error: productError } = await supabase
          .from("products")
          .select("status")
          .eq("id", productId)
          .maybeSingle();
        if (productError) throw new Error(productError.message);
        if (currentProduct) {
          status = currentProduct.status === "published" ? "published" : "archived";
        }
      }
    }
  } catch (error) {
    console.error("Nie udało się odświeżyć stanu produktu i providerów mediów po zapisie; publikacja nie będzie kontynuowana.", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return;
  }

  if (status === "published") {
    for (const asset of assets) {
      const provider = asset.storageProvider ?? "supabase";
      if (provider !== "r2_private" && provider !== "r2_public_pending" && provider !== "r2_public") continue;
      if (asset.kind !== "cover" && asset.kind !== "gallery") continue;

      const storagePath = asset.storagePath ?? asset.path;
      if (asset.isActive === false || !asset.isPublic) {
        if (provider === "r2_public" || provider === "r2_public_pending") {
          try {
            await revokeR2PublicAsset(asset);
          } catch (error) {
            console.error("Nie udało się wycofać publicznej kopii niekwalifikującego się assetu R2; provider pozostaje oznaczony jako publiczny do ponowienia.", {
              assetId: asset.id,
              error: error instanceof Error ? error.message : "unknown",
            });
          }
        }
        continue;
      }

      try {
        if (provider === "r2_public") {
          try {
            await assertR2PublicObject(storagePath, asset.sizeBytes);
            const config = getR2StorageConfig();
            await verifyPublicDelivery(config.publicBaseUrl, storagePath, asset.sizeBytes);
            continue;
          } catch (verificationError) {
            try {
              await revokeR2PublicAsset(asset);
            } catch (cleanupError) {
              console.error("Nie udało się bezpiecznie wycofać publicznej kopii R2; jej provider pozostaje oznaczony jako publiczny do ponowienia.", {
                assetId: asset.id,
                verificationError: verificationError instanceof Error ? verificationError.message : "unknown",
                cleanupError: cleanupError instanceof Error ? cleanupError.message : "unknown",
              });
            }
            continue;
          }
        }

        await setProductAssetStorageProvider(asset.id, storagePath, "r2_public_pending");
        try {
          await promoteR2PrivateObject(storagePath, asset.contentType);
          // The public marker is applied only after the copied bytes are verified.
          // The RPC also rechecks path, active/public state, and publication status.
          await setProductAssetStorageProvider(asset.id, storagePath, "r2_public");
        } catch (error) {
          await cleanupFailedR2Publication(asset);
          throw error;
        }
      } catch (error) {
        console.error("Nie udało się opublikować kopii assetu w R2.", {
          assetId: asset.id,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    return;
  }

  const nextById = new Map(assets.map((asset) => [asset.id, asset]));
  const assetsToRevoke = new Map<string, ProductAsset>();
  for (const previous of previousAssets) {
    if (
      (previous.storageProvider ?? "supabase") !== "r2_public" &&
      (previous.storageProvider ?? "supabase") !== "r2_public_pending" &&
      (previous.storageProvider ?? "supabase") !== "r2_public_revoking"
    ) continue;
    const next = nextById.get(previous.id);
    if (
      !next ||
      ((next.storageProvider ?? "supabase") !== "r2_public" &&
        (next.storageProvider ?? "supabase") !== "r2_public_pending" &&
        (next.storageProvider ?? "supabase") !== "r2_public_revoking") ||
      next.isActive === false ||
      !next.isPublic ||
      (next.storagePath ?? next.path) !== (previous.storagePath ?? previous.path)
    ) {
      assetsToRevoke.set(previous.id, previous);
    }
  }

  for (const asset of assets) {
    if (
      (asset.storageProvider ?? "supabase") === "r2_public" ||
      (asset.storageProvider ?? "supabase") === "r2_public_pending" ||
      (asset.storageProvider ?? "supabase") === "r2_public_revoking"
    ) {
      assetsToRevoke.set(asset.id, asset);
    }
  }

  for (const asset of assetsToRevoke.values()) {
    try {
      await revokeR2PublicAsset(asset, { restoreIfEligible: true });
    } catch (error) {
      console.error("Nie udało się bezpiecznie wycofać publicznej kopii assetu R2; provider pozostaje oznaczony jako publiczny do ponowienia.", {
        assetId: asset.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}

async function revokeR2PublicAsset(
  asset: ProductAsset,
  options: { restoreIfEligible?: boolean } = {},
) {
  const storagePath = asset.storagePath ?? asset.path;
  const acquired = await beginR2PublicRevocation(asset.id, storagePath);
  if (!acquired) return false;

  // A same-key image may already be public or in the middle of publication.
  // The database fence blocks new promotions while this marker is held, so
  // check existing references before changing the shared R2 object.
  let currentRows = await readRowsForStoragePath(storagePath);
  if (hasOtherEligiblePublicReference(currentRows, asset.id)) {
    await setProductAssetStorageProvider(asset.id, storagePath, "r2_private");
    if (options.restoreIfEligible) await restoreR2PublicAssetIfEligible(asset);
    return true;
  }

  await demoteR2PublicObject(storagePath);
  currentRows = await readRowsForStoragePath(storagePath);
  if (hasOtherEligiblePublicReference(currentRows, asset.id)) {
    // A same-key published image still needs this public object. Release only
    // the fence acquired above and leave the shared object in place.
    await setProductAssetStorageProvider(asset.id, storagePath, "r2_private");
    if (options.restoreIfEligible) await restoreR2PublicAssetIfEligible(asset);
    return true;
  }
  await deleteR2PublicMedia(storagePath);
  await setProductAssetStorageProvider(asset.id, storagePath, "r2_private");
  if (options.restoreIfEligible) await restoreR2PublicAssetIfEligible(asset);
  return true;
}

async function cleanupFailedR2Publication(asset: ProductAsset) {
  const storagePath = asset.storagePath ?? asset.path;
  let currentRows: Awaited<ReturnType<typeof readRowsForStoragePath>>;
  try {
    currentRows = await readRowsForStoragePath(storagePath);
  } catch (readError) {
    await reportFailedR2PublicationCleanup(asset.id, storagePath, readError);
    return;
  }

  let current = currentRows.find((row) => row.id === asset.id) ?? null;
  if (reportSharedPublicReference(currentRows, asset.id, current)) {
    return;
  }

  // A revoker owns this marker. Its delete may have run before an in-flight
  // copy finished, so remove the late object but leave the provider transition
  // to that owner.
  if (!current || current.storage_provider === "r2_public_revoking") {
    try {
      await deleteR2PublicMedia(storagePath);
    } catch (cleanupError) {
      await reportFailedR2PublicationCleanup(asset.id, storagePath, cleanupError);
    }
    return;
  }

  let ownsRevocationFence = false;
  try {
    ownsRevocationFence = await beginR2PublicRevocation(asset.id, storagePath);
  } catch (fenceError) {
    await cleanupUnownedFailedR2Publication(asset.id, storagePath, fenceError);
    return;
  }

  if (!ownsRevocationFence) {
    await cleanupUnownedFailedR2Publication(asset.id, storagePath, new Error("The revocation fence was not acquired."));
    return;
  }

  // Recheck after acquiring our fence. If a same-key eligible asset appeared,
  // retain its shared public object and release only the fence we acquired.
  try {
    currentRows = await readRowsForStoragePath(storagePath);
  } catch (readError) {
    await reportFailedR2PublicationCleanup(asset.id, storagePath, readError);
    return;
  }
  current = currentRows.find((row) => row.id === asset.id) ?? null;
  if (reportSharedPublicReference(currentRows, asset.id, current)) {
    try {
      await setProductAssetStorageProvider(asset.id, storagePath, "r2_private");
    } catch (providerError) {
      await reportFailedR2PublicationCleanup(asset.id, storagePath, providerError);
      return;
    }
    console.error("Nie usunięto publicznej kopii R2, ponieważ ten sam klucz wskazuje na inny kwalifikujący się obraz.", {
      assetId: asset.id,
      providerObserved: "r2_private",
    });
    return;
  }

  try {
    await deleteR2PublicMedia(storagePath);
  } catch (cleanupError) {
    await reportFailedR2PublicationCleanup(asset.id, storagePath, cleanupError);
    return;
  }

  try {
    await setProductAssetStorageProvider(asset.id, storagePath, "r2_private");
  } catch (providerError) {
    await reportFailedR2PublicationCleanup(asset.id, storagePath, providerError);
  }
}

async function cleanupUnownedFailedR2Publication(assetId: string, storagePath: string, reason: unknown) {
  let currentRows: Awaited<ReturnType<typeof readRowsForStoragePath>>;
  try {
    currentRows = await readRowsForStoragePath(storagePath);
  } catch (readError) {
    await reportFailedR2PublicationCleanup(assetId, storagePath, readError);
    return;
  }

  const current = currentRows.find((row) => row.id === assetId) ?? null;
  if (reportSharedPublicReference(currentRows, assetId, current)) return;

  // Another revoker owns the fence, or the row disappeared. Both states allow
  // object cleanup without changing provider state owned by another writer.
  if (!current || current.storage_provider === "r2_public_revoking") {
    try {
      await deleteR2PublicMedia(storagePath);
    } catch (cleanupError) {
      await reportFailedR2PublicationCleanup(assetId, storagePath, cleanupError);
    }
    return;
  }

  await reportFailedR2PublicationCleanup(assetId, storagePath, reason);
}

async function readRowsForStoragePath(storagePath: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_assets")
    .select("id, product_id, kind, path, storage_provider, is_active, is_public, products!product_assets_product_id_fkey!inner(status)")
    .eq("path", storagePath);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function hasOtherEligiblePublicReference(rows: Array<Record<string, unknown>>, assetId: string) {
  return rows.some((row) => {
    if (row.id === assetId || (row.kind !== "cover" && row.kind !== "gallery")) return false;
    if (row.storage_provider !== "r2_public" && row.storage_provider !== "r2_public_pending") return false;
    if (row.is_active !== true || row.is_public !== true || typeof row.product_id !== "string") return false;
    const products = row.products;
    const product = Array.isArray(products) ? products[0] : products;
    if (!product || typeof product !== "object" || (product as { status?: unknown }).status !== "published") return false;
    const path = typeof row.path === "string" ? row.path : "";
    const prefix = `products/${row.product_id}/${row.kind}/`;
    return path.startsWith(prefix) && path.length > prefix.length;
  });
}

function reportSharedPublicReference(
  rows: Array<Record<string, unknown>>,
  assetId: string,
  current: Record<string, unknown> | null,
) {
  if (!hasOtherEligiblePublicReference(rows, assetId)) return false;
  console.error("Nie usunięto publicznej kopii R2, ponieważ ten sam klucz wskazuje na inny kwalifikujący się obraz.", {
    assetId,
    providerObserved: current?.storage_provider ?? (current ? "unknown" : "row_missing"),
  });
  return true;
}

async function reportFailedR2PublicationCleanup(assetId: string, storagePath: string, error: unknown) {
  let providerObserved = "unknown";
  try {
    const rows = await readRowsForStoragePath(storagePath);
    const current = rows.find((row) => row.id === assetId);
    providerObserved = current?.storage_provider ?? (current ? "unknown" : "row_missing");
  } catch {
    // Preserve the cleanup error and make the inability to confirm state clear.
  }
  console.error("Nie udało się potwierdzić usunięcia publicznej kopii R2; publiczny URL może nadal być dostępny. Stan providera wymaga ponowienia.", {
    assetId,
    providerObserved,
    error: error instanceof Error ? error.message : "unknown",
  });
}

async function beginR2PublicRevocation(assetId: string, storagePath: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("begin_product_asset_public_revocation", {
    requested_asset_id: assetId,
    requested_path: storagePath,
  });
  if (!error && data === true) return true;

  const { data: current, error: readError } = await supabase
    .from("product_assets")
    .select("storage_provider")
    .eq("id", assetId)
    .eq("path", storagePath)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (current?.storage_provider === "r2_public_revoking") {
    throw new Error("The asset has an unfinished R2 public revocation. Reconcile public media before retrying this mutation.");
  }
  if (error) throw new Error(error.message);
  return false;
}

async function restoreR2PublicAssetIfEligible(asset: ProductAsset) {
  const storagePath = asset.storagePath ?? asset.path;
  const supabase = await createClient();
  const { data: current, error } = await supabase
    .from("product_assets")
    .select("id, path, storage_provider, is_active, is_public, content_type, products!product_assets_product_id_fkey!inner(status)")
    .eq("id", asset.id)
    .eq("path", storagePath)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!current) return;
  const product = Array.isArray(current.products) ? current.products[0] : current.products;
  if (
    current.storage_provider !== "r2_private" ||
    current.is_active !== true ||
    current.is_public !== true ||
    product?.status !== "published"
  ) return;

  await reconcileR2Publication({
    assets: [{
      ...asset,
      storageProvider: "r2_private",
      isActive: true,
      isPublic: true,
      contentType: typeof current.content_type === "string" ? current.content_type : asset.contentType,
    }],
    previousAssets: [],
    status: "published",
  });
}

async function setProductAssetStorageProvider(
  assetId: string,
  storagePath: string,
  provider: "r2_private" | "r2_public_pending" | "r2_public",
) {
  const supabase = provider === "r2_public" || provider === "r2_private"
    ? createServiceRoleClient()
    : await createClient();
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
  if (!readError && current?.storage_provider === provider) return;

  throw new Error(error?.message ?? "Supabase did not confirm the media provider change.");
}

function storageProviderValue(value: unknown): MediaStorageProvider {
  return value === "r2_private" || value === "r2_public_pending" || value === "r2_public_revoking" || value === "r2_public"
    ? value
    : "supabase";
}

function storeLocalFile(input: {
  productId: string;
  kind: AssetKind;
  bucket: string;
  filename: string;
  storageFilename: string;
  bytes: Uint8Array;
}) {
  const root = path.resolve(process.cwd(), "public", "uploads");
  const directory = path.resolve(root, input.productId, input.kind);
  assertWithin(root, directory);
  fs.mkdirSync(directory, { recursive: true });

  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = filenameWithCollisionSuffix(input.storageFilename, suffix);
    const target = path.resolve(directory, candidate);
    assertWithin(root, target);

    try {
      fs.writeFileSync(target, input.bytes, { flag: "wx" });
      const publicPath = `/uploads/${input.productId}/${input.kind}/${encodeURIComponent(candidate)}`;

      return {
        bucket: input.bucket,
        storagePath: publicPath,
        publicPath,
        filename: input.filename,
      };
    } catch (error) {
      if (isFileExistsError(error)) continue;
      throw error;
    }
  }

  throw new Error("Nie udało się znaleźć wolnej nazwy pliku.");
}

function removeLocalFile(input: { productId: string; kind: AssetKind; storagePath: string }) {
  const root = path.resolve(process.cwd(), "public", "uploads");
  const relative = input.storagePath.replace(/^\/uploads\//, "");
  const segments = relative.split("/").map((segment) => decodeURIComponent(segment));

  if (segments[0] !== input.productId || segments[1] !== input.kind || segments.length !== 3) {
    throw new Error("Nieprawidłowa ścieżka usuwanego uploadu.");
  }

  const target = path.resolve(root, ...segments);
  assertWithin(root, target);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

type StorageReference = { backend: "local" | "supabase" | "r2"; bucket: string; path: string };

function storageReference(asset: ProductAsset): StorageReference | null {
  const storagePath =
    asset.storagePath ??
    (asset.path.startsWith("/uploads/") || asset.path.startsWith("products/")
      ? asset.path
      : null);

  if (!storagePath) {
    return null;
  }

  const backend = storagePath.startsWith("/uploads/")
    ? "local"
    : asset.storageProvider === "r2_private" ||
        asset.storageProvider === "r2_public_pending" ||
        asset.storageProvider === "r2_public_revoking" ||
        asset.storageProvider === "r2_public"
      ? "r2"
      : "supabase";
  return { backend, bucket: mediaBucketForKind(asset.kind), path: storagePath };
}

function referenceKey(reference: StorageReference) {
  return `${reference.backend}\u0000${reference.bucket}\u0000${reference.path}`;
}

function publicStoragePath(supabaseUrl: string, bucket: string, storagePath: string) {
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${storagePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function resumableUploadEndpoint(supabaseUrl: string) {
  const url = new URL(supabaseUrl);
  const hostname = url.hostname.endsWith(".supabase.co")
    ? url.hostname.slice(0, -".supabase.co".length) + ".storage.supabase.co"
    : url.hostname;

  return `${url.protocol}//${hostname}/storage/v1/upload/resumable`;
}

function isDuplicateStorageError(error: { message?: string; status?: number; statusCode?: string | number }) {
  const message = String(error.message ?? "").toLowerCase();
  return error.status === 409 || error.statusCode === 409 || message.includes("exist") || message.includes("duplicate");
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST");
}

function assertWithin(root: string, target: string) {
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Nieprawidłowa ścieżka pliku.");
  }
}

function stringField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function stringAt(values: FormDataEntryValue[], index: number) {
  const value = values[index];
  return typeof value === "string" ? value.trim() : "";
}

function providerAt(values: FormDataEntryValue[], index: number): MediaStorageProvider {
  const value = stringAt(values, index);
  return value === "r2_private" || value === "r2_public" ? value : "supabase";
}

function isAssetKind(value: string): value is AssetKind {
  return value === "cover" || value === "gallery" || value === "video" || value === "public_download" || value === "premium_download";
}
