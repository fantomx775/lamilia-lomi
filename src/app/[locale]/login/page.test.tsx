/** @vitest-environment jsdom */

import { createElement, type ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pageMocks = vi.hoisted(() => ({
  getBackendMode: vi.fn(),
  getUnlockIntent: vi.fn(),
}));

vi.mock("@/app/actions", () => ({
  loginDemoAction: vi.fn(),
  resendSupabaseVerificationEmailAction: vi.fn(),
}));

vi.mock("@/components/submit-button", () => ({
  SubmitButton: ({ children, pendingLabel, ...props }: { children: ReactNode; pendingLabel: string; [key: string]: unknown }) => {
    void pendingLabel;
    return createElement("button", { ...props, type: "submit" }, children);
  },
}));

vi.mock("@/lib/unlock-intent", () => ({
  getUnlockIntent: pageMocks.getUnlockIntent,
}));

vi.mock("@/lib/config", () => ({
  getBackendMode: pageMocks.getBackendMode,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) =>
    ({
      loginTitle: "Log in",
      loginDescription: "Log in to continue to your account or return to the product you started.",
      email: "Email",
      password: "Password",
      continue: "Continue",
      pending: "Signing in…",
      reset: "Reset password",
      noAccount: "Don't have an account?",
      createAccount: "Create account",
      emailNotConfirmed: "Email not verified",
      verificationSent: "Verification sent",
      verificationRequired: "Enter the email address that received the verification link, then request a new one.",
      demoVerification: "Demo mode does not send verification emails. Use the demo login above to continue.",
      invalid: "Invalid",
      resendVerification: "Send verification email again",
    })[key],
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) =>
    createElement("a", { ...props, href }, children),
}));

import LoginPage from "./page";

afterEach(() => cleanup());

describe("Login page registration CTA", () => {
  beforeEach(() => {
    pageMocks.getUnlockIntent.mockResolvedValue(null);
    pageMocks.getBackendMode.mockReturnValue("supabase");
  });

  it("shows a generic create-account link without inventing a return target", async () => {
    const view = render(
      await LoginPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(view.getByRole("link", { name: "Create account" })).toHaveAttribute(
      "href",
      "/en/register",
    );
  });

  it("preserves an unlock return path without exposing its premium code", async () => {
    const view = render(
      await LoginPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({
          returnTo: "/en/products/moon-garden-coloring-book?code=LOMI-BOOK-2026",
        }),
      }),
    );

    const href = view.getByRole("link", { name: "Create account" }).getAttribute("href");

    expect(href).toBe(
      "/en/register?returnTo=%2Fen%2Fproducts%2Fmoon-garden-coloring-book",
    );
    expect(href).not.toContain("LOMI-BOOK-2026");
  });

  it("does not reuse an unlock code from another locale", async () => {
    pageMocks.getUnlockIntent.mockResolvedValue({
      locale: "pl",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/pl/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      createdAt: Date.now(),
    });

    const view = render(
      await LoginPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({
          returnTo: "/en/products/moon-garden-coloring-book",
        }),
      }),
    );

    expect(view.container.querySelector<HTMLInputElement>('input[name="code"]')).toHaveValue("");
  });

  it("shows demo verification guidance without a non-functional resend form", async () => {
    pageMocks.getBackendMode.mockReturnValue("local");

    const view = render(
      await LoginPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({
          error: "verification_required",
          returnTo: "/en/products/moon-garden-coloring-book",
        }),
      }),
    );

    expect(view.getByRole("alert")).toHaveTextContent(
      "Demo mode does not send verification emails. Use the demo login above to continue.",
    );
    expect(view.container.querySelector("#verification-email")).toBeNull();
    expect(view.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });
});
