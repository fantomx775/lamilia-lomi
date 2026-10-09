import { beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  buildAuthRedirect: vi.fn(),
  buildSupabaseAuthCallbackUrl: vi.fn(),
  authResumeIntentMatchesEmail: vi.fn(),
  authResumeIntentMatchesUser: vi.fn(),
  clearAuthResumeIntent: vi.fn(),
  clearDemoSession: vi.fn(),
  clearUnlockIntent: vi.fn(),
  createAuthResumeIntent: vi.fn(),
  createClient: vi.fn(),
  createDemoSession: vi.fn(),
  getBackendMode: vi.fn(),
  getDemoSession: vi.fn(),
  getAuthResumeRedirect: vi.fn(),
  getProductBySlugForRequest: vi.fn(),
  getUnlockIntent: vi.fn(),
  readAuthResumeIntent: vi.fn(),
  isSupabaseEmailNotConfirmedError: vi.fn(),
  isUnlockRegistrationContext: vi.fn(),
  redeemAuthResumeIntent: vi.fn(),
  redeemPremiumCodeForRequest: vi.fn(),
  redirect: vi.fn(),
  resend: vi.fn(),
  scheduleReviewReminder: vi.fn(),
  setAuthResumeIntent: vi.fn(),
  setDemoSession: vi.fn(),
  setUnlockIntent: vi.fn(),
  validateRegistrationInput: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: actionMocks.redirect,
}));

vi.mock("@/lib/auth", () => ({
  buildAuthRedirect: actionMocks.buildAuthRedirect,
  createDemoSession: actionMocks.createDemoSession,
  isSupabaseEmailNotConfirmedError: actionMocks.isSupabaseEmailNotConfirmedError,
  isUnlockRegistrationContext: actionMocks.isUnlockRegistrationContext,
  validateRegistrationInput: actionMocks.validateRegistrationInput,
}));

vi.mock("@/lib/auth-resume", () => ({
  authResumeIntentMatchesEmail: actionMocks.authResumeIntentMatchesEmail,
  authResumeIntentMatchesUser: actionMocks.authResumeIntentMatchesUser,
  buildSupabaseAuthCallbackUrl: actionMocks.buildSupabaseAuthCallbackUrl,
  createAuthResumeIntent: actionMocks.createAuthResumeIntent,
  clearAuthResumeIntent: actionMocks.clearAuthResumeIntent,
  redeemAuthResumeIntent: actionMocks.redeemAuthResumeIntent,
  getAuthResumeRedirect: actionMocks.getAuthResumeRedirect,
  readAuthResumeIntent: actionMocks.readAuthResumeIntent,
  setAuthResumeIntent: actionMocks.setAuthResumeIntent,
}));

vi.mock("@/lib/config", () => ({
  getBackendMode: actionMocks.getBackendMode,
}));

vi.mock("@/lib/premium-request", () => ({
  redeemPremiumCodeForRequest: actionMocks.redeemPremiumCodeForRequest,
}));

vi.mock("@/lib/reminders", () => ({
  scheduleReviewReminder: actionMocks.scheduleReviewReminder,
}));

vi.mock("@/lib/session.server", () => ({
  clearDemoSession: actionMocks.clearDemoSession,
  getDemoSession: actionMocks.getDemoSession,
  setDemoSession: actionMocks.setDemoSession,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: actionMocks.createClient,
}));

vi.mock("@/lib/products-request", () => ({
  getProductBySlugForRequest: actionMocks.getProductBySlugForRequest,
}));

vi.mock("@/lib/unlock-intent", () => ({
  clearUnlockIntent: actionMocks.clearUnlockIntent,
  getUnlockIntent: actionMocks.getUnlockIntent,
  setUnlockIntent: actionMocks.setUnlockIntent,
}));

import {
  loginDemoAction,
  registerDemoAction,
  resendSupabaseVerificationEmailAction,
  unlockPremiumAction,
} from "./actions";

