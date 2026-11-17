import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: { backend: "supabase", userId: "11111111-1111-4111-8111-111111111111", emailVerified: true, role: "user", unlockedProductIds: [] },
  listOwnerArtworks: vi.fn(), claimArtworkUploadCleanup: vi.fn().mockResolvedValue([]), orders: [] as string[], filters: [] as unknown[], query: undefined as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("../config", () => ({ getBackendMode: () => "supabase" }));
vi.mock("./session", () => ({ assertCommunityActor: vi.fn(async () => mocks.actor), getCommunityActorForRequest: vi.fn(async () => mocks.actor) }));
vi.mock("./supabase-adapter", () => ({ listOwnerArtworks: mocks.listOwnerArtworks, claimArtworkUploadCleanup: mocks.claimArtworkUploadCleanup }));
import { listMyCommunityArtworksPage } from "./repository";
import { decodeCommunityTimestampCursor, encodeCommunityTimestampCursor } from "./cursor";

beforeEach(() => { vi.clearAllMocks(); mocks.claimArtworkUploadCleanup.mockResolvedValue([]); });
describe("owner keyset pages", () => {
  it("requests one lookahead row, binds the full precision timestamp and actor on every page", async () => {
    const createdAt = "2026-11-17T00:00:00.123456+00:00";
    const rows = Array.from({ length: 51 }, (_, i) => ({ id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(999 - i).padStart(12, "0")}`, createdAt }));
    mocks.listOwnerArtworks.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows.slice(50));
    const first = await listMyCommunityArtworksPage();
    expect(first.items).toHaveLength(50);
    expect(mocks.listOwnerArtworks).toHaveBeenNthCalledWith(1, mocks.actor, 51, null);
    expect(decodeCommunityTimestampCursor(first.nextCursor)).toEqual({ timestamp: "2026-11-17T00:00:00.123456Z", id: rows[49].id });
    const next = await listMyCommunityArtworksPage({ cursor: first.nextCursor });
    expect(mocks.listOwnerArtworks).toHaveBeenNthCalledWith(2, mocks.actor, 51, { timestamp: "2026-11-17T00:00:00.123456Z", id: rows[49].id });
    expect(next.items).toEqual(rows.slice(50));
    expect(next.nextCursor).toBeNull();
  });
  it("rejects invalid cursor grammar before privileged owner data reads", async () => {
    await expect(listMyCommunityArtworksPage({ cursor: "unsafe()" })).rejects.toThrow("cursor is invalid");
    expect(mocks.listOwnerArtworks).not.toHaveBeenCalled();
    expect(encodeCommunityTimestampCursor("2026-11-17T00:00:00Z", mocks.actor.userId)).toBeTruthy();
  });
});
