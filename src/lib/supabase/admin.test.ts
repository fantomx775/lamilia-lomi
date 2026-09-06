import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getBackendMode: vi.fn(),
  getRequiredSupabaseEnv: vi.fn(),
  getServiceRoleKey: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/config", () => ({
  getBackendMode: mocks.getBackendMode,
  getRequiredSupabaseEnv: mocks.getRequiredSupabaseEnv,
  getServiceRoleKey: mocks.getServiceRoleKey,
}));

import { createServiceRoleClient } from "./admin";

describe("createServiceRoleClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getRequiredSupabaseEnv.mockReturnValue({
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_test",
      appUrl: "https://example.test",
    });
    mocks.createClient.mockReturnValue({});
  });

  it("sends a new secret key only as apikey, never as a JWT bearer token", async () => {
    const secretKey = "sb_secret_test";
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    mocks.getServiceRoleKey.mockReturnValue(secretKey);

    createServiceRoleClient();

    const [, , options] = mocks.createClient.mock.calls[0];
    expect(options.global.headers).toEqual({ apikey: secretKey });

    await options.global.fetch("https://example.supabase.co/storage/v1", {
      headers: { Authorization: "Bearer stale-token" },
    });

    const headers = fetch.mock.calls[0][1].headers as Headers;
    expect(headers.get("apikey")).toBe(secretKey);
    expect(headers.get("authorization")).toBeNull();
  });

  it("keeps the legacy service-role client path unchanged", () => {
    mocks.getServiceRoleKey.mockReturnValue("legacy-service-role-jwt");

    createServiceRoleClient();

    const [, , options] = mocks.createClient.mock.calls[0];
    expect(options.global).toBeUndefined();
  });
});
