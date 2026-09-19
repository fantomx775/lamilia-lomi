import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const profileQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };
  const unlockQuery = {
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
    unlockQuery,
    supabase,
  };
});

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("./supabase/auth-cookie", () => ({
  hasSupabaseAuthCookie: mocks.hasSupabaseAuthCookie,
}));
vi.mock("./supabase/server", () => ({ createClient: mocks.createClient }));

describe("getAccountSessionForRequest", () => {
  const originalBackendMode = process.env.LAMILIA_BACKEND;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.LAMILIA_BACKEND = "supabase";

    mocks.profileQuery.select.mockReturnValue(mocks.profileQuery);
    mocks.profileQuery.eq.mockReturnValue(mocks.profileQuery);
    mocks.profileQuery.maybeSingle.mockResolvedValue({
      data: {
        role: "user",
        marketing_consent: true,
        terms_accepted_at: "2026-01-01T00:00:00Z",
        preferred_locale: "pl",
      },
      error: null,
    });
    mocks.unlockQuery.select.mockReturnValue(mocks.unlockQuery);
    mocks.unlockQuery.eq.mockReturnValue(mocks.unlockQuery);
    mocks.unlockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });

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
    mocks.supabase.from.mockImplementation((table: string) =>
      table === "user_product_unlocks" ? mocks.unlockQuery : mocks.profileQuery,
    );
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
    const { getAccountSessionForRequest } = await import("./session.server");

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

describe("getProductDetailAccessForRequest", () => {
  const originalBackendMode = process.env.LAMILIA_BACKEND;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.LAMILIA_BACKEND = "supabase";

    mocks.cookies.mockResolvedValue({
      getAll: () => [{ name: "sb-project-auth-token", value: "token" }],
    });
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
    mocks.unlockQuery.select.mockReturnValue(mocks.unlockQuery);
    mocks.unlockQuery.eq.mockReturnValue(mocks.unlockQuery);
    mocks.unlockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.supabase.from.mockImplementation((table: string) =>
      table === "user_product_unlocks" ? mocks.unlockQuery : mocks.profileQuery,
    );
    mocks.createClient.mockReturnValue(mocks.supabase);
  });

  afterEach(() => {
    if (originalBackendMode === undefined) {
      delete process.env.LAMILIA_BACKEND;
    } else {
      process.env.LAMILIA_BACKEND = originalBackendMode;
    }
  });

  it("does not look up unlocks for a guest", async () => {
    mocks.hasSupabaseAuthCookie.mockReturnValue(false);
    const { getProductDetailAccessForRequest } = await import("./session.server");

    await expect(getProductDetailAccessForRequest("product-guest")).resolves.toEqual({
      session: null,
      isUnlocked: false,
    });

    expect(mocks.supabase.from).not.toHaveBeenCalled();
  });

  it("does not look up unlocks for a signed-in user whose email is unverified", async () => {
    mocks.supabase.auth.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-unverified",
          email: "pending@example.com",
          email_confirmed_at: null,
          created_at: "2025-12-01T00:00:00Z",
        },
      },
      error: null,
    });
    const { getProductDetailAccessForRequest } = await import("./session.server");

    await expect(getProductDetailAccessForRequest("product-unverified")).resolves.toEqual({
      session: { emailVerified: false, isDemo: false },
      isUnlocked: false,
    });

    expect(mocks.supabase.from).not.toHaveBeenCalled();
  });

  it("returns locked access for a verified user without the current product unlock", async () => {
    const { getProductDetailAccessForRequest } = await import("./session.server");

    await expect(getProductDetailAccessForRequest("product-locked")).resolves.toEqual({
      session: { emailVerified: true, isDemo: false },
      isUnlocked: false,
    });

    expect(mocks.supabase.from).toHaveBeenCalledWith("user_product_unlocks");
  });

  it("returns unlocked access only when the current product has an unlock", async () => {
    mocks.unlockQuery.maybeSingle.mockResolvedValue({
      data: { product_id: "product-unlocked" },
      error: null,
    });
    const { getProductDetailAccessForRequest } = await import("./session.server");

    await expect(getProductDetailAccessForRequest("product-unlocked")).resolves.toEqual({
      session: { emailVerified: true, isDemo: false },
      isUnlocked: true,
    });
  });

  it("filters the unlock query to the current user and product only", async () => {
    const { getProductDetailAccessForRequest } = await import("./session.server");

    await getProductDetailAccessForRequest("product-specific");

    expect(mocks.unlockQuery.select).toHaveBeenCalledWith("product_id");
    expect(mocks.unlockQuery.eq.mock.calls).toEqual([
      ["user_id", "user-1"],
      ["product_id", "product-specific"],
    ]);
  });

  it("fails closed when the product unlock query fails", async () => {
    mocks.unlockQuery.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "database details must not escape" },
    });
    const { getProductDetailAccessForRequest } = await import("./session.server");

    const error = await getProductDetailAccessForRequest("product-error").catch(
      (caughtError: unknown) => caughtError,
    );

    expect(error).toMatchObject({ message: "Could not check this product unlock." });
    expect(error).not.toHaveProperty("isUnlocked", true);
    expect(error).not.toHaveProperty("message", "database details must not escape");
    expect(mocks.unlockQuery.maybeSingle).toHaveBeenCalledTimes(1);
  });
});
