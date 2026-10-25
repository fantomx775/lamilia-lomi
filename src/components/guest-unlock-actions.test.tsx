/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import englishMessages from "../../messages/en.json";

vi.mock("@/app/actions", () => ({
  startUnlockAuthAction: vi.fn(),
}));

import { GuestUnlockActions } from "@/components/guest-unlock-actions";

afterEach(cleanup);

describe("GuestUnlockActions", () => {
  it("uses a neutral public hint while preserving a QR/deep-link code prefill", () => {
    const hint = englishMessages.Funnel.codePlaceholder;
    expect(hint).toBe("Enter the code from your book");
    expect(hint).not.toMatch(/LOMI-BOOK-2026|demo|example/i);

    render(
      <GuestUnlockActions
        locale="en"
        productSlug="moon-garden-coloring-book"
        initialCode="REAL-BOOK-CODE"
        copy={{
          codeLabel: englishMessages.Funnel.codeLabel,
          codePlaceholder: hint,
          login: englishMessages.Funnel.login,
          register: englishMessages.Funnel.register,
          pending: englishMessages.Funnel.pending,
        }}
      />,
    );

    const codeInput = screen.getByRole("textbox", { name: "Premium code" });
    expect(codeInput).toHaveAttribute("placeholder", hint);
    expect(codeInput).toHaveValue("REAL-BOOK-CODE");
  });
});
