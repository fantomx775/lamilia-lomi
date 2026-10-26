import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCommunityFlags: vi.fn(),
  getBackendMode: vi.fn(),
  getActor: vi.fn(),
  assertEligibility: vi.fn(),
  consumeRateLimit: vi.fn(),
  reserve: vi.fn(),
  finalize: vi.fn(),
  markStored: vi.fn(),
  getReservation: vi.fn(),
  getMyArtwork: vi.fn(),
  processCleanup: vi.fn(),
  scheduleCleanup: vi.fn(),
  getMediaUploadProvider: vi.fn(),
  normalize: vi.fn(),
  store: vi.fn(),
  read: vi.fn(),
  listPublic: vi.fn(),
  heartContext: vi.fn(),
  order: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/community-flags", () => ({ getCommunityFlags: mocks.getCommunityFlags }));
vi.mock("@/lib/config", () => ({ getBackendMode: mocks.getBackendMode }));
vi.mock("@/lib/community/session", () => ({ getCommunityActorForRequest: mocks.getActor }));
vi.mock("@/lib/community/image", () => ({
  COMMUNITY_IMAGE_MAX_BYTES: 4 * 1024 * 1024,
  normalizeCommunityArtworkImage: mocks.normalize,
  communityUploadFingerprint: () => "a".repeat(64),
}));
vi.mock("@/lib/community/storage", () => ({
  storeCommunityArtworkImage: mocks.store,
  readCommunityArtworkImage: mocks.read,
}));
vi.mock("@/lib/community/repository", () => ({
  assertCommunityArtworkUploadEligibility: mocks.assertEligibility,
  consumeCommunityRateLimit: mocks.consumeRateLimit,
  reserveCommunityArtworkUpload: mocks.reserve,
  finalizeCommunityArtworkUpload: mocks.finalize,
  markCommunityArtworkUploadStored: mocks.markStored,
  getCommunityUploadReservation: mocks.getReservation,
  getMyCommunityArtwork: mocks.getMyArtwork,
  processCommunityArtworkCleanup: mocks.processCleanup,
  scheduleCommunityArtworkUploadCleanup: mocks.scheduleCleanup,
  listCommunityPublicArtworks: mocks.listPublic,
  getCommunityHeartContext: mocks.heartContext,
}));
vi.mock("@/lib/media-r2-config", () => ({ getMediaUploadProvider: mocks.getMediaUploadProvider }));

import { GET, POST } from "./route";
import { CommunityConflictError, CommunityValidationError } from "@/lib/community/errors";
import { encodeCommunityTimestampCursor } from "@/lib/community/cursor";

const actor = { backend: "local" as const, userId: "11111111-1111-4111-8111-111111111111", emailVerified: true, role: "user" as const, unlockedProductIds: [] };
const productId = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";
const ownerArtwork = {
  id: "44444444-4444-4444-8444-444444444444",
  status: "pending",
  revision: 1,
  description: "A flower",
  contentType: "image/webp",
};

function uploadRequest(options: { duplicate?: boolean; bytes?: number; fields?: Record<string, string> } = {}) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(options.bytes ?? 8)], "art.png", { type: "image/png" }));
  form.set("productId", productId);
  form.set("description", "A flower");
  form.set("idempotencyKey", key);
  form.set("rulesAccepted", "true");
  for (const [name, value] of Object.entries(options.fields ?? {})) form.set(name, value);
  if (options.duplicate) form.append("description", "duplicate");
  return new Request("http://localhost/api/community/artworks", {
    method: "POST",
    headers: { Origin: "http://localhost", Host: "localhost" },
    body: form,
  });
}

