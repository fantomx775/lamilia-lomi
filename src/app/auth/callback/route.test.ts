import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const auth = {
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
};

vi.mock("@/lib/config", () => ({
  getBackendMode: () => "supabase",
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, delete: vi.fn() }),
}));

import { GET } from "./route";

describe("Supabase auth callback", () => {
  beforeEach(() => {
    auth.exchangeCodeForSession.mockReset();
    auth.getUser.mockReset();
  });

  it("exchanges a valid callback and redirects to the safe account target", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    auth.getUser.mockResolvedValue({
      data: { user: { email_confirmed_at: "2026-08-16T10:00:00.000Z" } },
    });

    const response = await GET(new Request("https://app.example/auth/callback?code=valid&locale=en"));

    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("valid");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/en/account");
    expect(response.headers.get("location")).not.toContain("valid");
  });

  it("returns a controlled failure for a missing callback parameter", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });

    const response = await GET(new Request("https://app.example/auth/callback?locale=pl"));

    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://app.example/pl/login?error=verification_failed",
    );
  });

  it("returns a controlled failure for an invalid callback value", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: new Error("expired") });
    auth.getUser.mockResolvedValue({ data: { user: null } });

    const response = await GET(new Request("https://app.example/auth/callback?code=invalid&locale=en"));

    expect(response.headers.get("location")).toBe(
      "https://app.example/en/login?error=verification_failed",
    );
  });

  it("lets an already-confirmed user past a reused callback", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: new Error("already used") });
    auth.getUser.mockResolvedValue({
      data: { user: { email_confirmed_at: "2026-08-16T10:00:00.000Z" } },
    });

    const response = await GET(new Request("https://app.example/auth/callback?code=reused&locale=en"));

    expect(response.headers.get("location")).toBe("https://app.example/en/account");
  });
});