beforeEach(() => {
  actionMocks.authResumeIntentMatchesEmail.mockReturnValue(false);
  actionMocks.authResumeIntentMatchesUser.mockReturnValue(false);
  actionMocks.getBackendMode.mockReturnValue("local");
  actionMocks.getProductBySlugForRequest.mockResolvedValue(null);
  actionMocks.getUnlockIntent.mockResolvedValue(null);
  actionMocks.readAuthResumeIntent.mockResolvedValue(null);
  actionMocks.isUnlockRegistrationContext.mockImplementation(({ redirectTo }) =>
    Boolean(redirectTo?.includes("/products/")),
  );
  actionMocks.validateRegistrationInput.mockImplementation((input) => ({
    ok: true,
    value: {
      email: input.email,
      password: input.password,
      marketingConsent: Boolean(input.marketingConsent),
      preferredLocale: input.preferredLocale,
    },
  }));
  actionMocks.createDemoSession.mockImplementation((input) => input);
  actionMocks.buildAuthRedirect.mockImplementation(({ locale, redirectTo }) => {
    const returnTo = redirectTo ?? `/${locale}/account`;
    return /^\/(?:en|pl)\/products\/[^/?]+(?:\?.*)?$/.test(returnTo)
      ? `${returnTo}#premium`
      : returnTo;
  });
  actionMocks.getAuthResumeRedirect.mockImplementation((intent, locale = "en") => {
    const returnTo = intent?.returnTo ?? `/${locale}/account`;
    return returnTo.startsWith(`/${locale}/products/`)
      ? `${returnTo}#premium`
      : returnTo;
  });
  actionMocks.buildSupabaseAuthCallbackUrl.mockReturnValue(
    "https://app.example/auth/callback?locale=en&resume=opaque",
  );
  actionMocks.createAuthResumeIntent.mockImplementation(({ locale, returnTo, code }) => ({
    locale: locale ?? "en",
    returnTo: returnTo ?? "/en/account",
    productSlug: returnTo?.includes("/products/")
      ? "moon-garden-coloring-book"
      : undefined,
    code,
  }));
  actionMocks.redirect.mockImplementation((location: string) => {
    const error = new Error(`REDIRECT:${location}`) as Error & { location: string };
    error.location = location;
    throw error;
  });
  vi.clearAllMocks();
  actionMocks.redeemAuthResumeIntent.mockReset();
});

function registrationForm(returnTo?: string, code?: string) {
  const formData = new FormData();
  formData.set("locale", "en");
  formData.set("email", "reader@example.com");
  formData.set("password", "password123");
  formData.set("termsAccepted", "on");

  if (returnTo) {
    formData.set("returnTo", returnTo);
  }

  if (code) {
    formData.set("code", code);
  }

  return formData;
}

function loginForm(email: string, password: string, returnTo?: string) {
  const formData = new FormData();
  formData.set("locale", "en");
  formData.set("email", email);
  formData.set("password", password);
  if (returnTo) {
    formData.set("returnTo", returnTo);
  }
  return formData;
}

async function expectRedirect(action: Promise<void>, location: string) {
  try {
    await action;
    throw new Error("Expected a redirect");
  } catch (error) {
    expect((error as { location?: string }).location).toBe(location);
  }
}

