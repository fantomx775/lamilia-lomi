import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  signedUrl: vi.fn(),
  clientConfig: undefined as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    constructor(config: unknown) {
      mocks.clientConfig = config;
    }

    send = mocks.send;
  }
  const command = (name: string) => class {
    readonly name = name;
    readonly input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  };
  return {
    S3Client,
    CopyObjectCommand: command("CopyObjectCommand"),
    DeleteObjectCommand: command("DeleteObjectCommand"),
    GetObjectCommand: command("GetObjectCommand"),
    HeadObjectCommand: command("HeadObjectCommand"),
    PutObjectCommand: command("PutObjectCommand"),
  };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.signedUrl }));

import {
  assertR2StagingUpload,
  createSignedR2Upload,
  demoteR2PublicObject,
  finalizeR2StagingUpload,
  promoteR2PrivateObject,
  verifyPublicDelivery,
} from "./media-r2";

const storagePath = "products/11111111-1111-4111-8111-111111111111/cover/11111111-1111-4111-8111-111111111199-cover.jpg";

afterEach(() => vi.unstubAllGlobals());

describe("R2 product image storage", () => {
  beforeEach(() => {
    vi.stubEnv("R2_ACCOUNT_ID", "1234567890abcdef1234567890abcdef");
    vi.stubEnv("R2_ACCESS_KEY_ID", "access-key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-key");
    vi.stubEnv("R2_PRIVATE_BUCKET", "lamilia-private");
    vi.stubEnv("R2_PUBLIC_BUCKET", "lamilia-public");
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://media.example.com");
    mocks.send.mockReset().mockResolvedValue({ ContentLength: 1024, ContentType: "image/jpeg" });
    mocks.signedUrl.mockReset().mockResolvedValue("https://r2.example/signed-put");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {
      status: 200,
      headers: { "content-length": "1024" },
    })));
  });

  it("signs only a private staging PUT with the exact path, MIME type, and byte length", async () => {
    const result = await createSignedR2Upload({
      assetId: "11111111-1111-4111-8111-111111111199",
      productId: "11111111-1111-4111-8111-111111111111",
      kind: "cover",
      storagePath,
      contentType: "image/jpeg",
      sizeBytes: 1024,
    });

    expect(result).toMatchObject({
      url: "https://r2.example/signed-put",
      storagePath,
      stagingPath: `staging/${storagePath}`,
      headers: { "Content-Type": "image/jpeg" },
    });
    expect(mocks.signedUrl.mock.calls[0][1]).toMatchObject({
      input: {
        Bucket: "lamilia-private",
        Key: `staging/${storagePath}`,
        ContentType: "image/jpeg",
        ContentLength: 1024,
      },
    });
    expect(mocks.clientConfig).toMatchObject({
      endpoint: "https://1234567890abcdef1234567890abcdef.r2.cloudflarestorage.com",
      region: "auto",
      forcePathStyle: true,
    });
  });

  it("rejects non-image kinds and checks the uploaded staging size and type before save", async () => {
    await expect(createSignedR2Upload({
      assetId: "11111111-1111-4111-8111-111111111199",
      productId: "11111111-1111-4111-8111-111111111111",
      kind: "premium_download",
      storagePath,
      contentType: "application/pdf",
      sizeBytes: 1024,
    })).rejects.toThrow("limited to public product images");

    await expect(assertR2StagingUpload({
      stagingPath: `staging/${storagePath}`,
      contentType: "image/jpeg",
      sizeBytes: 2048,
    })).rejects.toThrow("does not match");
  });

  it("copies a verified staging object to private storage before removing staging", async () => {
    await finalizeR2StagingUpload({
      stagingPath: `staging/${storagePath}`,
      storagePath,
      contentType: "image/jpeg",
      sizeBytes: 1024,
    });

    expect(mocks.send.mock.calls.map(([command]) => (command as { name: string }).name)).toEqual([
      "HeadObjectCommand",
      "CopyObjectCommand",
      "HeadObjectCommand",
      "DeleteObjectCommand",
    ]);
    expect(mocks.send.mock.calls[1][0]).toMatchObject({
      input: {
        Bucket: "lamilia-private",
        Key: storagePath,
        CopySource: `/lamilia-private/staging/${storagePath}`,
      },
    });
    expect(mocks.send.mock.calls[3][0]).toMatchObject({
      input: { Bucket: "lamilia-private", Key: `staging/${storagePath}` },
    });
  });

  it("treats an already finalized private object as a successful retry when staging is gone", async () => {
    mocks.send
      .mockRejectedValueOnce({ name: "NotFound", $metadata: { httpStatusCode: 404 } })
      .mockResolvedValueOnce({ ContentLength: 1024, ContentType: "image/jpeg" });

    await finalizeR2StagingUpload({
      stagingPath: `staging/${storagePath}`,
      storagePath,
      contentType: "image/jpeg",
      sizeBytes: 1024,
    });

    expect(mocks.send.mock.calls.map(([command]) => (command as { name: string }).name)).toEqual([
      "HeadObjectCommand",
      "HeadObjectCommand",
    ]);
  });

  it("publishes a verified copy with a bounded cache lifetime", async () => {
    const bytes = Buffer.alloc(1024, 7);
    mocks.send.mockImplementation(async (command) => {
      if ((command as { name?: string }).name === "GetObjectCommand") {
        return {
          ContentLength: 1024,
          ContentType: "image/jpeg",
          Body: { transformToByteArray: async () => bytes },
        };
      }
      return { ContentLength: 1024, ContentType: "image/jpeg" };
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes, {
      status: 200,
      headers: { "content-length": "1024", "content-type": "image/jpeg" },
    })));

    await promoteR2PrivateObject(storagePath, "image/jpeg");

    expect(mocks.send.mock.calls[1][0]).toMatchObject({
      input: {
        Bucket: "lamilia-public",
        Key: storagePath,
        CacheControl: "public, max-age=60, s-maxage=60, must-revalidate",
        MetadataDirective: "REPLACE",
      },
    });
    expect(mocks.send.mock.calls[2][0]).toMatchObject({
      input: { Bucket: "lamilia-public", Key: storagePath },
    });
    expect(fetch).toHaveBeenCalledWith(`https://media.example.com/${storagePath}`, expect.objectContaining({
      method: "GET",
      headers: { "Cache-Control": "no-cache" },
    }));
  });

  it("does not replace an existing private object when its HEAD fails for a non-missing reason", async () => {
    const failure = { name: "ServiceUnavailable", $metadata: { httpStatusCode: 503 } };
    mocks.send.mockRejectedValueOnce(failure);

    await expect(demoteR2PublicObject(storagePath)).rejects.toBe(failure);

    expect(mocks.send.mock.calls.map(([command]) => (command as { name: string }).name)).toEqual([
      "HeadObjectCommand",
    ]);
  });

  it("copies a public object to private storage only when the private object is confirmed missing", async () => {
    mocks.send
      .mockRejectedValueOnce({ name: "NotFound", $metadata: { httpStatusCode: 404 } })
      .mockResolvedValueOnce({ ContentLength: 1024, ContentType: "image/jpeg", ETag: "same" })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ ContentLength: 1024, ContentType: "image/jpeg", ETag: "same" });

    await demoteR2PublicObject(storagePath);

    expect(mocks.send.mock.calls.map(([command]) => (command as { name: string }).name)).toEqual([
      "HeadObjectCommand",
      "HeadObjectCommand",
      "CopyObjectCommand",
      "HeadObjectCommand",
    ]);
  });

  it("does not mark an object public when its custom domain is not serving the expected bytes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {
      status: 200,
      headers: { "content-length": "512" },
    })));

    await expect(verifyPublicDelivery("https://media.example.com", storagePath, 1024)).rejects.toThrow(
      "unexpected object size",
    );
  });

  it("rejects CDN bytes that differ from the verified private object", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Buffer.alloc(1024, 8), {
      status: 200,
      headers: { "content-length": "1024", "content-type": "image/jpeg" },
    })));

    await expect(verifyPublicDelivery("https://media.example.com", storagePath, 1024, {
      contentType: "image/jpeg",
      sha256: "f".repeat(64),
    })).rejects.toThrow("bytes that do not match");
  });
});
