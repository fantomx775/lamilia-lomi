/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MobileNavigation } from "./mobile-navigation";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/en/products",
  useRouter: () => ({ push: mocks.push }),
}));

afterEach(() => {
  cleanup();
  history.replaceState(null, "");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  vi.stubGlobal("matchMedia", () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
}

describe("MobileNavigation", () => {
  it("exposes guest destinations and hides account-only links", () => {
    setup();
    render(<MobileNavigation locale="en" communityEnabled={false} />);
    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Mobile primary navigation" })).toBeVisible();
    for (const name of ["Catalog", "About", "My Library", "Log in", "Sign up"]) {
      expect(screen.getByRole("link", { name })).toBeVisible();
    }
    for (const name of ["Coloring Club", "My Creations", "Account"]) {
      expect(screen.queryByRole("link", { name })).toBeNull();
    }
  });

  it("exposes feature and account links for an eligible member", () => {
    setup();
    render(<MobileNavigation locale="en" communityEnabled accountHref="/en/account" showCreations
      logout={<button type="submit">Log out</button>} />);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(screen.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "Catalog", "Coloring Club", "About", "My Library", "My Creations", "Account",
    ]);
    expect(screen.getByRole("button", { name: "Log out" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Log in" })).toBeNull();
  });
});
