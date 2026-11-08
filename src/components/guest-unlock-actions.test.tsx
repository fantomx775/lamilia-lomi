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
  it("preserves a QR/deep-link code prefill without placeholder text", () => {
    render(
      <GuestUnlockActions
        locale="en"
        productSlug="moon-garden-coloring-book"
        initialCode="REAL-BOOK-CODE"
        copy={{
          codeLabel: englishMessages.Funnel.codeLabel,
          login: englishMessages.Funnel.login,
          register: englishMessages.Funnel.register,
          pending: englishMessages.Funnel.pending,
        }}
      />,
    );

    const codeInput = screen.getByRole("textbox", { name: "Premium code" });
    expect(codeInput).not.toHaveAttribute("placeholder");
    expect(codeInput).toHaveValue("REAL-BOOK-CODE");
  });
});
