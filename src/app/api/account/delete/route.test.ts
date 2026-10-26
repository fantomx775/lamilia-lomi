import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  actor: { backend: "local", userId: "b0000000-0000-4000-8000-000000000001", emailVerified: true } as null | { backend: string; userId: string; emailVerified: boolean },
  backend: "local",
  allowed: true,
}));
const mocks = vi.hoisted(() => ({ deleteAccount: vi.fn(), clearSession: vi.fn(), deleteUser: vi.fn() }));

vi.mock("@/lib/community/session", () => ({ getCommunityActorForRequest: vi.fn(async () => state.actor) }));
vi.mock("@/lib/config", () => ({ getBackendMode: () => state.backend }));
vi.mock("@/lib/community/repository", () => ({
  consumeCommunityRateLimit: vi.fn(async () => state.allowed),
  deleteLocalCommunityAccount: mocks.deleteAccount,
}));
vi.mock("@/lib/session.server", () => ({ clearDemoSession: mocks.clearSession }));
vi.mock("@/lib/supabase/admin", () => ({
  createServiceRoleClient: () => ({ auth: { admin: { deleteUser: mocks.deleteUser } } }),
}));

import { consumeCommunityRateLimit, deleteLocalCommunityAccount } from "@/lib/community/repository";
import { clearDemoSession } from "@/lib/session.server";
import { POST } from "./route";

const origin = "https://lamilialomi.test";
function request(body: unknown = { confirmation: "DELETE" }, requestOrigin: string | null = origin) {
  return new Request(`${origin}/api/account/delete`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(requestOrigin ? { origin: requestOrigin } : {}) },
    body: JSON.stringify(body),
  });
}

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    state.actor = { backend: "local", userId: "b0000000-0000-4000-8000-000000000001", emailVerified: true };
    state.backend = "local";
    state.allowed = true;
    mocks.deleteAccount.mockReset().mockResolvedValue(1);
    mocks.clearSession.mockReset().mockResolvedValue(undefined);
    mocks.deleteUser.mockReset().mockResolvedValue({ error: null });
    vi.clearAllMocks();
  });

  it("requires same-origin, exact confirmation and a verified session", async () => {
    expect((await POST(request({ confirmation: "DELETE" }, null))).status).toBe(403);
    expect((await POST(request({ confirmation: "DELETE", userId: "spoof" }))).status).toBe(400);
    state.actor = null;
    expect((await POST(request())).status).toBe(401);
    state.actor = { backend: "local", userId: "user", emailVerified: false };
    expect((await POST(request())).status).toBe(403);
    expect(deleteLocalCommunityAccount).not.toHaveBeenCalled();
  });

  it("bounds deletion attempts while allowing retries and clears the local demo session after anonymization", async () => {
    state.allowed = false;
    const limited = await POST(request());
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ message: "Please wait up to 15 minutes before trying again." });
    expect(deleteLocalCommunityAccount).not.toHaveBeenCalled();
    expect(clearDemoSession).not.toHaveBeenCalled();

    state.allowed = true;
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, cleanupQueued: true });
    expect(consumeCommunityRateLimit).toHaveBeenCalledWith("account-deletion", state.actor!.userId, 3, 900);
    expect(deleteLocalCommunityAccount).toHaveBeenCalledWith(state.actor!.userId);
    expect(clearDemoSession).toHaveBeenCalledOnce();
  });

  it("deletes only the session user's Auth account and returns a generic provider failure", async () => {
    state.backend = "supabase";
    state.actor = { backend: "supabase", userId: "b0000000-0000-4000-8000-000000000001", emailVerified: true };
    mocks.deleteUser.mockResolvedValueOnce({ error: { message: "private provider detail" } });
    const failed = await POST(request());
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private provider detail");
    expect(mocks.deleteUser).toHaveBeenCalledWith(state.actor.userId);
    expect(clearDemoSession).not.toHaveBeenCalled();
    expect(consumeCommunityRateLimit).toHaveBeenCalledWith("account-deletion", state.actor.userId, 3, 900);

    mocks.deleteUser.mockResolvedValueOnce({ error: null });
    expect((await POST(request())).status).toBe(200);
    expect(consumeCommunityRateLimit).toHaveBeenCalledTimes(2);
    expect(clearDemoSession).toHaveBeenCalledOnce();
  });
});
