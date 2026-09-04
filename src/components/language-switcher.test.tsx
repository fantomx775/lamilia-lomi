/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/pl/library",
  useSearchParams: () => new URLSearchParams("filter=recent"),
}));

vi.mock("@/app/actions", () => ({
  switchLocaleAction: vi.fn(),
}));

import { LanguageSwitcher } from "./language-switcher";

afterEach(() => {
  cleanup();
});

describe("LanguageSwitcher", () => {
  it("visually marks the currently selected language in desktop and mobile controls", () => {
    const view = render(<LanguageSwitcher locale="pl" />);

    const selectedButtons = view.getAllByRole("button", { name: "Polski (PL)" });
    expect(selectedButtons).toHaveLength(2);
    for (const button of selectedButtons) {
      expect(button).toHaveClass("bg-[var(--color-sage)]", "font-semibold");
      expect(button).toHaveAttribute("aria-current", "page");
      expect(button).toHaveAttribute("data-active", "true");
    }

    const inactiveButtons = view.getAllByRole("button", { name: "English (EN)" });
    expect(inactiveButtons).toHaveLength(2);
    for (const button of inactiveButtons) {
      expect(button).not.toHaveClass("bg-[var(--color-sage)]");
      expect(button).not.toHaveAttribute("aria-current");
      expect(button).toHaveAttribute("data-active", "false");
    }
  });
});
