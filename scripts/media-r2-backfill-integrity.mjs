import { createHash } from "node:crypto";

export async function ensurePrivateR2Object({
  bucket,
  key,
  bytes,
  contentType,
  sha256,
  cacheControl,
  findExisting,
  putObject,
  readObject,
}) {
  const expectedContentType = contentType || "application/octet-stream";
  const existing = await findExisting();
  if (existing) {
    assertHeadMatches(existing, key, bytes.byteLength, expectedContentType, "existing private");
    await assertObjectBytesMatch({
      readObject,
      key,
      expectedBytesOrLength: bytes.byteLength,
      expectedSha256: sha256,
      description: "private R2 object",
    });
    return { written: false };
  }

  await putObject({
    Bucket: bucket,
    Key: key,
    Body: bytes,
    ContentLength: bytes.byteLength,
    ContentType: expectedContentType,
    CacheControl: cacheControl,
    Metadata: { sha256 },
  });

  const verified = await findExisting();
  assertHeadMatches(verified, key, bytes.byteLength, expectedContentType, "new private");
  if (verified.Metadata?.sha256 !== sha256) {
    throw new Error(`New private R2 object ${key} failed SHA-256 metadata verification.`);
  }
  await assertObjectBytesMatch({
    readObject,
    key,
    expectedBytesOrLength: bytes.byteLength,
    expectedSha256: sha256,
    description: "private R2 object",
  });
  return { written: true };
}

export async function assertObjectBytesMatch({
  readObject,
  key,
  expectedBytesOrLength,
  expectedSha256,
  description = "R2 object",
}) {
  const object = await readObject();
  if (!object?.Body || typeof object.Body.transformToByteArray !== "function") {
    throw new Error(`${description} ${key} could not be read for byte verification.`);
  }
  const bytes = Buffer.from(await object.Body.transformToByteArray());
  const byteLength = typeof expectedBytesOrLength === "number"
    ? expectedBytesOrLength
    : expectedBytesOrLength.byteLength;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (
    bytes.byteLength !== byteLength ||
    sha256 !== expectedSha256 ||
    (object.Metadata?.sha256 && object.Metadata.sha256 !== expectedSha256)
  ) {
    throw new Error(`${description} ${key} does not match its verified source bytes.`);
  }
}

export async function verifyPublicMediaDeliveryBytes({
  url,
  key,
  expectedByteLength,
  expectedSha256,
  expectedContentType,
  fetchImpl = fetch,
  timeoutMs = 30_000,
}) {
  const response = await fetchImpl(url, {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Public media CDN returned HTTP ${response.status} for ${key}.`);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0].trim();
  const declaredLength = response.headers.get("content-length");
  if (
    contentType !== expectedContentType ||
    (declaredLength && Number(declaredLength) !== expectedByteLength)
  ) {
    throw new Error(`Public media CDN metadata does not match the verified source for ${key}.`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== expectedByteLength || sha256 !== expectedSha256) {
    throw new Error(`Public media CDN bytes do not match the verified source for ${key}.`);
  }
}

function assertHeadMatches(head, key, expectedLength, expectedContentType, description) {
  if (
    !head ||
    head.ContentLength !== expectedLength ||
    head.ContentType !== expectedContentType
  ) {
    throw new Error(`R2 ${description} object ${key} does not match the expected size and content type.`);
  }
}
