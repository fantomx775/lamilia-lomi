import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  backend: "local",
  localSession: null as null | { email: string; marketingConsent: boolean },
  actor: null as null | { backend: string; userId: string },
}));

const mocks = vi.hoisted(() => ({
  getDemoSession: vi.fn(),
  setDemoSession: vi.fn(),
  getCommunityActorForRequest: vi.fn(),
  createServiceRoleClient: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/config", () => ({ getBackendMode: () => state.backend }));
vi.mock("@/lib/session.server", () => ({
  getDemoSession: mocks.getDemoSession,
  setDemoSession: mocks.setDemoSession,
}));
vi.mock("@/lib/community/session", () => ({ getCommunityActorForRequest: mocks.getCommunityActorForRequest }));
vi.mock("@/lib/supabase/admin", () => ({ createServiceRoleClient: mocks.createServiceRoleClient }));

import { POST } from "./route";

const origin = "https://lamilialomi.test";

function request(body: unknown, requestOrigin: string | null = origin) {
  return new Request(`${origin}/api/account/marketing-consent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(requestOrigin ? { origin: requestOrigin } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/account/marketing-consent", () => {
  beforeEach(() => {
    state.backend = "local";
    state.localSession = { email: "demo@example.test", marketingConsent: true };
    state.actor = { backend: "supabase", userId: "verified-user" };
    mocks.getDemoSession.mockReset().mockImplementation(async () => state.localSession);
    mocks.setDemoSession.mockReset().mockResolvedValue(undefined);
    mocks.getCommunityActorForRequest.mockReset().mockImplementation(async () => state.actor);
    mocks.maybeSingle.mockReset().mockResolvedValue({ data: { id: "verified-user" }, error: null });
    mocks.select.mockReset().mockImplementation(() => ({ maybeSingle: mocks.maybeSingle }));
    mocks.eq.mockReset().mockImplementation(() => ({ select: mocks.select }));
    mocks.update.mockReset().mockImplementation(() => ({ eq: mocks.eq }));
    mocks.from.mockReset().mockImplementation(() => ({ update: mocks.update }));
    mocks.createServiceRoleClient.mockReset().mockImplementation(() => ({ from: mocks.from }));
  });

  it("requires same-origin JSON containing only a boolean preference", async () => {
    expect((await POST(request({ marketingConsent: false }, null))).status).toBe(403);
    expect((await POST(request({ marketingConsent: false, userId: "attacker-selected-user" }))).status).toBe(400);
    expect((await POST(request("{invalid"))).status).toBe(400);
    expect(mocks.setDemoSession).not.toHaveBeenCalled();
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("stores the changed preference in the signed-in local demo session", async () => {
    const session = { email: "demo@example.test", marketingConsent: true };
    state.localSession = session;

    const response = await POST(request({ marketingConsent: false }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, marketingConsent: false });
    expect(mocks.setDemoSession).toHaveBeenCalledWith({ ...session, marketingConsent: false });
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("updates only the profile belonging to the verified Supabase user", async () => {
    state.backend = "supabase";

    const response = await POST(request({ marketingConsent: true }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, marketingConsent: true });
    expect(mocks.getCommunityActorForRequest).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith("profiles");
    expect(mocks.update).toHaveBeenCalledWith({ marketing_consent: true });
    expect(mocks.eq).toHaveBeenCalledWith("id", "verified-user");
  });

  it("does not call the privileged database client without an authenticated user", async () => {
    state.backend = "supabase";
    state.actor = null;

    expect((await POST(request({ marketingConsent: false }))).status).toBe(401);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("returns a generic error when the profile cannot be updated", async () => {
    state.backend = "supabase";
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "private provider detail" } });

    const response = await POST(request({ marketingConsent: false }));

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private provider detail");
  });
});
