import "server-only";

import fs from "node:fs";
import path from "node:path";

import { getRequiredSupabaseEnv, getBackendMode } from "./config";
import { createServiceRoleClient } from "./supabase/admin";
import type { AssetKind, ProductAsset } from "./types";
import { filenameWithCollisionSuffix, mediaBucketForKind } from "./media-upload";

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
}): Promise<SignedMediaUpload> {
  if (getBackendMode() !== "supabase") {
    throw new Error("Signed Supabase uploads are unavailable in local mode.");
  }

  const filename = safeFilename(input.filename);
  const bucket = mediaBucketForKind(input.kind);
  const env = getRequiredSupabaseEnv();
  const storagePath = `products/${input.productId}/${input.kind}/${input.assetId}-${filename}`;
  const { data, error } = await createServiceRoleClient()
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
}): Promise<StoredMediaFile> {
  const filename = safeFilename(input.filename);
  const bucket = mediaBucketForKind(input.kind);

  if (getBackendMode() === "local") {
    return storeLocalFile({ ...input, bucket, filename });
  }

  const supabase = createServiceRoleClient();
  const basePath = `products/${input.productId}/${input.kind}`;

  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = filenameWithCollisionSuffix(filename, suffix);
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
        filename: candidate,
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
}) {
  const bucket = mediaBucketForKind(input.kind);

  if (getBackendMode() === "local") {
    removeLocalFile(input);
    return;
  }

  const expectedPrefix = `products/${input.productId}/${input.kind}/`;

  if (!input.storagePath.startsWith(expectedPrefix)) {
    throw new Error("Nieprawidłowa ścieżka usuwanego uploadu.");
  }

  const { error } = await createServiceRoleClient().storage.from(bucket).remove([input.storagePath]);

  if (error) {
    throw new Error(`Nie udało się usunąć pliku ze Storage: ${error.message}`);
  }
}

export async function cleanupNewMediaFromFormData(formData: FormData) {
  const productId = stringField(formData, "id");
  const ids = formData.getAll("assetId");
  const kinds = formData.getAll("assetKind");
  const paths = formData.getAll("assetPath");
  const uploaded = formData.getAll("assetUploaded");

  if (!productId) return;

  const tasks: Promise<void>[] = [];

  for (let index = 0; index < Math.max(ids.length, kinds.length, paths.length); index += 1) {
    if (stringAt(uploaded, index) !== "1") continue;

    const kind = stringAt(kinds, index);
    const storagePath = stringAt(paths, index);

    if (isAssetKind(kind) && storagePath) {
      tasks.push(removeUploadedMedia({ productId, kind, storagePath }).catch(() => undefined));
    }
  }

  await Promise.all(tasks);
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

function storeLocalFile(input: {
  productId: string;
  kind: AssetKind;
  bucket: string;
  filename: string;
  bytes: Uint8Array;
}) {
  const root = path.resolve(process.cwd(), "public", "uploads");
  const directory = path.resolve(root, input.productId, input.kind);
  assertWithin(root, directory);
  fs.mkdirSync(directory, { recursive: true });

  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = filenameWithCollisionSuffix(input.filename, suffix);
    const target = path.resolve(directory, candidate);
    assertWithin(root, target);

    try {
      fs.writeFileSync(target, input.bytes, { flag: "wx" });
      const publicPath = `/uploads/${input.productId}/${input.kind}/${encodeURIComponent(candidate)}`;

      return {
        bucket: input.bucket,
        storagePath: publicPath,
        publicPath,
        filename: candidate,
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

type StorageReference = { bucket: string; path: string };

function storageReference(asset: ProductAsset): StorageReference | null {
  const storagePath = asset.storagePath ?? (asset.path.startsWith("/uploads/") ? asset.path : null);

  if (!storagePath) {
    return null;
  }

  return { bucket: mediaBucketForKind(asset.kind), path: storagePath };
}

function referenceKey(reference: StorageReference) {
  return `${reference.bucket}\u0000${reference.path}`;
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

function safeFilename(value: string) {
  const basename = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const cleaned = basename.replace(/[^\p{L}\p{N}._'!&$@=;:+?()\- ]/gu, "-");
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "file";
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

function isAssetKind(value: string): value is AssetKind {
  return value === "cover" || value === "gallery" || value === "video" || value === "public_download" || value === "premium_download";
}
