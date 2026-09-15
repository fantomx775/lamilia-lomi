import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const profileQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  const supabase = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  };

  return {
    cookies: vi.fn(),
    hasSupabaseAuthCookie: vi.fn(),
    createClient: vi.fn(),
    profileQuery,
    supabase,
  };
});

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("./supabase/auth-cookie", () => ({
  hasSupabaseAuthCookie: mocks.hasSupabaseAuthCookie,
}));
vi.mock("./supabase/server", () => ({ createClient: mocks.createClient }));

import { getAccountSessionForRequest } from "./session.server";

describe("getAccountSessionForRequest", () => {
  const originalBackendMode = process.env.LAMILIA_BACKEND;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LAMILIA_BACKEND = "supabase";

    const query = mocks.profileQuery;
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({
      data: {
        role: "user",
        marketing_consent: true,
        terms_accepted_at: "2026-01-01T00:00:00Z",
        preferred_locale: "pl",
      },
      error: null,
    });

    mocks.cookies.mockResolvedValue({ getAll: () => [{ name: "sb-project-auth-token", value: "token" }] });
    mocks.hasSupabaseAuthCookie.mockReturnValue(true);
    mocks.supabase.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "reader@example.com",
          email_confirmed_at: "2026-01-01T00:00:00Z",
          created_at: "2025-12-01T00:00:00Z",
        },
      },
      error: null,
    });
    mocks.supabase.from.mockReturnValue(query);
    mocks.createClient.mockReturnValue(mocks.supabase);
  });

  afterEach(() => {
    if (originalBackendMode === undefined) {
      delete process.env.LAMILIA_BACKEND;
    } else {
      process.env.LAMILIA_BACKEND = originalBackendMode;
    }
  });

  it("loads account details without reading library unlocks", async () => {
    await expect(getAccountSessionForRequest()).resolves.toEqual({
      email: "reader@example.com",
      role: "user",
      emailVerified: true,
      marketingConsent: true,
      isDemo: false,
    });

    expect(mocks.supabase.from.mock.calls.map(([table]) => table)).toEqual(["profiles"]);
  });
});
