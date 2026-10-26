import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flags: { publicEnabled: true },
  actor: { backend: "local", userId: "11111111-1111-4111-8111-111111111111", emailVerified: true, role: "user", unlockedProductIds: [] } as null | { backend: string; userId: string; emailVerified: boolean; role: string; unlockedProductIds: string[] },
  context: { access: "member", actor: { backend: "local", userId: "11111111-1111-4111-8111-111111111111", emailVerified: true, role: "user", unlockedProductIds: [] } } as { access: string; actor?: unknown },
  artwork: { id: "22222222-2222-4222-8222-222222222222", likesCount: 4, likedByMe: true },
  set: vi.fn(),
  getArtwork: vi.fn(),
  getContext: vi.fn(),
  getActor: vi.fn(),
}));

vi.mock("@/lib/community-flags", () => ({ getCommunityFlags: () => mocks.flags }));
vi.mock("@/lib/community/repository", () => ({
  getCommunityHeartContext: mocks.getContext,
  getCommunityPublicArtwork: mocks.getArtwork,
  setCommunityArtworkLike: mocks.set,
}));
vi.mock("@/lib/community/session", () => ({ getCommunityActorForRequest: mocks.getActor }));

import { DELETE, GET, PUT } from "./route";
import { CommunityAuthorizationError } from "@/lib/community/errors";

const id = "22222222-2222-4222-8222-222222222222";
const params = { params: Promise.resolve({ id }) };
function request(method: string, body?: string, withOrigin = true) {
  return new Request(`https://lamilialomi.example/api/community/artworks/${id}/heart`, {
    method,
    ...(body === undefined ? {} : { body }),
    headers: { host: "lamilialomi.example", ...(withOrigin ? { origin: "https://lamilialomi.example" } : {}) },
  });
}

describe("community heart API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flags = { publicEnabled: true };
    mocks.actor = { backend: "local", userId: "11111111-1111-4111-8111-111111111111", emailVerified: true, role: "user", unlockedProductIds: [] };
    mocks.context = { access: "member", actor: mocks.actor };
    mocks.getActor.mockImplementation(async () => mocks.actor);
    mocks.getContext.mockImplementation(async () => mocks.context);
    mocks.getArtwork.mockImplementation(async () => mocks.artwork);
    mocks.set.mockImplementation(async (_artworkId: string, liked: boolean) => ({ available: true, liked, likesCount: liked ? 5 : 4 }));
  });

  it("returns only the public count and this verified member's own reaction state", async () => {
    const response = await GET(request("GET"), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, liked: true, likesCount: 4 });
    expect(mocks.getArtwork).toHaveBeenCalledWith(id, mocks.actor);
  });

  it("blocks GET, PUT, and DELETE while the public switch is off", async () => {
    mocks.flags.publicEnabled = false;
    expect((await GET(request("GET"), params)).status).toBe(404);
    expect((await PUT(request("PUT"), params)).status).toBe(404);
    expect((await DELETE(request("DELETE"), params)).status).toBe(404);
    expect(mocks.getContext).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("requires same origin and rejects actor or other body fields", async () => {
    expect((await PUT(request("PUT", undefined, false), params)).status).toBe(403);
    expect((await PUT(request("PUT", JSON.stringify({ actorUserId: "spoof", liked: true })), params)).status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("uses explicit idempotent PUT and DELETE intent without exposing user identifiers", async () => {
    expect((await PUT(request("PUT"), params)).status).toBe(200);
    expect(await (await PUT(request("PUT"), params)).json()).toEqual({ ok: true, liked: true, likesCount: 5 });
    expect((await DELETE(request("DELETE"), params)).status).toBe(200);
    expect(mocks.set).toHaveBeenNthCalledWith(1, id, true);
    expect(mocks.set).toHaveBeenNthCalledWith(3, id, false);
    expect(JSON.stringify(await (await GET(request("GET"), params)).json())).not.toContain("userId");
  });

  it("distinguishes guests, unverified accounts, and nonmembers", async () => {
    mocks.actor = null;
    expect((await PUT(request("PUT"), params)).status).toBe(401);
    mocks.actor = { backend: "local", userId: "11111111-1111-4111-8111-111111111111", emailVerified: false, role: "user", unlockedProductIds: [] };
    expect((await PUT(request("PUT"), params)).status).toBe(403);
    mocks.set.mockRejectedValueOnce(new CommunityAuthorizationError("Member only"));
    expect((await PUT(request("PUT"), params)).status).toBe(403);
  });
});
