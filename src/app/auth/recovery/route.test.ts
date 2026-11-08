import { describe, expect, it, vi } from "vitest";

const verifyOtp = vi.hoisted(() => vi.fn());

vi.mock("@/lib/config", () => ({
  getBackendMode: () => "supabase",
  getCanonicalAppUrl: () => new URL("https://lamilia.example"),
}));
vi.mock("@/lib/supabase/recovery", () => ({
  createRecoveryClient: async () => ({ auth: { verifyOtp } }),
}));

import { GET, POST } from "./route";

describe("cross-browser password recovery", () => {
  const token = "pkce_" + "a".repeat(56);
  function request(origin: string, tokenHash: string) {
    return new Request("https://lamilia.example/auth/recovery", {
      method: "POST",
      headers: { origin },
      body: new URLSearchParams({ token_hash: tokenHash }),
    });
  }

  it("serves a confirmation screen without redeeming a link on GET", async () => {
    verifyOtp.mockClear();
    const response = GET();
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(await response.text()).toContain("Continue to reset password");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin submission without contacting Auth", async () => {
    verifyOtp.mockClear();
    expect((await POST(request("https://other.example", token))).status).toBe(403);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("requires a fresh recovery session even when a token is well formed", async () => {
    verifyOtp.mockResolvedValueOnce({ data: { session: null }, error: new Error("expired") });
    const response = await POST(request("https://lamilia.example", token));
    expect(verifyOtp).toHaveBeenLastCalledWith({ type: "recovery", token_hash: token });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://lamilia.example/en/reset-password?status=invalid-link");
  });
});
