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
  actionMocks.createAuthResumeIntent.mockImplementation(({ locale, returnTo, code, userId, emailHash }) => ({
    locale: locale ?? "en",
    returnTo: returnTo ?? "/en/account",
    productSlug: returnTo?.includes("/products/")
      ? "moon-garden-coloring-book"
      : undefined,
    code,
    ...(userId ? { userId } : {}),
    ...(emailHash ? { emailHash } : {}),
  }));
  actionMocks.redirect.mockImplementation((location: string) => {
    const error = new Error(`REDIRECT:${location}`) as Error & { location: string };
    error.location = location;
    throw error;
  });
  vi.clearAllMocks();
  actionMocks.redeemAuthResumeIntent.mockReset();
});

function registrationForm(
  returnTo?: string,
  code?: string,
  email = "reader@example.com",
  locale = "en",
) {
  const formData = new FormData();
  formData.set("locale", locale);
  formData.set("email", email);
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

function loginForm(email: string, password: string, returnTo?: string, code?: string) {
  const formData = new FormData();
  formData.set("locale", "en");
  formData.set("email", email);
  formData.set("password", password);
  if (returnTo) {
    formData.set("returnTo", returnTo);
  }
  if (code) {
    formData.set("code", code);
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
    actionMocks.getUnlockIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "STALE-UNBOUND-CODE",
    });
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
    expect(actionMocks.clearUnlockIntent).toHaveBeenCalled();
    expect(actionMocks.redeemAuthResumeIntent).toHaveBeenCalledWith(
      pendingResumeIntent,
    );
  });

  it("prefers a newly submitted premium code when retrying a same-account resume", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    const pendingResumeIntent = {
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "SAVED-CODE",
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
          "REPLACEMENT-CODE",
        ),
      ),
      "/en/products/moon-garden-coloring-book?unlocked=1#premium",
    );

    expect(actionMocks.redeemAuthResumeIntent).toHaveBeenCalledTimes(1);
    expect(actionMocks.redeemAuthResumeIntent).toHaveBeenCalledWith({
      ...pendingResumeIntent,
      code: "REPLACEMENT-CODE",
    });
    expect(actionMocks.setAuthResumeIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "REPLACEMENT-CODE",
        emailHash: "reader-email-hash",
        userId: "reader-user",
      }),
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
          "REPLACEMENT-CODE",
        ),
      ),
      "/en/login?error=verification_unavailable&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book",
    );

    expect(actionMocks.redeemAuthResumeIntent).not.toHaveBeenCalled();
    expect(actionMocks.clearAuthResumeIntent).not.toHaveBeenCalled();
    expect(actionMocks.setAuthResumeIntent).toHaveBeenCalledWith({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "REPLACEMENT-CODE",
      userId: "reader-user",
      emailHash: "reader-email-hash",
    });
  });

  it("does not auto-reuse a premium code from an email-only login intent", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "reader-email-hash",
      createdAt: Date.now(),
    });
    const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
    actionMocks.createClient.mockResolvedValue({ auth: { signInWithPassword } });

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

    expect(actionMocks.clearAuthResumeIntent).toHaveBeenCalledTimes(1);
    expect(actionMocks.redeemAuthResumeIntent).not.toHaveBeenCalled();
    expect(actionMocks.setAuthResumeIntent).not.toHaveBeenCalled();
  });

  it("requires code re-entry and binds it to the signed-in user", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "reader-email-hash",
      createdAt: Date.now(),
    });
    actionMocks.authResumeIntentMatchesUser.mockReturnValue(true);
    actionMocks.redeemAuthResumeIntent.mockResolvedValue({ ok: true, status: "success" });
    actionMocks.createClient.mockResolvedValue({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "new-reader-user",
              email: "reader@example.com",
              email_confirmed_at: "2026-10-09T10:00:00.000Z",
            },
          },
          error: null,
        }),
      },
    });

    await expectRedirect(
      loginDemoAction(
        loginForm(
          "reader@example.com",
          "password123",
          "/en/products/moon-garden-coloring-book",
          "LOMI-BOOK-2026",
        ),
      ),
      "/en/products/moon-garden-coloring-book?unlocked=1#premium",
    );

    expect(actionMocks.clearAuthResumeIntent).toHaveBeenCalledTimes(2);
    expect(actionMocks.redeemAuthResumeIntent).toHaveBeenCalledWith(
      expect.objectContaining({ code: "LOMI-BOOK-2026", userId: "new-reader-user" }),
    );
  });

  it("rejects a saved login intent when the same email belongs to another user ID", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "reader-email-hash",
      userId: "original-reader",
      createdAt: Date.now(),
    });
    actionMocks.authResumeIntentMatchesEmail.mockReturnValue(true);
    actionMocks.authResumeIntentMatchesUser.mockReturnValue(false);
    actionMocks.createClient.mockResolvedValue({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "replacement-reader",
              email: "reader@example.com",
              email_confirmed_at: "2026-10-09T10:00:00.000Z",
            },
          },
          error: null,
        }),
      },
    });

    await expectRedirect(
      loginDemoAction(
        loginForm(
          "reader@example.com",
          "password123",
          "/en/products/moon-garden-coloring-book",
          "REPLACEMENT-CODE",
        ),
      ),
      "/en/login?error=verification_mismatch&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book",
    );

    expect(actionMocks.clearAuthResumeIntent).toHaveBeenCalledTimes(1);
    expect(actionMocks.redeemAuthResumeIntent).not.toHaveBeenCalled();
    expect(actionMocks.setAuthResumeIntent).not.toHaveBeenCalled();
  });

  it.each(["throws", "returns an error"] as const)(
    "preserves a replacement code under its original account binding when sign-in $errorMode",
    async (errorMode) => {
      actionMocks.getBackendMode.mockReturnValue("supabase");
      const pendingResumeIntent = {
        locale: "en",
        productSlug: "moon-garden-coloring-book",
        returnTo: "/en/products/moon-garden-coloring-book",
        code: "SAVED-CODE",
        emailHash: "reader-email-hash",
        userId: "reader-user",
        createdAt: Date.now(),
      };
      actionMocks.readAuthResumeIntent.mockResolvedValue(pendingResumeIntent);
      actionMocks.authResumeIntentMatchesEmail.mockReturnValue(true);
      const signInWithPassword = errorMode === "throws"
        ? vi.fn().mockRejectedValue(new Error("temporary sign-in failure"))
        : vi.fn().mockResolvedValue({ error: new Error("invalid login") });
      actionMocks.createClient.mockResolvedValue({
        auth: { signInWithPassword },
      });

      await expectRedirect(
        loginDemoAction(
          loginForm(
            "reader@example.com",
            "password123",
            "/en/products/moon-garden-coloring-book",
            "REPLACEMENT-CODE",
          ),
        ),
        "/en/login?error=invalid_credentials&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book",
      );

      expect(actionMocks.setAuthResumeIntent).toHaveBeenCalledWith({
        locale: "en",
        productSlug: "moon-garden-coloring-book",
        returnTo: "/en/products/moon-garden-coloring-book",
        code: "REPLACEMENT-CODE",
        userId: "reader-user",
        emailHash: "reader-email-hash",
      });
      expect(actionMocks.redeemAuthResumeIntent).not.toHaveBeenCalled();
    },
  );

  it.each([
    { failureMode: "throws", resumeState: "preserved" },
    { failureMode: "returns auth_required", resumeState: "preserved" },
    { failureMode: "throws", resumeState: "missing" },
    { failureMode: "returns auth_required", resumeState: "missing" },
  ] as const)(
    "prevents account B from redeeming account A's retry after $failureMode with a $resumeState resume cookie",
    async ({ failureMode, resumeState }) => {
      actionMocks.getBackendMode.mockReturnValue("supabase");
      const accountAResumeIntent = {
        locale: "en",
        productSlug: "moon-garden-coloring-book",
        returnTo: "/en/products/moon-garden-coloring-book",
        code: "LOMI-BOOK-2026",
        emailHash: "first-reader-email-hash",
        userId: "first-reader",
        createdAt: Date.now(),
      };
      actionMocks.readAuthResumeIntent
        .mockResolvedValueOnce(accountAResumeIntent)
        .mockResolvedValueOnce(
          resumeState === "preserved" ? accountAResumeIntent : null,
        );
      actionMocks.authResumeIntentMatchesEmail
        .mockReturnValueOnce(true)
        .mockReturnValue(false);
      actionMocks.authResumeIntentMatchesUser.mockReturnValue(true);
      actionMocks.getUnlockIntent
        .mockResolvedValueOnce({
          locale: "en",
          productSlug: "moon-garden-coloring-book",
          returnTo: "/en/products/moon-garden-coloring-book",
          code: "LOMI-BOOK-2026",
        })
        .mockResolvedValueOnce({
          locale: "en",
          productSlug: "moon-garden-coloring-book",
          returnTo: "/en/products/moon-garden-coloring-book",
        });
      if (failureMode === "throws") {
        actionMocks.redeemAuthResumeIntent.mockRejectedValueOnce(
          new Error("temporary redemption failure"),
        );
      } else {
        actionMocks.redeemAuthResumeIntent.mockResolvedValueOnce({
          ok: false,
          status: "auth_required",
        });
      }
      const accountAClient = {
        auth: {
          signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
          getUser: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: "first-reader",
                email: "first-reader@example.com",
                email_confirmed_at: "2026-10-09T10:00:00.000Z",
              },
            },
            error: null,
          }),
        },
      };
      const accountBClient = {
        auth: { signInWithPassword: vi.fn().mockResolvedValue({ error: null }) },
      };
      actionMocks.createClient
        .mockResolvedValueOnce(accountAClient)
        .mockResolvedValueOnce(accountBClient);

      const failureRedirect = failureMode === "throws"
        ? "/en/products/moon-garden-coloring-book?unlock=unexpected#premium"
        : "/en/products/moon-garden-coloring-book?unlock=auth_required#premium";

      await expectRedirect(
        loginDemoAction(
          loginForm(
            "first-reader@example.com",
            "password123",
            "/en/products/moon-garden-coloring-book",
          ),
        ),
        failureRedirect,
      );

      expect(actionMocks.setAuthResumeIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "LOMI-BOOK-2026",
          userId: "first-reader",
          emailHash: "first-reader-email-hash",
        }),
      );
      expect(actionMocks.clearAuthResumeIntent).not.toHaveBeenCalled();
      expect(actionMocks.setUnlockIntent).toHaveBeenCalledWith({
        locale: "en",
        productSlug: "moon-garden-coloring-book",
        returnTo: "/en/products/moon-garden-coloring-book",
      });

      await expectRedirect(
        loginDemoAction(
          loginForm(
            "second-reader@example.com",
            "password123",
            "/en/products/moon-garden-coloring-book?source=retry",
          ),
        ),
        "/en/products/moon-garden-coloring-book?source=retry#premium",
      );

      expect(actionMocks.redeemAuthResumeIntent).toHaveBeenNthCalledWith(
        1,
        accountAResumeIntent,
      );
      expect(actionMocks.redeemAuthResumeIntent).toHaveBeenCalledTimes(1);
    },
  );

  it("does not transfer a pending account's premium code to another login", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "first-reader-email-hash",
      userId: "first-reader",
      createdAt: Date.now(),
    });
    actionMocks.authResumeIntentMatchesEmail.mockReturnValue(false);
    actionMocks.getUnlockIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    });
    actionMocks.createClient.mockResolvedValue({
      auth: { signInWithPassword: vi.fn().mockResolvedValue({ error: null }) },
    });

    await expectRedirect(
      loginDemoAction(
        loginForm(
          "second-reader@example.com",
          "password123",
          "/en/products/moon-garden-coloring-book?source=retry",
        ),
      ),
      "/en/products/moon-garden-coloring-book?source=retry#premium",
    );

    expect(actionMocks.clearUnlockIntent).toHaveBeenCalled();
    expect(actionMocks.clearAuthResumeIntent).toHaveBeenCalled();
    expect(actionMocks.redeemAuthResumeIntent).not.toHaveBeenCalled();
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

  it("does not persist an unbound code when password sign-in fails", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.isSupabaseEmailNotConfirmedError.mockReturnValue(false);
    const signInWithPassword = vi.fn().mockResolvedValue({ error: new Error("invalid login") });
    actionMocks.createClient.mockResolvedValue({ auth: { signInWithPassword } });

    await expectRedirect(
      loginDemoAction(loginForm("reader@example.com", "wrong-password", "/en/products/moon-garden-coloring-book")),
      "/en/login?error=invalid_credentials&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book",
    );

    expect(actionMocks.setAuthResumeIntent).not.toHaveBeenCalled();
    expect(actionMocks.clearUnlockIntent).toHaveBeenCalledTimes(1);
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

  it("resends verification with the signed resume code when an old unlock code is present", async () => {
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
    const formData = new FormData();
    formData.set("locale", "en");
    formData.set("email", "reader@example.com");
    formData.set(
      "returnTo",
      "/en/products/moon-garden-coloring-book?source=retry",
    );
    formData.set("code", "STALE-UNBOUND-CODE");
    actionMocks.createClient.mockResolvedValue({
      auth: { resend: vi.fn().mockResolvedValue({ error: null }) },
    });

    await expectRedirect(
      resendSupabaseVerificationEmailAction(formData),
      "/en/login?error=verification_sent&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book%3Fsource%3Dretry",
    );

    expect(actionMocks.setAuthResumeIntent).toHaveBeenCalledWith({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book?source=retry",
      code: "LOMI-BOOK-2026",
      userId: "reader-user",
      emailHash: "reader-email-hash",
      email: "reader@example.com",
    });
    expect(actionMocks.clearUnlockIntent).toHaveBeenCalledTimes(1);
  });

  it("does not resend another account's pending premium code to a different email", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "first-reader-email-hash",
      userId: "first-reader",
      createdAt: Date.now(),
    });
    actionMocks.authResumeIntentMatchesEmail.mockReturnValue(false);
    const formData = new FormData();
    formData.set("locale", "en");
    formData.set("email", "second-reader@example.com");
    formData.set(
      "returnTo",
      "/en/products/moon-garden-coloring-book?source=retry",
    );
    formData.set("code", "LOMI-BOOK-2026");
    actionMocks.createClient.mockResolvedValue({
      auth: { resend: vi.fn().mockResolvedValue({ error: null }) },
    });

    await expectRedirect(
      resendSupabaseVerificationEmailAction(formData),
      "/en/login?error=verification_sent&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book%3Fsource%3Dretry",
    );

    expect(actionMocks.clearUnlockIntent).toHaveBeenCalledTimes(1);
    expect(actionMocks.setAuthResumeIntent).not.toHaveBeenCalled();
    expect(actionMocks.clearAuthResumeIntent).toHaveBeenCalledTimes(1);
    expect(actionMocks.buildSupabaseAuthCallbackUrl).toHaveBeenCalledWith(
      "en",
      "/en/products/moon-garden-coloring-book?source=retry",
      expect.objectContaining({ code: undefined }),
    );
  });

  it("does not auto-resend a code from an email-only resume intent", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "reader-email-hash",
      createdAt: Date.now(),
    });
    actionMocks.authResumeIntentMatchesEmail.mockReturnValue(true);
    const formData = new FormData();
    formData.set("locale", "en");
    formData.set("email", "reader@example.com");
    formData.set("returnTo", "/en/products/moon-garden-coloring-book");
    actionMocks.createClient.mockResolvedValue({
      auth: { resend: vi.fn().mockResolvedValue({ error: null }) },
    });

    await expectRedirect(
      resendSupabaseVerificationEmailAction(formData),
      "/en/login?error=verification_sent&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book",
    );

    expect(actionMocks.clearAuthResumeIntent).toHaveBeenCalledTimes(1);
    expect(actionMocks.buildSupabaseAuthCallbackUrl).toHaveBeenCalledWith(
      "en",
      "/en/products/moon-garden-coloring-book",
      expect.objectContaining({ code: undefined }),
    );
    expect(actionMocks.setAuthResumeIntent).not.toHaveBeenCalled();
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

  it("does not transfer a pending account's code into another registration", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
    });
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "first-reader-email-hash",
      userId: "first-reader",
      createdAt: Date.now(),
    });
    actionMocks.authResumeIntentMatchesEmail.mockReturnValue(false);
    actionMocks.isUnlockRegistrationContext.mockReturnValue(false);
    const signUp = vi.fn().mockResolvedValue({
      data: { user: { id: "second-reader" }, session: null },
      error: null,
    });
    actionMocks.createClient.mockResolvedValue({ auth: { signUp } });

    await expectRedirect(
      registerDemoAction(
        registrationForm(
          "/en/products/moon-garden-coloring-book?source=retry",
          "LOMI-BOOK-2026",
          "second-reader@example.com",
        ),
      ),
      "/en/login?error=verification_sent&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book%3Fsource%3Dretry",
    );

    expect(actionMocks.clearUnlockIntent).toHaveBeenCalled();
    expect(actionMocks.setAuthResumeIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "",
        email: "second-reader@example.com",
      }),
    );
    expect(actionMocks.clearUnlockIntent.mock.invocationCallOrder[0]).toBeLessThan(
      actionMocks.setAuthResumeIntent.mock.invocationCallOrder[0],
    );
  });

  it("does not rebind a pending account's code when registration targets another product", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "other-product-id",
      slug: "another-product",
    });
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "first-reader-email-hash",
      userId: "first-reader",
      createdAt: Date.now(),
    });
    actionMocks.authResumeIntentMatchesEmail.mockReturnValue(false);
    actionMocks.isUnlockRegistrationContext.mockReturnValue(false);
    const signUp = vi.fn().mockResolvedValue({
      data: { user: { id: "second-reader" }, session: null },
      error: null,
    });
    actionMocks.createClient.mockResolvedValue({ auth: { signUp } });

    await expectRedirect(
      registerDemoAction(
        registrationForm(
          "/en/products/another-product",
          "LOMI-BOOK-2026",
          "second-reader@example.com",
        ),
      ),
      "/en/login?error=verification_sent&returnTo=%2Fen%2Fproducts%2Fanother-product",
    );

    expect(actionMocks.buildSupabaseAuthCallbackUrl).toHaveBeenCalledWith(
      "en",
      "/en/products/another-product",
      expect.objectContaining({ code: "" }),
    );
    expect(actionMocks.setAuthResumeIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "",
        email: "second-reader@example.com",
      }),
    );
  });

  it("recovers a matching account's saved code when registration is retried", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
    });
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "reader-email-hash",
      userId: "reader-user",
      createdAt: Date.now(),
    });
    actionMocks.authResumeIntentMatchesEmail.mockReturnValue(true);
    const signUp = vi.fn().mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Signup temporarily unavailable." },
    });
    actionMocks.createClient.mockResolvedValue({ auth: { signUp } });

    await expectRedirect(
      registerDemoAction(
        registrationForm("/en/products/moon-garden-coloring-book"),
      ),
      "/en/register?error=auth&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book",
    );

    expect(actionMocks.setAuthResumeIntent).not.toHaveBeenCalled();
    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "reader@example.com",
        options: expect.objectContaining({
          emailRedirectTo: "https://app.example/auth/callback?locale=en&resume=opaque",
        }),
      }),
    );
    expect(actionMocks.buildSupabaseAuthCallbackUrl).toHaveBeenCalledWith(
      "en",
      "/en/products/moon-garden-coloring-book",
      expect.objectContaining({ code: "LOMI-BOOK-2026", userId: "reader-user" }),
    );
  });

  it("recovers a matching account's saved code after switching the product locale", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
    });
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "reader-email-hash",
      userId: "reader-user",
      createdAt: Date.now(),
    });
    actionMocks.authResumeIntentMatchesEmail.mockReturnValue(true);
    actionMocks.createClient.mockResolvedValue({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: { message: "Signup temporarily unavailable." },
        }),
      },
    });

    await expectRedirect(
      registerDemoAction(
        registrationForm(
          "/pl/products/moon-garden-coloring-book",
          undefined,
          "reader@example.com",
          "pl",
        ),
      ),
      "/pl/register?error=auth&returnTo=%2Fpl%2Fproducts%2Fmoon-garden-coloring-book",
    );

    expect(actionMocks.setAuthResumeIntent).not.toHaveBeenCalled();
    expect(actionMocks.buildSupabaseAuthCallbackUrl).toHaveBeenCalledWith(
      "pl",
      "/pl/products/moon-garden-coloring-book",
      expect.objectContaining({ code: "LOMI-BOOK-2026", userId: "reader-user" }),
    );
  });

  it("does not auto-copy an email-only code into a new registration", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
    });
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "reader-email-hash",
      createdAt: Date.now(),
    });
    actionMocks.authResumeIntentMatchesEmail.mockReturnValue(true);
    actionMocks.createClient.mockResolvedValue({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: "new-reader-user" }, session: null },
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

    expect(actionMocks.clearAuthResumeIntent).toHaveBeenCalledTimes(1);
    expect(actionMocks.buildSupabaseAuthCallbackUrl).toHaveBeenCalledWith(
      "en",
      "/en/products/moon-garden-coloring-book",
      expect.objectContaining({ code: "" }),
    );
    expect(actionMocks.buildSupabaseAuthCallbackUrl.mock.calls[0]?.[2]).not.toHaveProperty("userId");
    expect(actionMocks.setAuthResumeIntent).toHaveBeenCalledWith(
      expect.objectContaining({ code: "", userId: "new-reader-user" }),
    );
  });

  it("does not transfer a bound code when registration returns a different user ID", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
    });
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "reader-email-hash",
      userId: "original-reader",
      createdAt: Date.now(),
    });
    actionMocks.authResumeIntentMatchesEmail.mockReturnValue(true);
    actionMocks.createClient.mockResolvedValue({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: { id: "replacement-reader" }, session: null },
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

    expect(actionMocks.buildSupabaseAuthCallbackUrl).toHaveBeenCalledWith(
      "en",
      "/en/products/moon-garden-coloring-book",
      expect.objectContaining({ code: "LOMI-BOOK-2026", userId: "original-reader" }),
    );
    expect(actionMocks.setAuthResumeIntent).toHaveBeenCalledWith(
      expect.objectContaining({ code: "", userId: "replacement-reader" }),
    );
  });

  it("does not transfer another account's saved code after switching product locale", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
    });
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "first-reader-email-hash",
      userId: "first-reader",
      createdAt: Date.now(),
    });
    actionMocks.authResumeIntentMatchesEmail.mockReturnValue(false);
    actionMocks.createClient.mockResolvedValue({
      auth: {
        signUp: vi.fn().mockResolvedValue({
          data: { user: null, session: null },
          error: { message: "Signup temporarily unavailable." },
        }),
      },
    });

    await expectRedirect(
      registerDemoAction(
        registrationForm(
          "/pl/products/moon-garden-coloring-book",
          undefined,
          "second-reader@example.com",
          "pl",
        ),
      ),
      "/pl/register?error=auth&returnTo=%2Fpl%2Fproducts%2Fmoon-garden-coloring-book",
    );

    expect(actionMocks.setAuthResumeIntent).not.toHaveBeenCalled();
  });

  it("clears a pending account's stale unlock code when another registration omits the code", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
    });
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "first-reader-email-hash",
      userId: "first-reader",
      createdAt: Date.now(),
    });
    actionMocks.authResumeIntentMatchesEmail.mockReturnValue(false);
    actionMocks.getUnlockIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    });
    actionMocks.isUnlockRegistrationContext.mockReturnValue(false);
    const signUp = vi.fn().mockResolvedValue({
      data: { user: { id: "second-reader" }, session: null },
      error: null,
    });
    actionMocks.createClient.mockResolvedValue({ auth: { signUp } });

    await expectRedirect(
      registerDemoAction(
        registrationForm(
          "/en/products/moon-garden-coloring-book?source=retry",
          undefined,
          "second-reader@example.com",
        ),
      ),
      "/en/login?error=verification_sent&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book%3Fsource%3Dretry",
    );

    expect(actionMocks.clearUnlockIntent).toHaveBeenCalled();
    expect(actionMocks.setAuthResumeIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "",
        email: "second-reader@example.com",
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

    expect(actionMocks.setAuthResumeIntent).toHaveBeenCalledTimes(1);
    expect(actionMocks.setAuthResumeIntent).toHaveBeenCalledWith({
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
  it.each([
    ["throws", null, "/en/products/moon-garden-coloring-book?unlock=unexpected#premium"],
    ["returns invalid_code", "invalid_code", "/en/products/moon-garden-coloring-book?unlock=invalid_code#premium"],
    ["returns email_unverified", "email_unverified", "/en/products/moon-garden-coloring-book?step=verify#premium"],
    ["returns auth_required", "auth_required", "/en/login?returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book"],
  ] as const)(
    "keeps an authenticated account's %s retry out of the unbound cookie",
    async (_failureMode, status, location) => {
      actionMocks.getBackendMode.mockReturnValue("supabase");
      actionMocks.getProductBySlugForRequest.mockResolvedValue({
        id: "product-id",
        slug: "moon-garden-coloring-book",
        reviewDelayDays: 7,
      });
      actionMocks.getDemoSession.mockResolvedValue({
        email: "reader@example.com",
        userId: "reader-user",
        emailVerified: true,
        unlockedProductIds: [],
      });
      actionMocks.createClient.mockRejectedValue(
        new Error("the retry helper must reuse the validated session email"),
      );
      if (status === null) {
        actionMocks.redeemPremiumCodeForRequest.mockRejectedValue(
          new Error("temporary redemption failure"),
        );
      } else {
        actionMocks.redeemPremiumCodeForRequest.mockResolvedValue({
          ok: false,
          status,
        });
      }

      const formData = new FormData();
      formData.set("locale", "en");
      formData.set("productSlug", "moon-garden-coloring-book");
      formData.set("code", "LOMI-BOOK-2026");

      await expectRedirect(unlockPremiumAction(formData), location);

      expect(actionMocks.setAuthResumeIntent).toHaveBeenCalledWith({
        locale: "en",
        productSlug: "moon-garden-coloring-book",
        returnTo: "/en/products/moon-garden-coloring-book",
        code: "LOMI-BOOK-2026",
        userId: "reader-user",
        email: "reader@example.com",
      });
      expect(actionMocks.createClient).not.toHaveBeenCalled();
      expect(actionMocks.setUnlockIntent).toHaveBeenCalledWith({
        locale: "en",
        productSlug: "moon-garden-coloring-book",
        returnTo: "/en/products/moon-garden-coloring-book",
      });
      expect(actionMocks.clearUnlockIntent).toHaveBeenCalledTimes(1);
      expect(actionMocks.redirect.mock.calls.flat().join(" ")).not.toContain(
        "LOMI-BOOK-2026",
      );
    },
  );

  it("does not retain an unverified Supabase user's code in the guest cookie", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
    });
    actionMocks.getDemoSession.mockResolvedValue({
      email: "reader@example.com",
      userId: "reader-user",
      emailVerified: false,
      unlockedProductIds: [],
    });
    actionMocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "reader-user", email: "reader@example.com" } },
          error: null,
        }),
      },
    });

    const formData = new FormData();
    formData.set("locale", "en");
    formData.set("productSlug", "moon-garden-coloring-book");
    formData.set("code", "LOMI-BOOK-2026");

    await expectRedirect(
      unlockPremiumAction(formData),
      "/en/products/moon-garden-coloring-book?step=verify#premium",
    );

    expect(actionMocks.setAuthResumeIntent).toHaveBeenCalledWith({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      userId: "reader-user",
      email: "reader@example.com",
    });
    expect(actionMocks.setUnlockIntent).toHaveBeenCalledWith({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
    });
  });

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

  it("does not redeem a stale account-bound code for a different signed-in user", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
      reviewDelayDays: 7,
    });
    actionMocks.getDemoSession.mockResolvedValue({
      email: "reader@example.com",
      userId: "account-b",
      emailVerified: true,
      unlockedProductIds: [],
    });
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "reader-email-hash",
      userId: "account-a",
      createdAt: Date.now(),
    });
    actionMocks.authResumeIntentMatchesUser.mockReturnValue(false);

    const formData = new FormData();
    formData.set("locale", "en");
    formData.set("productSlug", "moon-garden-coloring-book");
    formData.set("code", "LOMI-BOOK-2026");

    await expectRedirect(
      unlockPremiumAction(formData),
      "/en/login?error=verification_mismatch&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book",
    );

    expect(actionMocks.redeemPremiumCodeForRequest).not.toHaveBeenCalled();
    expect(actionMocks.clearAuthResumeIntent).toHaveBeenCalledTimes(1);
    expect(actionMocks.clearUnlockIntent).toHaveBeenCalledTimes(1);
  });

  it("does not rebind a stale account-bound code to a different unverified user", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
      reviewDelayDays: 7,
    });
    actionMocks.getDemoSession.mockResolvedValue({
      email: "account-b@example.com",
      userId: "account-b",
      emailVerified: false,
      unlockedProductIds: [],
    });
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "account-a-email-hash",
      userId: "account-a",
      createdAt: Date.now(),
    });
    actionMocks.authResumeIntentMatchesUser.mockReturnValue(false);

    const formData = new FormData();
    formData.set("locale", "en");
    formData.set("productSlug", "moon-garden-coloring-book");
    formData.set("code", "LOMI-BOOK-2026");

    await expectRedirect(
      unlockPremiumAction(formData),
      "/en/login?error=verification_mismatch&returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book",
    );

    expect(actionMocks.setAuthResumeIntent).not.toHaveBeenCalled();
    expect(actionMocks.redeemPremiumCodeForRequest).not.toHaveBeenCalled();
    expect(actionMocks.clearAuthResumeIntent).toHaveBeenCalledTimes(1);
    expect(actionMocks.clearUnlockIntent).toHaveBeenCalledTimes(1);
  });

  it("does not rebind a stale account-bound code when redemption targets another product", async () => {
    actionMocks.getBackendMode.mockReturnValue("supabase");
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "other-product-id",
      slug: "another-product",
      reviewDelayDays: 7,
    });
    actionMocks.getDemoSession.mockResolvedValue({
      email: "account-b@example.com",
      userId: "account-b",
      emailVerified: true,
      unlockedProductIds: [],
    });
    actionMocks.readAuthResumeIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      emailHash: "account-a-email-hash",
      userId: "account-a",
      createdAt: Date.now(),
    });
    actionMocks.authResumeIntentMatchesUser.mockReturnValue(false);

    const formData = new FormData();
    formData.set("locale", "en");
    formData.set("productSlug", "another-product");
    formData.set("code", "LOMI-BOOK-2026");

    await expectRedirect(
      unlockPremiumAction(formData),
      "/en/login?error=verification_mismatch&returnTo=%2Fen%2Fproducts%2Fanother-product",
    );

    expect(actionMocks.redeemPremiumCodeForRequest).not.toHaveBeenCalled();
    expect(actionMocks.clearAuthResumeIntent).toHaveBeenCalledTimes(1);
    expect(actionMocks.clearUnlockIntent).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["matching account and product", "moon-garden-coloring-book", true, true],
    ["different product", "another-product", true, false],
  ] as const)(
    "clears a saved retry intent after success only for the %s",
    async (_caseName, intentProductSlug, matchesAccount, shouldClear) => {
      actionMocks.getBackendMode.mockReturnValue("supabase");
      actionMocks.getProductBySlugForRequest.mockResolvedValue({
        id: "product-id",
        slug: "moon-garden-coloring-book",
        reviewDelayDays: 7,
      });
      actionMocks.getDemoSession.mockResolvedValue({
        email: "reader@example.com",
        userId: "reader-user",
        emailVerified: true,
        unlockedProductIds: [],
      });
      actionMocks.readAuthResumeIntent.mockResolvedValue({
        locale: "en",
        productSlug: intentProductSlug,
        returnTo: `/en/products/${intentProductSlug}`,
        code: "LOMI-BOOK-2026",
        emailHash: "reader-email-hash",
        userId: "reader-user",
        createdAt: Date.now(),
      });
      actionMocks.authResumeIntentMatchesEmail.mockReturnValue(matchesAccount);
      actionMocks.authResumeIntentMatchesUser.mockReturnValue(matchesAccount);
      actionMocks.redeemPremiumCodeForRequest.mockResolvedValue({
        ok: true,
        status: "success",
      });

      const formData = new FormData();
      formData.set("locale", "pl");
      formData.set("productSlug", "moon-garden-coloring-book");
      formData.set("code", "LOMI-BOOK-2026");

      await expectRedirect(
        unlockPremiumAction(formData),
        "/pl/products/moon-garden-coloring-book?unlocked=1#premium",
      );

      if (shouldClear) {
        expect(actionMocks.clearAuthResumeIntent).toHaveBeenCalledTimes(1);
      } else {
        expect(actionMocks.clearAuthResumeIntent).not.toHaveBeenCalled();
      }
    },
  );
});
