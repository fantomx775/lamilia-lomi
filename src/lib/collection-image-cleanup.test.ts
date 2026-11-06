import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const provider = vi.hoisted(() => ({ send: vi.fn(), service: vi.fn(), remove: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = provider.send; },
  DeleteObjectCommand: class { constructor(readonly input: unknown) {} },
  GetObjectCommand: class {}, HeadObjectCommand: class {}, PutObjectCommand: class {},
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn() }));
vi.mock("./media-r2-config", () => ({ getMediaUploadProvider: () => "r2", getR2StorageConfig: () => ({
  accountId: "synthetic", privateBucket: "isolated-private", accessKeyId: "synthetic", secretAccessKey: "synthetic" }),
}));
vi.mock("./supabase/admin", () => ({ createServiceRoleClient: provider.service }));
import { removeCollectionImage } from "./collection-image-storage";

const collectionId = "11111111-1111-4111-8111-111111111111";
const storagePath = `community/${collectionId}/22222222-2222-4222-8222-222222222222`;

describe("private deletion transport cancellation", () => {
  beforeEach(() => { vi.clearAllMocks(); provider.remove.mockResolvedValue({ error: null });
    provider.service.mockReturnValue({ storage: { from: () => ({ remove: provider.remove }) } }); });
  afterEach(() => vi.unstubAllGlobals());

  it("passes the exact maintenance cancellation signal to R2 and awaits its abort", async () => {
    const controller = new AbortController();
    provider.send.mockImplementation((_command, options: { abortSignal: AbortSignal }) => new Promise((_resolve, reject) => {
      expect(options.abortSignal).toBe(controller.signal);
      options.abortSignal.addEventListener("abort", () => reject(options.abortSignal.reason), { once: true });
    }));
    const pending = removeCollectionImage({ collectionId, storagePath, provider: "r2", signal: controller.signal });
    controller.abort(new Error("owned storage deadline"));
    await expect(pending).rejects.toThrow("owned storage deadline");
    expect(provider.send).toHaveBeenCalledOnce();
  });

  it("propagates the signal into Supabase's actual fetch wrapper configuration", async () => {
    const controller = new AbortController();
    await removeCollectionImage({ collectionId, storagePath, provider: "supabase", signal: controller.signal });
    expect(provider.service).toHaveBeenCalledWith(expect.objectContaining({ requestSignal: controller.signal }));
    expect(provider.remove).toHaveBeenCalledWith([storagePath]);
  });
});