describe("community artwork upload API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order = [];
    mocks.getCommunityFlags.mockReturnValue({ uploadsEnabled: true, publicEnabled: false });
    mocks.listPublic.mockResolvedValue({ items: [], nextCursor: null });
    mocks.getBackendMode.mockReturnValue("local");
    mocks.getActor.mockResolvedValue(actor);
    mocks.assertEligibility.mockImplementation(async () => { mocks.order.push("eligibility"); });
    mocks.consumeRateLimit.mockImplementation(async (scope: string) => { mocks.order.push(scope); return true; });
    mocks.normalize.mockImplementation(async () => {
      mocks.order.push("normalize");
      return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/webp", originalSha256: "b".repeat(64), normalizedSha256: "c".repeat(64) };
    });
    mocks.reserve.mockResolvedValue({ state: "reserved", leaseToken: "55555555-5555-4555-8555-555555555555", storagePath: `community/${actor.userId}/${key}`, storageProvider: "local" });
    mocks.store.mockResolvedValue({ path: `community/${actor.userId}/${key}`, provider: "local" });
    mocks.finalize.mockResolvedValue(ownerArtwork.id);
    mocks.markStored.mockResolvedValue(true);
    mocks.getMyArtwork.mockResolvedValue(ownerArtwork);
    mocks.processCleanup.mockResolvedValue(undefined);
    mocks.scheduleCleanup.mockResolvedValue(true);
  });

  it("checks eligibility and bounded attempt rate before decoding, then returns a safe owner projection", async () => {
    const response = await POST(uploadRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, artwork: ownerArtwork });
    expect(mocks.order.indexOf("eligibility")).toBeLessThan(mocks.order.indexOf("artwork-upload-attempt"));
    expect(mocks.order.indexOf("artwork-upload-attempt")).toBeLessThan(mocks.order.indexOf("normalize"));
    expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({
      productId,
      idempotencyKey: key,
      contentType: "image/webp",
      uploadFingerprint: "a".repeat(64),
    }));
    expect(mocks.finalize).toHaveBeenCalledWith(key, expect.any(String));
  });

  it("rejects guests before reading the multipart body and rejects unverified users", async () => {
    mocks.getActor.mockResolvedValueOnce(null);
    expect((await POST(uploadRequest())).status).toBe(401);
    expect(mocks.normalize).not.toHaveBeenCalled();

    mocks.getActor.mockResolvedValueOnce({ ...actor, emailVerified: false });
    expect((await POST(uploadRequest())).status).toBe(403);
    expect(mocks.normalize).not.toHaveBeenCalled();
  });

  it("rejects unknown and duplicate multipart fields and oversized files", async () => {
    expect((await POST(uploadRequest({ fields: { userId: actor.userId } }))).status).toBe(400);
    expect((await POST(uploadRequest({ duplicate: true }))).status).toBe(400);
    expect((await POST(uploadRequest({ bytes: 4 * 1024 * 1024 + 1 }))).status).toBe(400);
    expect(mocks.normalize).not.toHaveBeenCalled();
  });

  it("rejects missing rules confirmation and blocks per-account invalid-byte attempts before Sharp", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "art.png", { type: "image/png" }));
    form.set("productId", productId);
    form.set("description", "");
    form.set("idempotencyKey", key);
    expect((await POST(new Request("http://localhost/api/community/artworks", { method: "POST", headers: { Origin: "http://localhost", Host: "localhost" }, body: form }))).status).toBe(400);

    mocks.consumeRateLimit.mockResolvedValue(false);
    expect((await POST(uploadRequest())).status).toBe(429);
    expect(mocks.normalize).not.toHaveBeenCalled();
  });

  it("returns safe conflicts for active same-key work and changed payloads", async () => {
    mocks.reserve.mockRejectedValueOnce(new CommunityConflictError("different payload"));
    const response = await POST(uploadRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "conflict", message: expect.any(String) });
  });

  it("cleans a definite invalid-finalization failure while preserving domain status", async () => {
    mocks.finalize.mockRejectedValue(new CommunityValidationError());
    mocks.getReservation.mockResolvedValue({ state: "stored", leaseToken: "55555555-5555-4555-8555-555555555555" });
    const response = await POST(uploadRequest());
    expect(response.status).toBe(400);
    expect(mocks.scheduleCleanup).toHaveBeenCalledWith(key, "55555555-5555-4555-8555-555555555555");
    expect(JSON.stringify(await response.json())).not.toContain("database");
  });

  it("resumes durably stored bytes without writing again or charging the new-submission limit", async () => {
    mocks.reserve.mockResolvedValue({ state: "stored", leaseToken: "55555555-5555-4555-8555-555555555555", storagePath: `community/${actor.userId}/${key}`, storageProvider: "local" });
    const response = await POST(uploadRequest());
    expect(response.status).toBe(200);
    expect(mocks.store).not.toHaveBeenCalled();
    expect(mocks.markStored).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith("artwork-upload-attempt", actor.userId, 12, 60 * 60);
    expect(mocks.finalize).toHaveBeenCalledWith(key, "55555555-5555-4555-8555-555555555555");
  });

  it("does not publish or redirect uploaded bytes", async () => {
    const response = await POST(uploadRequest());
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("community public gallery API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCommunityFlags.mockReturnValue({ uploadsEnabled: false, publicEnabled: true });
    mocks.listPublic.mockResolvedValue({ items: [{ id: "safe-artwork" }], nextCursor: null });
    mocks.heartContext.mockResolvedValue({ access: "guest" });
  });

  it("returns a bounded safe page using latest, audience, and product filters", async () => {
    const response = await GET(new Request(`http://localhost/api/community/artworks?audience=kids&productId=${productId}&sort=latest&limit=2`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ ok: true, items: [{ id: "safe-artwork" }], nextCursor: null, heartAccess: "guest" });
    expect(mocks.listPublic).toHaveBeenCalledWith({ audience: "kids", productId, cursor: null, limit: 2, sort: "latest", viewer: undefined });
  });

  it("accepts the opaque microsecond-preserving continuation cursor", async () => {
    const cursor = encodeCommunityTimestampCursor("2026-10-25T12:00:00.123456+00:00", "99999999-9999-4999-8999-999999999999");
    const response = await GET(new Request(`http://localhost/api/community/artworks?cursor=${cursor}`));
    expect(response.status).toBe(200);
    expect(mocks.listPublic).toHaveBeenCalledWith({ audience: undefined, productId: undefined, cursor, limit: 24, sort: "latest", viewer: undefined });
  });

  it("accepts popular sorting with a sort-specific cursor and rejects malformed filters", async () => {
    const { encodeCommunityPopularCursor } = await import("@/lib/community/cursor");
    const cursor = encodeCommunityPopularCursor(4, "2026-10-25T12:00:00.123456Z", "99999999-9999-4999-8999-999999999999");
    const popular = await GET(new Request(`http://localhost/api/community/artworks?sort=popular&cursor=${cursor}`));
    expect(popular.status).toBe(200);
    expect(mocks.listPublic).toHaveBeenCalledWith({ audience: undefined, productId: undefined, cursor, limit: 24, sort: "popular", viewer: undefined });
    mocks.listPublic.mockClear();
    for (const query of ["audience=kids&audience=adults", "debug=true", "limit=49", "cursor=bad", `sort=latest&cursor=${cursor}`]) {
      const response = await GET(new Request(`http://localhost/api/community/artworks?${query}`));
      expect(response.status).toBe(400);
    }
    expect(mocks.listPublic).not.toHaveBeenCalled();
  });

  it("hides the listing when the public flag is off", async () => {
    mocks.getCommunityFlags.mockReturnValue({ uploadsEnabled: true, publicEnabled: false });
    expect((await GET(new Request("http://localhost/api/community/artworks"))).status).toBe(404);
    expect(mocks.listPublic).not.toHaveBeenCalled();
  });
});