describe("registration auth action", () => {
  it("sends a generic local registration to the neutral account destination", async () => {
    await expectRedirect(registerDemoAction(registrationForm()), "/en/account");

    expect(actionMocks.clearUnlockIntent).toHaveBeenCalledTimes(1);
    expect(actionMocks.setDemoSession).toHaveBeenCalledWith(
      expect.objectContaining({ email: "reader@example.com" }),
    );
  });

  it("keeps leading and trailing spaces in a password sent to Supabase", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    actionMocks.createClient.mockResolvedValue({ auth: { signInWithPassword } });

    await expectRedirect(loginDemoAction(loginForm("reader@example.com", " password ")), "/en/library");

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "reader@example.com",
      password: " password ",
    });
  });

  it("returns a successful password-auth product resume to the premium section", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.createClient.mockResolvedValue({
      auth: { signInWithPassword: vi.fn().mockResolvedValue({ error: null }) },
    });

    await expectRedirect(
      loginDemoAction(
        loginForm(
          "reader@example.com",
          "password123",
          "/en/products/moon-garden-coloring-book",
        ),
      ),
      "/en/products/moon-garden-coloring-book#premium",
    );
  });

  it("recovers a signed callback intent after login only for its verified account", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    const pendingResumeIntent = {
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "reader-email-hash",
      userId: "reader-user",
      createdAt: Date.now(),
    };
    actionMocks.readAuthResumeIntent.mockResolvedValue(pendingResumeIntent);
    actionMocks.authResumeIntentMatchesEmail.mockReturnValue(true);
    actionMocks.authResumeIntentMatchesUser.mockReturnValue(true);
    actionMocks.redeemAuthResumeIntent.mockResolvedValue({
      ok: true,
      status: "success",
    });
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    const getUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: "reader-user",
          email: "reader@example.com",
          email_confirmed_at: "2026-10-09T10:00:00.000Z",
        },
      },
      error: null,
    });
    actionMocks.createClient.mockResolvedValue({
      auth: { signInWithPassword, getUser },
    });

    await expectRedirect(
      loginDemoAction(
        loginForm(
          "reader@example.com",
          "password123",
          "/en/products/moon-garden-coloring-book",
        ),
      ),
      "/en/products/moon-garden-coloring-book?unlocked=1#premium",
    );

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(actionMocks.redeemAuthResumeIntent).toHaveBeenCalledWith(
      pendingResumeIntent,
    );
  });

  it("keeps a pending callback intent when login identity lookup is unavailable", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    const pendingResumeIntent = {
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "reader-email-hash",
      userId: "reader-user",
      createdAt: Date.now(),
    };
    actionMocks.readAuthResumeIntent.mockResolvedValue(pendingResumeIntent);
    actionMocks.authResumeIntentMatchesEmail.mockReturnValue(true);
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    const getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: new Error("temporary lookup failure"),
    });
    actionMocks.createClient.mockResolvedValue({
      auth: { signInWithPassword, getUser },
    });

    await expectRedirect(
      loginDemoAction(
        loginForm(
          "reader@example.com",
          "password123",
          "/en/products/moon-garden-coloring-book",
        ),
      ),
      "/en/login?error=verification_unavailable&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book",
    );

    expect(actionMocks.redeemAuthResumeIntent).not.toHaveBeenCalled();
    expect(actionMocks.clearAuthResumeIntent).not.toHaveBeenCalled();
  });

  it("keeps a local-mode product password-login return anchored to premium", async () => {
    await expectRedirect(
      loginDemoAction(
        loginForm(
          "reader@example.com",
          "password123",
          "/en/products/moon-garden-coloring-book",
        ),
      ),
      "/en/products/moon-garden-coloring-book#premium",
    );
  });

  it("rejects an incomplete login on the server before calling the auth provider", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    const signInWithPassword = vi.fn();
    actionMocks.createClient.mockResolvedValue({ auth: { signInWithPassword } });

    await expectRedirect(loginDemoAction(loginForm("", "")), "/en/login?error=invalid_input&returnTo=%2Fen%2Flibrary");

    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("returns a specific login error and binds its resume intent to the submitted email", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.isSupabaseEmailNotConfirmedError.mockReturnValue(false);
    const signInWithPassword = vi.fn().mockResolvedValue({ error: new Error("invalid login") });
    actionMocks.createClient.mockResolvedValue({ auth: { signInWithPassword } });

    await expectRedirect(
      loginDemoAction(loginForm("reader@example.com", "wrong-password", "/en/products/moon-garden-coloring-book")),
      "/en/login?error=invalid_credentials&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book",
    );

    expect(actionMocks.setAuthResumeIntent).toHaveBeenCalledWith({
      locale: "en",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "",
      email: "reader@example.com",
    });
  });

  it("keeps local verification resend requests on the demo guidance path", async () => {
    const formData = new FormData();
    formData.set("locale", "en");
    formData.set("email", "reader@example.com");
    formData.set("returnTo", "/en/products/moon-garden-coloring-book");

    await expectRedirect(
      resendSupabaseVerificationEmailAction(formData),
      "/en/login?error=verification_required&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book",
    );

    expect(actionMocks.createClient).not.toHaveBeenCalled();
  });

  it("keeps an unlock registration on the product resume path", async () => {
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
    });

    await expectRedirect(
      registerDemoAction(
        registrationForm("/en/products/moon-garden-coloring-book"),
      ),
      "/en/products/moon-garden-coloring-book#premium",
    );

    expect(actionMocks.setUnlockIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        productSlug: "moon-garden-coloring-book",
        returnTo: "/en/products/moon-garden-coloring-book",
      }),
    );
  });

  it("sanitizes an unsafe posted return target to the neutral destination", async () => {
    await expectRedirect(
      registerDemoAction(registrationForm("https://evil.example/phish")),
      "/en/account",
    );
  });

  it("sends generic Supabase signup to verification/login with no premium code in the URL", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.createClient.mockResolvedValue({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: "user-id" }, session: null },
          error: null,
        }),
      },
    });

    await expectRedirect(registerDemoAction(registrationForm()), "/en/login?error=verification_sent&returnTo=%2Fen%2Faccount");

    expect(actionMocks.setAuthResumeIntent).toHaveBeenNthCalledWith(1, {
      locale: "en",
      returnTo: "/en/account",
      code: "",
      email: "reader@example.com",
    });
    expect(actionMocks.setAuthResumeIntent).toHaveBeenNthCalledWith(2, {
      locale: "en",
      returnTo: "/en/account",
      code: "",
      email: "reader@example.com",
      userId: "user-id",
    });
    expect(actionMocks.buildSupabaseAuthCallbackUrl).toHaveBeenCalledWith(
      "en",
      "/en/account",
      expect.objectContaining({ returnTo: "/en/account", code: "" }),
    );
    expect(actionMocks.redirect.mock.calls[0]?.[0]).not.toContain("LOMI-BOOK-2026");
  });

  it("keeps Supabase unlock signup on the existing product verification path", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
    });
    actionMocks.createClient.mockResolvedValue({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: "user-id" }, session: null },
          error: null,
        }),
      },
    });

    await expectRedirect(
      registerDemoAction(
        registrationForm("/en/products/moon-garden-coloring-book"),
      ),
      "/en/products/moon-garden-coloring-book?step=verify#premium",
    );
  });

  it("redirects a generic Supabase signup with an active session to the account", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.createClient.mockResolvedValue({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: {
            user: { id: "user-id", email_confirmed_at: "2026-09-04T10:00:00.000Z" },
            session: { access_token: "access-token" },
          },
          error: null,
        }),
      },
    });

    await expectRedirect(registerDemoAction(registrationForm()), "/en/account");

    expect(actionMocks.redirect.mock.calls[0]?.[0]).toBe("/en/account");
    expect(actionMocks.redirect.mock.calls[0]?.[0]).not.toContain("verification_sent");
    expect(actionMocks.clearAuthResumeIntent).toHaveBeenCalledTimes(1);
    expect(actionMocks.redeemAuthResumeIntent).toHaveBeenCalledWith(
      expect.objectContaining({ returnTo: "/en/account", productSlug: undefined }),
    );
  });

  it("continues an active-session Supabase unlock signup through redemption", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
      reviewDelayDays: 7,
    });
    actionMocks.redeemAuthResumeIntent.mockResolvedValue({
      ok: true,
      status: "success",
    });
    actionMocks.createClient.mockResolvedValue({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: {
            user: { id: "user-id", email_confirmed_at: "2026-09-04T10:00:00.000Z" },
            session: { access_token: "access-token" },
          },
          error: null,
        }),
      },
    });

    await expectRedirect(
      registerDemoAction(
        registrationForm("/en/products/moon-garden-coloring-book", "LOMI-BOOK-2026"),
      ),
      "/en/products/moon-garden-coloring-book?unlocked=1#premium",
    );

    expect(actionMocks.redeemAuthResumeIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        productSlug: "moon-garden-coloring-book",
        code: "LOMI-BOOK-2026",
      }),
    );
    expect(actionMocks.scheduleReviewReminder).toHaveBeenCalled();
    expect(actionMocks.redirect.mock.calls.flat().join(" ")).not.toContain("LOMI-BOOK-2026");
  });

  it.each([
    ["already_unlocked", "/en/products/moon-garden-coloring-book?unlocked=already#premium"],
    ["email_unverified", "/en/products/moon-garden-coloring-book?step=verify#premium"],
    ["invalid_code", "/en/products/moon-garden-coloring-book?unlock=invalid_code#premium"],
  ] as const)("maps active-session unlock signup result %s safely", async (status, location) => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
    });
    actionMocks.redeemAuthResumeIntent.mockResolvedValue({
      ok: status === "already_unlocked",
      status,
    });
    actionMocks.createClient.mockResolvedValue({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: "user-id" }, session: { access_token: "access-token" } },
          error: null,
        }),
      },
    });

    await expectRedirect(
      registerDemoAction(
        registrationForm("/en/products/moon-garden-coloring-book", "LOMI-BOOK-2026"),
      ),
      location,
    );

    expect(actionMocks.redirect.mock.calls.flat().join(" ")).not.toContain("LOMI-BOOK-2026");
  });
});

