/** @vitest-environment jsdom */

import { createElement, type ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pageMocks = vi.hoisted(() => ({
  getUnlockIntent: vi.fn(),
}));

vi.mock("@/app/actions", () => ({
  registerDemoAction: vi.fn(),
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
      registerTitle: "Create account",
      registerDescription: "Create an account to continue.",
      email: "Email",
      password: "Password",
      terms: "I accept the Terms and Privacy Policy.",
      marketing: "I agree to receive product updates and bonus news.",
      createAccountButton: "Create account",
      registerPending: "Creating account…",
      invalid: "Invalid",
      termsLink: "Terms",
      privacyLink: "Privacy Policy",
    })[key],
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) =>
    createElement("a", { ...props, href }, children),
}));

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`REDIRECT:${target}`);
  },
}));

import RegisterPage from "./page";

afterEach(() => cleanup());

describe("Register page", () => {
  beforeEach(() => {
    pageMocks.getUnlockIntent.mockResolvedValue(null);
  });

  it("renders the form for a generic registration", async () => {
    const view = render(
      await RegisterPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(view.getByRole("heading", { name: "Create account" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Create account" })).toBeInTheDocument();
    expect(view.container.querySelector("form")).toBeInTheDocument();
  });

  it("keeps the unlock product and code in the server-side form contract", async () => {
    pageMocks.getUnlockIntent.mockResolvedValue({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      createdAt: Date.now(),
    });

    const view = render(
      await RegisterPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({
          returnTo: "/en/products/moon-garden-coloring-book?code=LOMI-BOOK-2026",
        }),
      }),
    );

    expect(view.container.querySelector<HTMLInputElement>('input[name="returnTo"]')).toHaveValue(
      "/en/products/moon-garden-coloring-book",
    );
    expect(view.container.querySelector<HTMLInputElement>('input[name="code"]')).toHaveValue(
      "LOMI-BOOK-2026",
    );
  });

  it("renders a neutral destination for an unsafe return target", async () => {
    const view = render(
      await RegisterPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({ returnTo: "https://evil.example/phish" }),
      }),
    );

    expect(view.container.querySelector<HTMLInputElement>('input[name="returnTo"]')).toHaveValue(
      "/en/account",
    );
  });
});
