import "server-only";

import { createHash } from "node:crypto";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { AssetKind } from "./types";
import { getR2StorageConfig, isSafeMediaStoragePath, r2PublicMediaUrl } from "./media-r2-config";

const signedUrlTtlSeconds = 15 * 60;

export type SignedR2Upload = {
  url: string;
  headers: Record<string, string>;
  storagePath: string;
  stagingPath: string;
};

export async function createSignedR2Upload(input: {
  assetId: string;
  productId: string;
  kind: AssetKind;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
}): Promise<SignedR2Upload> {
  assertR2ImageKind(input.kind);
  const config = getR2StorageConfig();
  const storagePath = input.storagePath;
  const expectedPrefix = `products/${input.productId}/${input.kind}/${input.assetId}-`;
  if (!isUuid(input.productId) || !isUuid(input.assetId) || !storagePath.startsWith(expectedPrefix)) {
    throw new Error("Invalid R2 media path.");
  }
  assertSafeProductStoragePath(storagePath);
  const stagingPath = `staging/${storagePath}`;
  const command = new PutObjectCommand({
    Bucket: config.privateBucket,
    Key: stagingPath,
    ContentType: input.contentType,
    ContentLength: input.sizeBytes,
    CacheControl: "private, no-store",
  });
  const url = await getSignedUrl(getClient(), command, { expiresIn: signedUrlTtlSeconds });

  return {
    url,
    headers: { "Content-Type": input.contentType },
    storagePath,
    stagingPath,
  };
}

export async function assertR2StagingUpload(input: {
  stagingPath: string;
  contentType: string;
  sizeBytes: number;
}) {
  if (!input.stagingPath.startsWith("staging/products/") || !isSafeMediaStoragePath(input.stagingPath.slice("staging/".length))) {
    throw new Error("Invalid R2 staging media path.");
  }

  const config = getR2StorageConfig();
  const result = await getClient().send(new HeadObjectCommand({
    Bucket: config.privateBucket,
    Key: input.stagingPath,
  }));

  if (result.ContentLength !== input.sizeBytes || result.ContentType !== input.contentType) {
    throw new Error("R2 upload metadata does not match the submitted media file.");
  }
  return result;
}

export async function finalizeR2StagingUpload(input: {
  stagingPath: string;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
}) {
  if (
    input.stagingPath !== `staging/${input.storagePath}` ||
    !input.stagingPath.startsWith("staging/products/") ||
    !isSafeMediaStoragePath(input.storagePath)
  ) {
    throw new Error("Invalid R2 media path.");
  }

  const config = getR2StorageConfig();
  const client = getClient();
  let source;
  try {
    source = await client.send(new HeadObjectCommand({
      Bucket: config.privateBucket,
      Key: input.stagingPath,
    }));
  } catch (error) {
    if (!isMissingR2ObjectError(error)) throw error;
    const finalized = await assertR2PrivateObject(input.storagePath, input.sizeBytes);
    if (finalized.ContentType !== input.contentType) {
      throw new Error("Finalized R2 media Content-Type does not match the saved media record.");
    }
    return;
  }

  if (source.ContentLength !== input.sizeBytes || source.ContentType !== input.contentType) {
    throw new Error("R2 staging upload metadata does not match the submitted media file.");
  }
  await client.send(new CopyObjectCommand({
    Bucket: config.privateBucket,
    Key: input.storagePath,
    CopySource: copySource(config.privateBucket, input.stagingPath),
    MetadataDirective: "REPLACE",
    ContentType: input.contentType,
    CacheControl: "private, no-store",
  }));
  const destination = await assertR2PrivateObject(input.storagePath, input.sizeBytes);
  if (destination.ContentType !== input.contentType) {
    throw new Error("Finalized R2 media Content-Type does not match the saved media record.");
  }
  assertSameObjectBytes(source, destination);
  await client.send(new DeleteObjectCommand({ Bucket: config.privateBucket, Key: input.stagingPath }));
}

export async function assertR2PrivateObject(storagePath: string, sizeBytes?: number) {
  assertSafeProductStoragePath(storagePath);
  const { privateBucket } = getR2StorageConfig();
  const result = await getClient().send(new HeadObjectCommand({ Bucket: privateBucket, Key: storagePath }));

  if (sizeBytes !== undefined && result.ContentLength !== sizeBytes) {
    throw new Error("R2 private object size does not match the saved media record.");
  }
  return result;
}

export async function assertR2PublicObject(storagePath: string, sizeBytes?: number) {
  assertSafeProductStoragePath(storagePath);
  const { publicBucket } = getR2StorageConfig();
  const result = await getClient().send(new HeadObjectCommand({ Bucket: publicBucket, Key: storagePath }));

  if (sizeBytes !== undefined && result.ContentLength !== sizeBytes) {
    throw new Error("R2 public object size does not match the saved media record.");
  }
  return result;
}

