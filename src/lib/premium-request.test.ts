import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBackendMode: vi.fn(() => "supabase"),
  getSupabaseAuthContext: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./config", () => ({ getBackendMode: mocks.getBackendMode }));
vi.mock("./session.server", () => ({
  getDemoSession: vi.fn(),
  getSupabaseAuthContext: mocks.getSupabaseAuthContext,
  setDemoSession: vi.fn(),
}));

import { authorizePremiumDownloadForRequest } from "./premium-request";

describe("authorizePremiumDownloadForRequest", () => {
  it("denies an unverified Supabase user before any asset or Storage access", async () => {
    const from = vi.fn();
    mocks.getSupabaseAuthContext.mockResolvedValue({
      supabase: { from },
      user: { id: "user-1", email_confirmed_at: null },
    });

    await expect(
      authorizePremiumDownloadForRequest("asset-1"),
    ).resolves.toEqual({
      ok: false,
      decision: { allowed: false, reason: "unverified" },
    });
    expect(from).not.toHaveBeenCalled();
  });
});
