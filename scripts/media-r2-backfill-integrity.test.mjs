import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import {
  ensurePrivateR2Object,
  verifyPublicMediaDeliveryBytes,
} from "./media-r2-backfill-integrity.mjs";

const key = "products/product-1/gallery/image.jpg";
const sourceBytes = Buffer.from("verified image bytes");
const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");

function headFor(bytes = sourceBytes) {
  return {
    ContentLength: bytes.byteLength,
    ContentType: "image/jpeg",
    Metadata: { sha256: createHash("sha256").update(bytes).digest("hex") },
  };
}

function objectFor(bytes = sourceBytes) {
  return {
    Body: { transformToByteArray: async () => Uint8Array.from(bytes) },
    Metadata: { sha256: createHash("sha256").update(bytes).digest("hex") },
  };
}

describe("ensurePrivateR2Object", () => {
  it("verifies an existing matching object without rewriting it", async () => {
    const putObject = vi.fn();
    const result = await ensurePrivateR2Object({
      bucket: "private",
      key,
      bytes: sourceBytes,
      contentType: "image/jpeg",
      sha256: sourceSha256,
      findExisting: vi.fn().mockResolvedValue(headFor()),
      putObject,
      readObject: vi.fn().mockResolvedValue(objectFor()),
    });

    expect(result).toEqual({ written: false });
    expect(putObject).not.toHaveBeenCalled();
  });

  it("writes a missing object and verifies the read-back bytes and metadata", async () => {
    const putObject = vi.fn().mockResolvedValue(undefined);
    const findExisting = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(headFor());
    const result = await ensurePrivateR2Object({
      bucket: "private",
      key,
      bytes: sourceBytes,
      contentType: "image/jpeg",
      sha256: sourceSha256,
      cacheControl: "private, no-store",
      findExisting,
      putObject,
      readObject: vi.fn().mockResolvedValue(objectFor()),
    });

    expect(result).toEqual({ written: true });
    expect(putObject).toHaveBeenCalledWith(expect.objectContaining({
      Bucket: "private",
      Key: key,
      Body: sourceBytes,
      ContentLength: sourceBytes.byteLength,
      ContentType: "image/jpeg",
      Metadata: { sha256: sourceSha256 },
    }));
  });

  it("rejects an object whose read-back bytes differ from the Supabase source", async () => {
    await expect(ensurePrivateR2Object({
      bucket: "private",
      key,
      bytes: sourceBytes,
      contentType: "image/jpeg",
      sha256: sourceSha256,
      findExisting: vi.fn().mockResolvedValue(headFor()),
      putObject: vi.fn(),
      readObject: vi.fn().mockResolvedValue(objectFor(Buffer.from("different bytes"))),
    })).rejects.toThrow("does not match its verified source bytes");
  });

  it("does not overwrite an existing object with mismatched metadata", async () => {
    const putObject = vi.fn();

    await expect(ensurePrivateR2Object({
      bucket: "private",
      key,
      bytes: sourceBytes,
      contentType: "image/jpeg",
      sha256: sourceSha256,
      findExisting: vi.fn().mockResolvedValue({ ...headFor(), ContentType: "application/octet-stream" }),
      putObject,
      readObject: vi.fn(),
    })).rejects.toThrow("does not match the expected size and content type");

    expect(putObject).not.toHaveBeenCalled();
  });
});

describe("verifyPublicMediaDeliveryBytes", () => {
  it("checks the CDN response content type, length and SHA-256 bytes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(sourceBytes, {
      status: 200,
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(sourceBytes.byteLength),
      },
    }));

    await expect(verifyPublicMediaDeliveryBytes({
      url: "https://media.example.test/products/product-1/gallery/image.jpg",
      key,
      expectedByteLength: sourceBytes.byteLength,
      expectedSha256: sourceSha256,
      expectedContentType: "image/jpeg",
      fetchImpl,
    })).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects CDN bytes that differ from the verified R2 object", async () => {
    const bytes = Buffer.from("different image bytes");

    await expect(verifyPublicMediaDeliveryBytes({
      url: "https://media.example.test/products/product-1/gallery/image.jpg",
      key,
      expectedByteLength: bytes.byteLength,
      expectedSha256: sourceSha256,
      expectedContentType: "image/jpeg",
      fetchImpl: vi.fn().mockResolvedValue(new Response(bytes, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })),
    })).rejects.toThrow("Public media CDN bytes do not match the verified source");
  });

  it("rejects unexpected CDN content type before accepting the bytes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(sourceBytes, {
      status: 200,
      headers: { "content-type": "text/html" },
    }));

    await expect(verifyPublicMediaDeliveryBytes({
      url: "https://media.example.test/products/product-1/gallery/image.jpg",
      key,
      expectedByteLength: sourceBytes.byteLength,
      expectedSha256: sourceSha256,
      expectedContentType: "image/jpeg",
      fetchImpl,
    })).rejects.toThrow("Public media CDN metadata does not match the verified source");
  });
});
