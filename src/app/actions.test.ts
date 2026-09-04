import { beforeEach, describe, expect, it, vi } from "vitest";

const actionMocks = vi.hoisted(() => ({
  buildAuthRedirect: vi.fn(),
  clearAuthResumeIntent: vi.fn(),
  clearDemoSession: vi.fn(),
  clearUnlockIntent: vi.fn(),
  createAuthResumeIntent: vi.fn(),
  createClient: vi.fn(),
  createDemoSession: vi.fn(),
  getBackendMode: vi.fn(),
  getDemoSession: vi.fn(),
  getProductBySlugForRequest: vi.fn(),
  getUnlockIntent: vi.fn(),
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
  buildSupabaseAuthCallbackUrl: vi.fn(() => "https://app.example/auth/callback?locale=en"),
  createAuthResumeIntent: actionMocks.createAuthResumeIntent,
  clearAuthResumeIntent: actionMocks.clearAuthResumeIntent,
  redeemAuthResumeIntent: actionMocks.redeemAuthResumeIntent,
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

import { registerDemoAction } from "./actions";

beforeEach(() => {
  actionMocks.getBackendMode.mockReturnValue("local");
  actionMocks.getProductBySlugForRequest.mockResolvedValue(null);
  actionMocks.getUnlockIntent.mockResolvedValue(null);
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
  actionMocks.buildAuthRedirect.mockImplementation(({ locale, redirectTo }) =>
    redirectTo ?? `/${locale}/account`,
  );
  actionMocks.createAuthResumeIntent.mockImplementation(({ locale, returnTo, code }) => ({
    locale: locale ?? "en",
    returnTo: returnTo ?? "/en/account",
    code,
  }));
  actionMocks.redirect.mockImplementation((location: string) => {
    const error = new Error(`REDIRECT:${location}`) as Error & { location: string };
    error.location = location;
    throw error;
  });
  vi.clearAllMocks();
});

function registrationForm(returnTo?: string) {
  const formData = new FormData();
  formData.set("locale", "en");
  formData.set("email", "reader@example.com");
  formData.set("password", "password123");
  formData.set("termsAccepted", "on");

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

  it("keeps an unlock registration on the product resume path", async () => {
    actionMocks.getProductBySlugForRequest.mockResolvedValue({
      id: "product-id",
      slug: "moon-garden-coloring-book",
    });

    await expectRedirect(
      registerDemoAction(
        registrationForm("/en/products/moon-garden-coloring-book"),
      ),
      "/en/products/moon-garden-coloring-book",
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
        signUp: vi.fn().mockResolvedValue({ error: null }),
      },
    });

    await expectRedirect(registerDemoAction(registrationForm()), "/en/login?error=verification_sent&returnTo=%2Fen%2Faccount");

    expect(actionMocks.setAuthResumeIntent).toHaveBeenCalledWith({
      locale: "en",
      returnTo: "/en/account",
      code: "",
    });
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
        signUp: vi.fn().mockResolvedValue({ error: null }),
      },
    });

    await expectRedirect(
      registerDemoAction(
        registrationForm("/en/products/moon-garden-coloring-book"),
      ),
      "/en/products/moon-garden-coloring-book?step=verify",
    );
  });
});
