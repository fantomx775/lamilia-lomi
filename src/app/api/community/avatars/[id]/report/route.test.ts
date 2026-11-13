import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flags: { publicEnabled: true },
  actor: { backend: "local", userId: "11111111-1111-4111-8111-111111111111", emailVerified: true, role: "user", unlockedProductIds: [] } as null | { backend: string; userId: string; emailVerified: boolean; role: string; unlockedProductIds: string[] },
  getActor: vi.fn(), submit: vi.fn(), supports: true,
}));
vi.mock("@/lib/community-flags", () => ({ getCommunityFlags: () => mocks.flags }));
vi.mock("@/lib/community/session", () => ({ getCommunityActorForRequest: mocks.getActor }));
vi.mock("@/lib/community/avatar-repository", () => ({ submitCommunityAvatarReport: mocks.submit, supportsCommunityAvatars: () => mocks.supports }));

import { POST } from "./route";

const id = "22222222-2222-4222-8222-222222222222";
const context = { params: Promise.resolve({ id }) };
function request(body: unknown, opts: { origin?: boolean; ip?: string } = {}) {
  return new Request(`https://lamilialomi.example/api/community/avatars/${id}/report`, {
    method: "POST", body: JSON.stringify(body),
    headers: { host: "lamilialomi.example", "content-type": "application/json", ...(opts.origin === false ? {} : { origin: "https://lamilialomi.example" }), ...(opts.ip ? { "x-real-ip": opts.ip } : {}) },
  });
}

describe("profile photo report API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.flags.publicEnabled = true;
    mocks.supports = true;
    mocks.actor = { backend: "local", userId: "11111111-1111-4111-8111-111111111111", emailVerified: true, role: "user", unlockedProductIds: [] };
    mocks.getActor.mockImplementation(async () => mocks.actor);
    mocks.submit.mockResolvedValue({ duplicate: false });
  });

  it("requires same origin, signed-in verification, and a strict body", async () => {
    expect((await POST(request({ reason: "privacy" }, { origin: false }), context)).status).toBe(403);
    mocks.actor = null;
    expect((await POST(request({ reason: "privacy" }), context)).status).toBe(401);
    mocks.actor = { backend: "local", userId: "11111111-1111-4111-8111-111111111111", emailVerified: false, role: "user", unlockedProductIds: [] };
    expect((await POST(request({ reason: "privacy" }), context)).status).toBe(403);
    mocks.actor = { backend: "local", userId: "11111111-1111-4111-8111-111111111111", emailVerified: true, role: "user", unlockedProductIds: [] };
    expect((await POST(request({ reason: "privacy", reporterUserId: "spoof" }), context)).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("accepts verified nonmember reports and never returns private identities", async () => {
    const response = await POST(request({ reason: "privacy", details: "Please review." }, { ip: "192.0.2.8" }), context);
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload).toEqual({ ok: true, duplicate: false });
    expect(mocks.submit).toHaveBeenCalledWith(mocks.actor!.userId, id, "privacy", "Please review.");
    expect(JSON.stringify(payload)).not.toMatch(/userId|email|reporter/);
  });

  it("rejects unsupported backends, unknown IDs and overlong or extra input", async () => {
    mocks.supports = false;
    expect((await POST(request({ reason: "privacy" }), context)).status).toBe(404);
    mocks.supports = true;
    expect((await POST(request({ reason: "privacy" }), { params: Promise.resolve({ id: "invalid" }) })).status).toBe(404);
    expect((await POST(request({ reason: "privacy", details: "x".repeat(501) }), context)).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("trims report details and handles session lookup failures without exposing data", async () => {
    expect((await POST(request({ reason: "privacy", details: "  Concern  " }), context)).status).toBe(201);
    expect(mocks.submit).toHaveBeenCalledWith(mocks.actor!.userId, id, "privacy", "Concern");
    mocks.getActor.mockRejectedValueOnce(new Error("private session diagnostic"));
    const response = await POST(request({ reason: "privacy" }), context);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private session diagnostic");
  });

  it("returns a safe duplicate response and fails closed when public access is off", async () => {
    mocks.submit.mockResolvedValueOnce({ duplicate: true });
    expect(await (await POST(request({ reason: "other" }), context)).json()).toEqual({ ok: true, duplicate: true });
    mocks.flags.publicEnabled = false;
    expect((await POST(request({ reason: "other" }), context)).status).toBe(404);
  });
});
