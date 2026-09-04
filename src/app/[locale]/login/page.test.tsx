/** @vitest-environment jsdom */

import { createElement, type ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pageMocks = vi.hoisted(() => ({
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
});
