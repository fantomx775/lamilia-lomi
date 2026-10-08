import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const auth = {
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
};
const resume = vi.hoisted(() => ({
  intent: null as null | Record<string, string | undefined>,
  clear: vi.fn(),
  redeem: vi.fn(),
  clearUnlock: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  getBackendMode: () => "supabase",
  getCanonicalAppUrl: () => new URL("https://canonical.lamilialomi.example"),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth }),
}));
vi.mock("@/lib/auth-resume", () => ({
  authResumeIntentMatchesUser: (intent: Record<string, string | undefined>, user: { id?: string }) =>
    Boolean(intent.userId && intent.userId === user.id),
  clearAuthResumeIntent: resume.clear,
  getAuthResumeRedirect: (intent?: { returnTo?: string }, locale = "en") =>
    intent?.returnTo ?? `/${locale}/account`,
  redeemAuthResumeIntent: resume.redeem,
  readAuthResumeIntent: async () => resume.intent,
  sanitizeInternalReturnTo: (value: string | null, locale: string) =>
    value?.startsWith(`/${locale}/`) ? value : `/${locale}/account`,
}));
vi.mock("@/lib/unlock-intent", () => ({ clearUnlockIntent: resume.clearUnlock }));

import { GET } from "./route";

describe("Supabase auth callback", () => {
  beforeEach(() => {
    auth.exchangeCodeForSession.mockReset();
    auth.getUser.mockReset();
    resume.intent = null;
    resume.clear.mockReset();
    resume.redeem.mockReset();
    resume.clearUnlock.mockReset();
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

  it("returns a controlled failure for a missing callback parameter", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });

    const response = await GET(new Request("https://app.example/auth/callback?locale=pl"));

    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://canonical.lamilialomi.example/pl/login?error=verification_failed",
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
      "https://canonical.lamilialomi.example/en/login?error=verification_failed&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book",
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
      "https://canonical.lamilialomi.example/en/products/moon-garden-coloring-book?unlocked=1",
    );
    expect(response.headers.get("location")).not.toContain("LOMI-BOOK-2026");
  });

  it("rejects a successful callback for a different user", async () => {
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
