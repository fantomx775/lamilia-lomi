import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), page: vi.fn() }));
vi.mock("@/lib/community/session", () => ({ getCommunityActorForRequest: mocks.actor }));
vi.mock("@/lib/community/repository", () => ({ listMyCommunityArtworksPage: mocks.page }));
import { GET } from "./route";
import { encodeCommunityTimestampCursor } from "@/lib/community/cursor";

beforeEach(() => { vi.clearAllMocks(); });
describe("private owner artwork pagination", () => {
  it("rejects guest/unverified requests independently of cursor ownership", async () => {
    mocks.actor.mockResolvedValueOnce(null).mockResolvedValueOnce({ emailVerified: false });
    expect((await GET(new Request("https://localhost/api/community/my-artworks"))).status).toBe(401);
    expect((await GET(new Request("https://localhost/api/community/my-artworks"))).status).toBe(403);
    expect(mocks.page).not.toHaveBeenCalled();
  });
  it("keeps owner results private and passes only a valid position cursor", async () => {
    mocks.actor.mockResolvedValue({ emailVerified: true });
    mocks.page.mockResolvedValue({ items: [{ id: "owned" }], nextCursor: null });
    const cursor = encodeCommunityTimestampCursor("2026-11-17T00:00:00Z", "11111111-1111-4111-8111-111111111111");
    const response = await GET(new Request(`https://localhost/api/community/my-artworks?cursor=${cursor}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.page).toHaveBeenCalledWith({ cursor, limit: 50 });
  });
  it.each(["cursor=bad", "cursor=x&cursor=y", "authorId=other"])("rejects malformed or identity-changing queries %s", async (query) => {
    expect((await GET(new Request(`https://localhost/api/community/my-artworks?${query}`))).status).toBe(400);
    expect(mocks.page).not.toHaveBeenCalled();
  });
});
