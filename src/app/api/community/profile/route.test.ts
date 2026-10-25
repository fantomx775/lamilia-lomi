import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  actor: {
    backend: "local", userId: "b0000000-0000-4000-8000-000000000001",
    emailVerified: true, role: "user", unlockedProductIds: [],
  } as null | { backend: string; userId: string; emailVerified: boolean; role: string; unlockedProductIds: string[] },
  flags: { publicEnabled: false, uploadsEnabled: true },
  profile: { username: "garden_user", avatarSeed: "safe-seed", isAdult: true },
  error: null as Error | null,
}));

vi.mock("@/lib/community/session", () => ({
  getCommunityActorForRequest: vi.fn(async () => state.actor),
}));
vi.mock("@/lib/community-flags", () => ({ getCommunityFlags: () => state.flags }));
vi.mock("@/lib/community/repository", () => ({
  changeCommunityUsername: vi.fn(async () => {
    if (state.error) throw state.error;
    return state.profile;
  }),
  getMyCommunityProfile: vi.fn(async () => state.profile),
  leaveColoringClub: vi.fn(async () => {
    if (state.error) throw state.error;
    return true;
  }),
}));

import { changeCommunityUsername, getMyCommunityProfile, leaveColoringClub } from "@/lib/community/repository";
import { CommunityConflictError } from "@/lib/community/errors";
import { DELETE, GET, PATCH } from "./route";

const ORIGIN = "https://lamilialomi.test";
function request(method: string, body?: unknown, origin: string | null = ORIGIN) {
  return new Request(`${ORIGIN}/api/community/profile`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      ...(origin === null ? {} : { origin }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
  });
}

describe("/api/community/profile", () => {
  beforeEach(() => {
    state.actor = {
      backend: "local", userId: "b0000000-0000-4000-8000-000000000001",
      emailVerified: true, role: "user", unlockedProductIds: [],
    };
    state.flags = { publicEnabled: false, uploadsEnabled: true };
    state.error = null;
    vi.clearAllMocks();
  });

  it("returns only the signed-in owner's private profile without caching", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, profile: state.profile });
    expect(getMyCommunityProfile).toHaveBeenCalledOnce();
  });

  it("allows only a same-origin username patch and maps uniqueness conflicts to 409", async () => {
    const spoofed = await PATCH(request("PATCH", { username: "other", role: "admin" }));
    expect(spoofed.status).toBe(400);
    expect(changeCommunityUsername).not.toHaveBeenCalled();
    expect((await PATCH(request("PATCH", { username: "new_name" }, null))).status).toBe(403);

    state.error = new CommunityConflictError("That community value is already in use.");
    const conflict = await PATCH(request("PATCH", { username: "taken_name" }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: "conflict" });
  });

  it("keeps authenticated withdrawal available while both feature flags are off", async () => {
    state.flags = { publicEnabled: false, uploadsEnabled: false };
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, left: true, profile: state.profile });
    expect(leaveColoringClub).toHaveBeenCalledOnce();
  });

  it("does not read a profile for anonymous or unverified sessions", async () => {
    state.actor = null;
    expect((await GET()).status).toBe(401);
    state.actor = { backend: "local", userId: "user", emailVerified: false, role: "user", unlockedProductIds: [] };
    expect((await GET()).status).toBe(403);
    expect(getMyCommunityProfile).not.toHaveBeenCalled();
  });
});
