/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MobileNavigation } from "./mobile-navigation";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/en/products",
  useRouter: () => ({ push: mocks.push }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, "");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); } });
  vi.stubGlobal("matchMedia", () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
}

describe("MobileNavigation", () => {
  it("finishes closing if the browser does not deliver animationend", () => {
    vi.useFakeTimers();
    setup();
    render(<MobileNavigation locale="en" communityEnabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const dialog = screen.getByRole("dialog");
    history.replaceState(null, "");
    fireEvent.popState(window);
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveAttribute("data-closing", "true");
    vi.advanceTimersByTime(280);
    expect(dialog).not.toHaveAttribute("open");
  });

  it("cancels a deferred logout when Forward cancels the exit", () => {
    vi.useFakeTimers();
    setup();
    vi.spyOn(history, "back").mockImplementation(() => {});
    const submit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});
    render(<MobileNavigation locale="en" communityEnabled={false} logout={<form><button type="submit">Log out</button></form>} />);
    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    vi.spyOn(trigger, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    fireEvent.submit(screen.getByRole("button", { name: "Log out" }).closest("form")!);
    history.replaceState(null, "");
    fireEvent.popState(window);
    expect(dialog).toHaveAttribute("data-closing", "true");
    history.replaceState({ lamiliaMobileNavigation: true }, "");
    fireEvent.popState(window);
    expect(dialog).not.toHaveAttribute("data-closing");
    act(() => vi.advanceTimersByTime(300));
    expect(dialog).toHaveAttribute("open");
    history.replaceState(null, "");
    fireEvent.popState(window);
    act(() => vi.advanceTimersByTime(300));
    expect(dialog).not.toHaveAttribute("open");
    expect(submit).not.toHaveBeenCalled();
  });

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
