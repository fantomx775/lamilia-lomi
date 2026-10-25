import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getBackendMode } from "./config";
import { createCollectionImagePath, isSafeCollectionImagePath } from "./collection-image-path";
import { getMediaUploadProvider, getR2StorageConfig } from "./media-r2-config";
import { mediaFilenameForDisplay, MAX_READER_ARTWORK_BYTES } from "./media-upload";
import { createServiceRoleClient } from "./supabase/admin";

const COLLECTION_IMAGE_BUCKET = "collection-media";
const MAX_COLLECTION_IMAGE_BYTES = 20 * 1024 * 1024;

type CollectionImageProvider = "local" | "supabase" | "r2";

export async function storeCollectionImage(input: {
  collectionId: string;
  imageId: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  authorizationToken?: string | null;
  namespace?: "collections" | "reader-artworks";
}): Promise<{ path: string; provider: CollectionImageProvider; filename: string }> {
  const filename = mediaFilenameForDisplay(input.filename);
  const storagePath = createCollectionImagePath(input.collectionId, input.imageId, filename, input.contentType, input.namespace);
  const maxBytes = input.namespace === "reader-artworks" ? MAX_READER_ARTWORK_BYTES : MAX_COLLECTION_IMAGE_BYTES;
  if (input.bytes.byteLength <= 0 || input.bytes.byteLength > maxBytes) {
    throw new Error("Invalid collection image size.");
  }

  if (getBackendMode() === "local") {
    const absolutePath = localImagePath(storagePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, input.bytes, { flag: "wx" });
    return { path: storagePath, provider: "local", filename };
  }

  if (getMediaUploadProvider() === "r2") {
    const config = getR2StorageConfig();
    await getR2Client().send(new PutObjectCommand({
      Bucket: config.privateBucket,
      Key: storagePath,
      Body: input.bytes,
      ContentLength: input.bytes.byteLength,
      ContentType: input.contentType,
      CacheControl: "private, no-store",
    }));
    return { path: storagePath, provider: "r2", filename };
  }

  const { error } = await createServiceRoleClient({
    storageAuthorizationToken: input.authorizationToken ?? undefined,
  }).storage.from(COLLECTION_IMAGE_BUCKET).upload(storagePath, input.bytes, {
    cacheControl: "private, no-store",
    contentType: input.contentType,
    upsert: false,
  });
  if (error) throw new Error(`Collection image upload failed: ${error.message}`);
  return { path: storagePath, provider: "supabase", filename };
}

export async function assertCollectionImageExists(input: {
  collectionId: string;
  storagePath: string;
  provider: CollectionImageProvider;
  contentType: string;
  sizeBytes: number;
  authorizationToken?: string | null;
}) {
  assertPath(input.storagePath, input.collectionId);
  const maxBytes = input.storagePath.startsWith("reader-artworks/") ? MAX_READER_ARTWORK_BYTES : MAX_COLLECTION_IMAGE_BYTES;
  if (input.sizeBytes <= 0 || input.sizeBytes > maxBytes) {
    throw new Error("Invalid collection image size.");
  }

  if (input.provider === "local") {
    const stats = await fs.stat(localImagePath(input.storagePath));
    if (stats.size !== input.sizeBytes) throw new Error("Collection image size does not match the upload.");
    return;
  }

  if (input.provider === "r2") {
    const { privateBucket } = getR2StorageConfig();
    const result = await getR2Client().send(new HeadObjectCommand({ Bucket: privateBucket, Key: input.storagePath }));
    if (result.ContentLength !== input.sizeBytes || result.ContentType !== input.contentType) {
      throw new Error("R2 collection image metadata does not match the upload.");
    }
    return;
  }

  const { data, error } = await createServiceRoleClient({
    storageAuthorizationToken: input.authorizationToken ?? undefined,
  }).storage.from(COLLECTION_IMAGE_BUCKET).createSignedUrl(input.storagePath, 60);
  if (error || !data?.signedUrl) throw new Error("The uploaded collection image could not be verified.");
}

export async function createSignedCollectionImageUrl(input: {
  collectionId: string;
  storagePath: string;
  provider: CollectionImageProvider;
  authorizationToken?: string | null;
}) {
  assertPath(input.storagePath, input.collectionId);

  if (input.provider === "local") return null;
  if (input.provider === "r2") {
    const config = getR2StorageConfig();
    return getSignedUrl(getR2Client(), new GetObjectCommand({
      Bucket: config.privateBucket,
      Key: input.storagePath,
    }), { expiresIn: 60 });
  }

  const { data, error } = await createServiceRoleClient({
    storageAuthorizationToken: input.authorizationToken ?? undefined,
  }).storage.from(COLLECTION_IMAGE_BUCKET).createSignedUrl(input.storagePath, 60);
  if (error || !data?.signedUrl) throw new Error("Collection image is unavailable.");
  return data.signedUrl;
}

export async function readLocalCollectionImage(storagePath: string, collectionId: string) {
  assertPath(storagePath, collectionId);
  return fs.readFile(localImagePath(storagePath));
}

export async function readCollectionImage(input: {
  collectionId: string;
  storagePath: string;
  provider: CollectionImageProvider;
  authorizationToken?: string | null;
}): Promise<Uint8Array> {
  assertPath(input.storagePath, input.collectionId);
  if (input.provider === "local") return readLocalCollectionImage(input.storagePath, input.collectionId);
  if (input.provider === "r2") {
    const { privateBucket } = getR2StorageConfig();
    const result = await getR2Client().send(new GetObjectCommand({ Bucket: privateBucket, Key: input.storagePath }));
    if (!result.Body) throw new Error("Collection image is unavailable.");
    return result.Body.transformToByteArray();
  }
  const { data, error } = await createServiceRoleClient({
    storageAuthorizationToken: input.authorizationToken ?? undefined,
  }).storage.from(COLLECTION_IMAGE_BUCKET).download(input.storagePath);
  if (error || !data) throw new Error("Collection image is unavailable.");
  return new Uint8Array(await data.arrayBuffer());
}

export async function removeCollectionImage(input: {
  collectionId: string;
  storagePath: string;
  provider: CollectionImageProvider;
  authorizationToken?: string | null;
}) {
  assertPath(input.storagePath, input.collectionId);

  if (input.provider === "local") {
    await fs.rm(localImagePath(input.storagePath), { force: true });
    return;
  }
  if (input.provider === "r2") {
    const { privateBucket } = getR2StorageConfig();
    await getR2Client().send(new DeleteObjectCommand({ Bucket: privateBucket, Key: input.storagePath }));
    return;
  }

  const { error } = await createServiceRoleClient({
    storageAuthorizationToken: input.authorizationToken ?? undefined,
  }).storage.from(COLLECTION_IMAGE_BUCKET).remove([input.storagePath]);
  if (error) throw new Error(`Collection image cleanup failed: ${error.message}`);
}

function localImagePath(storagePath: string) {
  assertPath(storagePath);
  return path.resolve(process.cwd(), "data", ".collection-media", ...storagePath.split("/"));
}

function assertPath(storagePath: string, collectionId?: string) {
  if (!isSafeCollectionImagePath(storagePath, collectionId, "collections") &&
      !isSafeCollectionImagePath(storagePath, collectionId, "reader-artworks")) {
    throw new Error("Invalid collection image path.");
  }
}

function getR2Client() {
  const config = getR2StorageConfig();
  return new S3Client({
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}