describe("premium unlock action", () => {
  it("maps an unexpected redemption failure to a safe product error", async () => {
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
      reviewDelayDays: 7,
    });
    actionMocks.getDemoSession.mockResolvedValue({
      email: "reader@example.com",
      emailVerified: true,
      unlockedProductIds: [],
    });
    actionMocks.redeemPremiumCodeForRequest.mockRejectedValue(
      new Error("Supabase premium redemption failed: raw database details"),
    );

    const formData = new FormData();
    formData.set("locale", "en");
    formData.set("productSlug", "moon-garden-coloring-book");
    formData.set("code", "LOMI-BOOK-2026");

    await expectRedirect(
      unlockPremiumAction(formData),
      "/en/products/moon-garden-coloring-book?unlock=unexpected#premium",
    );

    expect(actionMocks.setUnlockIntent).toHaveBeenCalledWith({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    });
    expect(actionMocks.redirect.mock.calls.flat().join(" ")).not.toContain(
      "raw database details",
    );
  });

  it.each([
    ["success", { ok: true, status: "success" }, true, "/en/products/moon-garden-coloring-book?unlocked=1#premium"],
    ["already_unlocked", { ok: true, status: "already_unlocked" }, true, "/en/products/moon-garden-coloring-book?unlocked=already#premium"],
    ["invalid_code", { ok: false, status: "invalid_code" }, true, "/en/products/moon-garden-coloring-book?unlock=invalid_code#premium"],
    ["email_unverified", { ok: false, status: "email_unverified" }, true, "/en/products/moon-garden-coloring-book?step=verify#premium"],
    ["session_email_unverified", null, false, "/en/products/moon-garden-coloring-book?step=verify#premium"],
  ] as const)("keeps the premium section visible after %s", async (name, redemption, emailVerified, location) => {
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
      reviewDelayDays: 7,
    });
    actionMocks.getDemoSession.mockResolvedValue({
      email: "reader@example.com",
      emailVerified,
      unlockedProductIds: [],
    });
    if (redemption) {
      actionMocks.redeemPremiumCodeForRequest.mockResolvedValue(redemption);
    }

    const formData = new FormData();
    formData.set("locale", "en");
    formData.set("productSlug", "moon-garden-coloring-book");
    formData.set("code", "LOMI-BOOK-2026");

    await expectRedirect(unlockPremiumAction(formData), location);
  });
});
