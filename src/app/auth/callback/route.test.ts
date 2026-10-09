import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const auth = {
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
};
const resume = vi.hoisted(() => ({
  intent: null as null | Record<string, string | undefined>,
  callbackIntent: null as null | Record<string, string | undefined>,
  clear: vi.fn(),
  redeem: vi.fn(),
  clearUnlock: vi.fn(),
  setUnlock: vi.fn(),
  setAuthResume: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  getBackendMode: () => "supabase",
  getCanonicalAppUrl: () => new URL("https://canonical.lamilialomi.example"),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth }),
}));
vi.mock("@/lib/auth-resume", () => ({
  authResumeIntentMatchesUser: (
    intent: Record<string, string | undefined>,
    user: { id?: string; email?: string },
  ) =>
    intent.userId
      ? intent.userId === user.id
      : intent.emailHash === "reader-email-hash" && user.email === "reader@example.com",
  clearAuthResumeIntent: resume.clear,
  decodeAuthResumeCallbackToken: (token: string | null) =>
    token === "opaque-resume" ? resume.callbackIntent : null,
  getAuthResumeRedirect: (intent?: { returnTo?: string }, locale = "en") =>
    intent?.returnTo
      ? `${intent.returnTo.startsWith(`/${locale}/products/`) ? `${intent.returnTo}#premium` : intent.returnTo}`
      : `/${locale}/account`,
  redeemAuthResumeIntent: resume.redeem,
  readAuthResumeIntent: async () => resume.intent,
  setAuthResumeIntent: resume.setAuthResume,
  sanitizeInternalReturnTo: (value: string | null, locale: string) =>
    value?.startsWith(`/${locale}/`) ? value : `/${locale}/account`,
}));
vi.mock("@/lib/unlock-intent", () => ({
  clearUnlockIntent: resume.clearUnlock,
  setUnlockIntent: resume.setUnlock,
}));

import { GET } from "./route";

