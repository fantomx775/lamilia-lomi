import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  actor: {
    backend: "local", userId: "a0000000-0000-4000-8000-000000000001",
    emailVerified: true, role: "user", unlockedProductIds: [],
  } as null | { backend: string; userId: string; emailVerified: boolean; role: string; unlockedProductIds: string[] },
  flags: { publicEnabled: true, uploadsEnabled: false },
  rateAllowed: true,
  profile: { username: "garden_user", avatarSeed: "safe-seed", isAdult: true },
  joinError: null as Error | null,
}));

vi.mock("@/lib/community/session", () => ({
  getCommunityActorForRequest: vi.fn(async () => state.actor),
}));
vi.mock("@/lib/community-flags", () => ({ getCommunityFlags: () => state.flags }));
vi.mock("@/lib/community/repository", () => ({
  consumeCommunityRateLimit: vi.fn(async () => state.rateAllowed),
  joinColoringClub: vi.fn(async () => {
    if (state.joinError) throw state.joinError;
    return state.profile;
  }),
}));

import { consumeCommunityRateLimit, joinColoringClub } from "@/lib/community/repository";
import { POST } from "./route";

const ORIGIN = "https://lamilialomi.test";
const validJoin = {
  username: "@Garden_User",
  adultAttested: true,
  rulesAccepted: true,
  rulesVersion: "2026-10-25-v1",
};

function request(body: unknown, options: { origin?: string | null; raw?: string } = {}) {
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  const raw = options.raw ?? JSON.stringify(body);
  return new Request(`${ORIGIN}/api/community/join`, {
    method: "POST",
    headers: {
      ...(origin === null ? {} : { origin }),
      "content-type": "application/json",
    },
    body: raw,
  });
}

describe("POST /api/community/join", () => {
  beforeEach(() => {
    state.actor = {
      backend: "local", userId: "a0000000-0000-4000-8000-000000000001",
      emailVerified: true, role: "user", unlockedProductIds: [],
    };
    state.flags = { publicEnabled: true, uploadsEnabled: false };
    state.rateAllowed = true;
    state.joinError = null;
    vi.clearAllMocks();
  });

  it("accepts the current rules and adult opt-in, returning only the owner profile", async () => {
    const response = await POST(request(validJoin));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, profile: state.profile });
    expect(consumeCommunityRateLimit).toHaveBeenCalledWith("join", state.actor?.userId, 6, 3600);
    expect(joinColoringClub).toHaveBeenCalledWith({ username: "@Garden_User", adultAttested: true });
  });

  it.each([
    [{ ...validJoin, adultAttested: false }],
    [{ ...validJoin, rulesAccepted: false }],
    [{ ...validJoin, rulesVersion: "old-version" }],
    [{ ...validJoin, actorUserId: "spoofed" }],
  ])("rejects incomplete consent or extra caller-controlled fields", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(joinColoringClub).not.toHaveBeenCalled();
  });

  it("denies missing and cross-origin Origin headers", async () => {
    expect((await POST(request(validJoin, { origin: null }))).status).toBe(403);
    expect((await POST(request(validJoin, { origin: "https://attacker.test" }))).status).toBe(403);
    expect(joinColoringClub).not.toHaveBeenCalled();
  });

  it("uses the browser Host when Next normalizes its internal HTTPS hostname", async () => {
    const local = new Request("https://localhost:3443/api/community/join", {
      method: "POST", headers: { host: "127.0.0.1:3443", origin: "https://127.0.0.1:3443", "content-type": "application/json" },
      body: JSON.stringify(validJoin),
    });
    expect((await POST(local)).status).toBe(201);
    const forged = new Request(`${ORIGIN}/api/community/join`, {
      method: "POST", headers: { host: "attacker.test", origin: ORIGIN, "x-forwarded-host": "lamilialomi.test", "content-type": "application/json" },
      body: JSON.stringify(validJoin),
    });
    expect((await POST(forged)).status).toBe(403);
  });

  it("requires a signed-in verified actor and enabled feature flags", async () => {
    state.actor = null;
    expect((await POST(request(validJoin))).status).toBe(401);
    state.actor = { backend: "local", userId: "user", emailVerified: false, role: "user", unlockedProductIds: [] };
    expect((await POST(request(validJoin))).status).toBe(403);
    state.actor.emailVerified = true;
    state.flags = { publicEnabled: false, uploadsEnabled: false };
    expect((await POST(request(validJoin))).status).toBe(404);
    expect(joinColoringClub).not.toHaveBeenCalled();
  });

  it("bounds the streamed body and turns the per-account limiter into HTTP 429", async () => {
    const largeRequest = new Request(`${ORIGIN}/api/community/join`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: `{"pad":"${"x".repeat(9_000)}"}`,
    });
    expect((await POST(largeRequest)).status).toBe(413);
    state.rateAllowed = false;
    const limited = await POST(request(validJoin));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3600");
    expect(joinColoringClub).not.toHaveBeenCalled();
  });
});