export async function promoteR2PrivateObject(storagePath: string, contentType: string) {
  assertSafeProductStoragePath(storagePath);
  const config = getR2StorageConfig();
  const client = getClient();
  const source = await assertR2PrivateObject(storagePath);

  await client.send(new CopyObjectCommand({
    Bucket: config.publicBucket,
    Key: storagePath,
    CopySource: copySource(config.privateBucket, storagePath),
    MetadataDirective: "REPLACE",
    ContentType: contentType,
    CacheControl: "public, max-age=60, s-maxage=60, must-revalidate",
  }));
  const destination = await assertR2PublicObject(storagePath, source.ContentLength);
  assertSameObjectBytes(source, destination);
  const privateObject = await client.send(new GetObjectCommand({
    Bucket: config.privateBucket,
    Key: storagePath,
  }));
  if (!privateObject.Body || typeof privateObject.Body.transformToByteArray !== "function") {
    throw new Error("R2 private object could not be read for public-delivery verification.");
  }
  const privateBytes = Buffer.from(await privateObject.Body.transformToByteArray());
  if (
    privateBytes.byteLength !== source.ContentLength ||
    privateObject.ContentType !== contentType
  ) {
    throw new Error("R2 private object does not match the saved media record.");
  }
  const expectedSha256 = createHash("sha256").update(privateBytes).digest("hex");
  await verifyPublicDelivery(config.publicBaseUrl, storagePath, source.ContentLength, {
    contentType,
    sha256: expectedSha256,
  });
}

export async function demoteR2PublicObject(storagePath: string) {
  assertSafeProductStoragePath(storagePath);
  const config = getR2StorageConfig();
  const client = getClient();

  try {
    await assertR2PrivateObject(storagePath);
  } catch (error) {
    if (!isMissingR2ObjectError(error)) throw error;
    const source = await assertR2PublicObject(storagePath);
    await client.send(new CopyObjectCommand({
      Bucket: config.privateBucket,
      Key: storagePath,
      CopySource: copySource(config.publicBucket, storagePath),
      MetadataDirective: "REPLACE",
      ContentType: source.ContentType,
      CacheControl: "private, no-store",
    }));
    const destination = await assertR2PrivateObject(storagePath, source.ContentLength);
    assertSameObjectBytes(source, destination);
  }
}

export async function createSignedR2ReadUrl(storagePath: string) {
  assertSafeProductStoragePath(storagePath);
  const { privateBucket } = getR2StorageConfig();
  const command = new HeadObjectCommand({ Bucket: privateBucket, Key: storagePath });
  await getClient().send(command);
  return getSignedUrl(getClient(), new GetObjectCommand({
    Bucket: privateBucket,
    Key: storagePath,
  }), { expiresIn: 60 });
}

export async function deleteR2Media(storagePath: string, includePublic = false) {
  assertSafeProductStoragePath(storagePath);
  const config = getR2StorageConfig();
  const client = getClient();
  const keys = [
    { Bucket: config.privateBucket, Key: storagePath },
    { Bucket: config.privateBucket, Key: `staging/${storagePath}` },
    ...(includePublic ? [{ Bucket: config.publicBucket, Key: storagePath }] : []),
  ];
  await Promise.all(keys.map((key) => client.send(new DeleteObjectCommand(key))));
}

export async function deleteR2PublicMedia(storagePath: string) {
  assertSafeProductStoragePath(storagePath);
  const { publicBucket } = getR2StorageConfig();
  await getClient().send(new DeleteObjectCommand({ Bucket: publicBucket, Key: storagePath }));
}

export async function verifyPublicDelivery(
  publicBaseUrl: string,
  storagePath: string,
  sizeBytes?: number,
  expected?: { contentType: string; sha256: string },
) {
  const url = r2PublicMediaUrl(publicBaseUrl, storagePath);
  if (!url) throw new Error("Invalid R2 public media URL.");

  const response = await fetch(url, {
    method: expected ? "GET" : "HEAD",
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(expected ? 30_000 : 8_000),
  });
  if (!response.ok) throw new Error(`R2 public media domain returned HTTP ${response.status}.`);
  const deliveredContentType = response.headers.get("content-type")?.split(";")[0].trim();
  const declaredSize = response.headers.get("content-length");
  if (sizeBytes !== undefined && declaredSize && Number(declaredSize) !== sizeBytes) {
    throw new Error("R2 public media domain returned an unexpected object size.");
  }
  if (expected && deliveredContentType !== expected.contentType) {
    throw new Error("R2 public media domain returned unexpected object metadata.");
  }

  if (expected) {
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (
      bytes.byteLength !== sizeBytes ||
      sha256 !== expected.sha256
    ) {
      throw new Error("R2 public media domain returned bytes that do not match the private object.");
    }
  } else {
    const deliveredSize = Number(declaredSize);
    if (sizeBytes !== undefined && deliveredSize !== sizeBytes) {
      throw new Error("R2 public media domain returned an unexpected object size.");
    }
  }
}

export function r2StagingPath(storagePath: string) {
  assertSafeProductStoragePath(storagePath);
  return `staging/${storagePath}`;
}

function getClient() {
  const config = getR2StorageConfig();
  return new S3Client({
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function assertSafeProductStoragePath(storagePath: string) {
  if (!isSafeMediaStoragePath(storagePath)) throw new Error("Invalid R2 media path.");
}

function assertR2ImageKind(kind: AssetKind) {
  if (kind !== "cover" && kind !== "gallery") {
    throw new Error("R2 media storage is currently limited to public product images.");
  }
}

function copySource(bucket: string, key: string) {
  return `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function assertSameObjectBytes(source: { ETag?: string }, destination: { ETag?: string }) {
  if (source.ETag && destination.ETag && source.ETag !== destination.ETag) {
    throw new Error("R2 object copy verification failed.");
  }
}

function isMissingR2ObjectError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === "NotFound" ||
    candidate.name === "NoSuchKey"
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