describe("Supabase auth callback", () => {
  beforeEach(() => {
    auth.exchangeCodeForSession.mockReset();
    auth.verifyOtp.mockReset();
    auth.getUser.mockReset();
    resume.intent = null;
    resume.callbackIntent = null;
    resume.clear.mockReset();
    resume.redeem.mockReset();
    resume.clearUnlock.mockReset();
    resume.setUnlock.mockReset();
    resume.setAuthResume.mockReset();
    resume.redeem.mockResolvedValue(null);
  });

  it("exchanges a valid callback and redirects to the safe account target", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    auth.getUser.mockResolvedValue({
      data: { user: { email_confirmed_at: "2026-08-16T10:00:00.000Z" } },
    });

    const response = await GET(new Request("https://app.example/auth/callback?code=valid&locale=en"));

    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("valid");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://canonical.lamilialomi.example/en/account",
    );
    expect(response.headers.get("location")).not.toContain("valid");
  });

  it("verifies an email token hash and resumes its encrypted intent on another device", async () => {
    resume.callbackIntent = {
      locale: "en",
      emailHash: "reader-email-hash",
      returnTo: "/en/products/moon-garden-coloring-book",
      productSlug: "moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    };
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "new-device-user",
          email: "reader@example.com",
          email_confirmed_at: "2026-08-16T10:00:00.000Z",
        },
      },
    });
    resume.redeem.mockResolvedValue({ ok: true, status: "success" });

    const response = await GET(
      new Request(
        "https://app.example/auth/callback?token_hash=actual-token-hash&type=email&locale=en&resume=opaque-resume",
      ),
    );

    expect(auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: "actual-token-hash",
      type: "email",
    });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(resume.redeem).toHaveBeenCalledWith(resume.callbackIntent);
    expect(response.headers.get("location")).toBe(
      "https://canonical.lamilialomi.example/en/products/moon-garden-coloring-book?unlocked=1#premium",
    );
    expect(response.headers.get("location")).not.toContain("LOMI-BOOK-2026");
  });

  it("retains the premium code on another device when redemption throws", async () => {
    resume.callbackIntent = {
      locale: "en",
      emailHash: "reader-email-hash",
      returnTo: "/en/products/moon-garden-coloring-book",
      productSlug: "moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    };
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "new-device-user",
          email: "reader@example.com",
          email_confirmed_at: "2026-08-16T10:00:00.000Z",
        },
      },
    });
    resume.redeem.mockRejectedValue(new Error("temporary redemption failure"));

    const response = await GET(
      new Request(
        "https://app.example/auth/callback?token_hash=actual-token-hash&type=email&locale=en&resume=opaque-resume",
      ),
    );

    expect(resume.setUnlock).toHaveBeenCalledWith({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
    });
    expect(response.headers.get("location")).toContain(
      "/en/products/moon-garden-coloring-book?unlock=unexpected#premium",
    );
    expect(response.headers.get("location")).not.toContain("LOMI-BOOK-2026");
    expect(resume.setAuthResume).toHaveBeenCalledWith({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      userId: undefined,
      emailHash: "reader-email-hash",
    });
    expect(resume.clearUnlock.mock.invocationCallOrder[0]).toBeLessThan(
      resume.redeem.mock.invocationCallOrder[0],
    );
    expect(resume.clear).not.toHaveBeenCalled();
  });

  it("retains the account-bound premium intent on another device when redemption returns auth_required", async () => {
    resume.callbackIntent = {
      locale: "en",
      emailHash: "reader-email-hash",
      returnTo: "/en/products/moon-garden-coloring-book",
      productSlug: "moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    };
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "new-device-user",
          email: "reader@example.com",
          email_confirmed_at: "2026-08-16T10:00:00.000Z",
        },
      },
    });
    resume.redeem.mockResolvedValue({ ok: false, status: "auth_required" });

    const response = await GET(
      new Request(
        "https://app.example/auth/callback?token_hash=actual-token-hash&type=email&locale=en&resume=opaque-resume",
      ),
    );

    expect(resume.setUnlock).toHaveBeenCalledWith({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
    });
    expect(resume.setAuthResume).toHaveBeenCalledWith({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      userId: undefined,
      emailHash: "reader-email-hash",
    });
    expect(resume.clearUnlock.mock.invocationCallOrder[0]).toBeLessThan(
      resume.redeem.mock.invocationCallOrder[0],
    );
    expect(resume.clear).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("unlock=auth_required");
    expect(response.headers.get("location")).not.toContain("LOMI-BOOK-2026");
  });

  it("rejects a token hash with an unsupported OTP type", async () => {
    resume.callbackIntent = {
      locale: "en",
      emailHash: "reader-email-hash",
      returnTo: "/en/products/moon-garden-coloring-book",
      productSlug: "moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    };

    const response = await GET(
      new Request(
        "https://app.example/auth/callback?token_hash=actual-token-hash&type=recovery&locale=en&resume=opaque-resume",
      ),
    );

    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(resume.redeem).not.toHaveBeenCalled();
    expect(resume.setAuthResume).toHaveBeenCalledWith({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      userId: undefined,
      emailHash: "reader-email-hash",
    });
    expect(response.headers.get("location")).toContain("error=verification_failed");
  });

  it("retains account-bound retry context when the confirmed user lookup is unavailable", async () => {
    resume.callbackIntent = {
      locale: "en",
      emailHash: "reader-email-hash",
      returnTo: "/en/products/moon-garden-coloring-book",
      productSlug: "moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    };
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error("temporary lookup failure") });

    const response = await GET(
      new Request(
        "https://app.example/auth/callback?token_hash=actual-token-hash&type=email&locale=en&resume=opaque-resume",
      ),
    );

    expect(resume.setAuthResume).toHaveBeenCalledWith({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      userId: undefined,
      emailHash: "reader-email-hash",
    });
    expect(resume.redeem).not.toHaveBeenCalled();
    expect(resume.clearUnlock).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toContain(
      "error=verification_unavailable",
    );
    expect(response.headers.get("location")).not.toContain("LOMI-BOOK-2026");
  });

  it("rejects callback URLs that mix a code and a token hash", async () => {
    resume.callbackIntent = {
      locale: "en",
      emailHash: "reader-email-hash",
      returnTo: "/en/products/moon-garden-coloring-book",
      productSlug: "moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    };

    const response = await GET(
      new Request(
        "https://app.example/auth/callback?code=auth-code&token_hash=actual-token-hash&type=email&locale=en&resume=opaque-resume",
      ),
    );

    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(resume.redeem).not.toHaveBeenCalled();
    expect(resume.setAuthResume).toHaveBeenCalledWith({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      userId: undefined,
      emailHash: "reader-email-hash",
    });
    expect(response.headers.get("location")).toContain("error=verification_failed");
  });

  it("returns a controlled failure for a missing callback parameter", async () => {
    resume.callbackIntent = {
      locale: "en",
      emailHash: "reader-email-hash",
      returnTo: "/en/products/moon-garden-coloring-book",
      productSlug: "moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    };

    const response = await GET(
      new Request(
        "https://app.example/auth/callback?locale=en&resume=opaque-resume",
      ),
    );

    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.getUser).not.toHaveBeenCalled();
    expect(resume.redeem).not.toHaveBeenCalled();
    expect(resume.setAuthResume).toHaveBeenCalledWith({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      userId: undefined,
      emailHash: "reader-email-hash",
    });
    expect(response.headers.get("location")).toBe(
      "https://canonical.lamilialomi.example/en/login?error=verification_failed&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book%23premium",
    );
  });

  it("does not redeem a pending intent from an existing session without a callback code", async () => {
    resume.intent = {
      locale: "en",
      userId: "expected-user",
      returnTo: "/en/products/moon-garden-coloring-book",
    };
    auth.getUser.mockResolvedValue({
      data: { user: { id: "expected-user", email_confirmed_at: "2026-08-16T10:00:00.000Z" } },
    });

    const response = await GET(new Request("https://app.example/auth/callback?locale=en"));

    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(resume.redeem).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://canonical.lamilialomi.example/en/login?error=verification_failed&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book%23premium",
    );
  });

  it("returns a controlled failure for an invalid callback value", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: new Error("expired") });
    auth.getUser.mockResolvedValue({ data: { user: null } });

    const response = await GET(new Request("https://app.example/auth/callback?code=invalid&locale=en"));

    expect(response.headers.get("location")).toBe(
      "https://canonical.lamilialomi.example/en/login?error=verification_failed",
    );
  });

  it("lets an already-confirmed user past a reused callback", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: new Error("already used") });
    auth.getUser.mockResolvedValue({
      data: { user: { email_confirmed_at: "2026-08-16T10:00:00.000Z" } },
    });

    const response = await GET(new Request("https://app.example/auth/callback?code=reused&locale=en"));

    expect(response.headers.get("location")).toBe(
      "https://canonical.lamilialomi.example/en/account",
    );
  });

  it("does not redeem a pending intent after a failed code exchange even with a confirmed session", async () => {
    resume.intent = {
      locale: "en",
      userId: "expected-user",
      returnTo: "/en/products/moon-garden-coloring-book",
    };
    auth.exchangeCodeForSession.mockResolvedValue({ error: new Error("expired") });
    auth.getUser.mockResolvedValue({
      data: { user: { id: "expected-user", email_confirmed_at: "2026-08-16T10:00:00.000Z" } },
    });

    const response = await GET(new Request("https://app.example/auth/callback?code=expired&locale=en"));

    expect(resume.redeem).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("error=verification_failed");
  });

  it("redeems only after a successful exchange for the intended user", async () => {
    resume.intent = {
      locale: "en",
      userId: "expected-user",
      returnTo: "/en/products/moon-garden-coloring-book",
      productSlug: "moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    };
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    auth.getUser.mockResolvedValue({
      data: { user: { id: "expected-user", email_confirmed_at: "2026-08-16T10:00:00.000Z" } },
    });
    resume.redeem.mockResolvedValue({ ok: true, status: "success" });

    const response = await GET(new Request("https://app.example/auth/callback?code=valid&locale=en"));

    expect(resume.redeem).toHaveBeenCalledWith(resume.intent);
    expect(response.headers.get("location")).toBe(
      "https://canonical.lamilialomi.example/en/products/moon-garden-coloring-book?unlocked=1#premium",
    );
    expect(response.headers.get("location")).not.toContain("LOMI-BOOK-2026");
  });

  it("resumes an encrypted product intent on another device after email verification", async () => {
    resume.callbackIntent = {
      locale: "en",
      emailHash: "reader-email-hash",
      returnTo: "/en/products/moon-garden-coloring-book",
      productSlug: "moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    };
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "new-device-user",
          email: "reader@example.com",
          email_confirmed_at: "2026-08-16T10:00:00.000Z",
        },
      },
    });
    resume.redeem.mockResolvedValue({ ok: true, status: "success" });

    const response = await GET(
      new Request(
        "https://app.example/auth/callback?code=valid&locale=en&resume=opaque-resume",
      ),
    );

    expect(resume.redeem).toHaveBeenCalledWith(resume.callbackIntent);
    expect(response.headers.get("location")).toBe(
      "https://canonical.lamilialomi.example/en/products/moon-garden-coloring-book?unlocked=1#premium",
    );
    expect(response.headers.get("location")).not.toContain("LOMI-BOOK-2026");
  });

  it("uses the clicked callback intent and clears another account's stale unlock state", async () => {
    resume.intent = {
      locale: "en",
      userId: "stale-cookie-user",
      returnTo: "/en/products/other-product",
      productSlug: "other-product",
      code: "OTHER-CODE",
    };
    resume.callbackIntent = {
      locale: "en",
      emailHash: "reader-email-hash",
      returnTo: "/en/products/moon-garden-coloring-book",
      productSlug: "moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    };
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "reader-user",
          email: "reader@example.com",
          email_confirmed_at: "2026-08-16T10:00:00.000Z",
        },
      },
    });
    resume.redeem.mockResolvedValue({ ok: false, status: "invalid_code" });

    const response = await GET(
      new Request(
        "https://app.example/auth/callback?code=valid&locale=en&resume=opaque-resume",
      ),
    );

    expect(resume.redeem).toHaveBeenCalledWith(resume.callbackIntent);
    expect(resume.clearUnlock).toHaveBeenCalledTimes(1);
    expect(resume.setUnlock).toHaveBeenCalledWith({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
    });
    expect(response.headers.get("location")).toContain(
      "/en/products/moon-garden-coloring-book?unlock=invalid_code#premium",
    );
    expect(response.headers.get("location")).not.toContain("OTHER-CODE");
  });

  it("clears stale unlock state when a callback intent arrives without a resume cookie", async () => {
    resume.callbackIntent = {
      locale: "en",
      emailHash: "reader-email-hash",
      returnTo: "/en/account",
    };
    auth.verifyOtp.mockResolvedValue({ error: null });
    auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "reader-user",
          email: "reader@example.com",
          email_confirmed_at: "2026-08-16T10:00:00.000Z",
        },
      },
    });

    const response = await GET(
      new Request(
        "https://app.example/auth/callback?token_hash=actual-token-hash&type=email&locale=en&resume=opaque-resume",
      ),
    );

    expect(resume.clear).toHaveBeenCalledTimes(1);
    expect(resume.clearUnlock).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe(
      "https://canonical.lamilialomi.example/en/account",
    );
  });

  it("does not redeem callback resume state if the email code exchange fails", async () => {
    resume.callbackIntent = {
      locale: "en",
      emailHash: "reader-email-hash",
      returnTo: "/en/products/moon-garden-coloring-book",
      productSlug: "moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    };
    auth.exchangeCodeForSession.mockResolvedValue({ error: new Error("expired") });
    auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "new-device-user",
          email: "reader@example.com",
          email_confirmed_at: "2026-08-16T10:00:00.000Z",
        },
      },
    });

    const response = await GET(
      new Request(
        "https://app.example/auth/callback?code=expired&locale=en&resume=opaque-resume",
      ),
    );

    expect(resume.redeem).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("error=verification_failed");
  });

  it.each(["returns an error", "throws"] as const)(
    "preserves the account-bound cross-device intent when token verification $0",
    async (failureMode) => {
      resume.callbackIntent = {
        locale: "en",
        emailHash: "reader-email-hash",
        returnTo: "/en/products/moon-garden-coloring-book",
        productSlug: "moon-garden-coloring-book",
        code: "LOMI-BOOK-2026",
      };
      if (failureMode === "throws") {
        auth.verifyOtp.mockRejectedValue(new Error("temporary verification failure"));
      } else {
        auth.verifyOtp.mockResolvedValue({
          error: new Error("temporary verification failure"),
        });
      }

      const response = await GET(
        new Request(
          "https://app.example/auth/callback?token_hash=actual-token-hash&type=email&locale=en&resume=opaque-resume",
        ),
      );

      expect(resume.setAuthResume).toHaveBeenCalledWith({
        locale: "en",
        productSlug: "moon-garden-coloring-book",
        returnTo: "/en/products/moon-garden-coloring-book",
        code: "LOMI-BOOK-2026",
        userId: undefined,
        emailHash: "reader-email-hash",
      });
      expect(resume.redeem).not.toHaveBeenCalled();
      expect(response.headers.get("location")).toContain("error=verification_failed");
      expect(response.headers.get("location")).toContain(
        "returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book%23premium",
      );
    },
  );

  it("rejects a callback for a different user and clears stale unlock state", async () => {
    resume.intent = {
      locale: "en",
      userId: "expected-user",
      returnTo: "/en/products/moon-garden-coloring-book",
      productSlug: "moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    };
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    auth.getUser.mockResolvedValue({
      data: { user: { id: "other-user", email_confirmed_at: "2026-08-16T10:00:00.000Z" } },
    });

    const response = await GET(new Request("https://app.example/auth/callback?code=valid&locale=en"));

    expect(resume.redeem).not.toHaveBeenCalled();
    expect(resume.clear).toHaveBeenCalledTimes(1);
    expect(resume.clearUnlock).toHaveBeenCalledTimes(1);
    expect(resume.setUnlock).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("error=verification_mismatch");
  });

  it("sanitizes the return target carried by a callback URL", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    auth.getUser.mockResolvedValue({
      data: { user: { id: "user", email_confirmed_at: "2026-08-16T10:00:00.000Z" } },
    });

    const response = await GET(
      new Request("https://app.example/auth/callback?code=valid&locale=en&returnTo=https%3A%2F%2Fevil.example"),
    );

    expect(response.headers.get("location")).toBe(
      "https://canonical.lamilialomi.example/en/account",
    );
  });
});
