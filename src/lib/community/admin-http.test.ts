import { describe, expect, it, vi } from "vitest";

const actor = vi.hoisted(() => ({ current: null as null | { userId: string; emailVerified: boolean; role: "admin" | "user" } }));
vi.mock("server-only", () => ({}));
vi.mock("./session", () => ({ getCommunityActorForRequest: vi.fn(async () => actor.current) }));

import { getCommunityAdminAccess } from "./admin-http";

describe("community admin API access", () => {
  it("returns explicit guest and current-role denials", async () => {
    actor.current = null;
    expect((await getCommunityAdminAccess()).response?.status).toBe(401);
    actor.current = { userId: "user", emailVerified: true, role: "user" };
    expect((await getCommunityAdminAccess()).response?.status).toBe(403);
    actor.current = { userId: "admin", emailVerified: false, role: "admin" };
    expect((await getCommunityAdminAccess()).response?.status).toBe(403);
  });

  it("allows only a verified admin actor", async () => {
    actor.current = { userId: "admin", emailVerified: true, role: "admin" };
    expect(await getCommunityAdminAccess()).toMatchObject({ actor: { userId: "admin", role: "admin" } });
  });
});
