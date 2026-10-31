import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const backend = vi.hoisted(() => ({ claimArtwork: vi.fn(), finishArtwork: vi.fn(), claimAccount: vi.fn(), finishAccount: vi.fn(), remove: vi.fn() }));
vi.mock("./supabase-adapter", () => ({ claimArtworkUploadCleanup: backend.claimArtwork,
  finishArtworkUploadCleanup: backend.finishArtwork, claimAccountMediaCleanup: backend.claimAccount,
  finishAccountMediaCleanup: backend.finishAccount }));
vi.mock("./storage", () => ({ removeCommunityArtworkImage: backend.remove,
  storeCommunityArtworkImage: vi.fn(), readCommunityArtworkImage: vi.fn() }));
vi.mock("./session", () => ({ assertCommunityActor: vi.fn(), getCommunityActorForRequest: vi.fn() }));
import { processCommunityAccountMediaCleanup, processCommunityArtworkCleanup } from "./repository";

const authorId = "11111111-1111-4111-8111-111111111111";
const objectId = "22222222-2222-4222-8222-222222222222";
const storagePath = `community/${authorId}/${objectId}`;

describe("maintenance cleanup cancellation preserves leases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LAMILIA_BACKEND", "supabase");
    backend.finishArtwork.mockResolvedValue(true);
    backend.finishAccount.mockResolvedValue(true);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["artwork", "account"])("cancels %s deletion without finishing an unknown outcome or starting another candidate", async (kind) => {
    const controller = new AbortController();
    let started!: () => void;
    const reachedStorage = new Promise<void>((resolve) => { started = resolve; });
    backend.claimArtwork.mockResolvedValue(Array.from({ length: 2 }, () => ({ authorId, idempotencyKey: objectId,
      storagePath, storageProvider: "supabase", leaseToken: "fenced-lease" })));
    backend.claimAccount.mockResolvedValue(Array.from({ length: 2 }, (_, index) => ({ id: index + 1,
      storage_path: storagePath, storage_provider: "supabase", lease_token: "fenced-lease" })));
    backend.remove.mockImplementation((input: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      expect(input.signal).toBe(controller.signal);
      input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
      started();
    }));
    const running = kind === "artwork" ? processCommunityArtworkCleanup(undefined, controller.signal)
      : processCommunityAccountMediaCleanup(10, controller.signal);
    const stopped = expect(running).rejects.toThrow("owned deletion deadline");
    await reachedStorage;
    controller.abort(new Error("owned deletion deadline"));
    await stopped;
    expect(backend.remove).toHaveBeenCalledOnce();
    expect(backend.finishArtwork).not.toHaveBeenCalled();
    expect(backend.finishAccount).not.toHaveBeenCalled();
  });

  it("does not claim rows when the invocation budget is already exhausted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("owned deletion deadline"));
    await expect(processCommunityArtworkCleanup(undefined, controller.signal)).rejects.toThrow("owned deletion deadline");
    await expect(processCommunityAccountMediaCleanup(10, controller.signal)).rejects.toThrow("owned deletion deadline");
    expect(backend.claimArtwork).not.toHaveBeenCalled();
    expect(backend.claimAccount).not.toHaveBeenCalled();
  });
});
