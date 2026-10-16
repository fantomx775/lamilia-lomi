/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/en/products" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));
vi.mock("@/components/navigation-link", () => ({
  NavigationLink: (props: AnchorHTMLAttributes<HTMLAnchorElement> & { pendingLabel: string; showPendingBar?: boolean }) => {
    const { children, onClick, pendingLabel, showPendingBar, ...anchorProps } = props;
    void pendingLabel;
    void showPendingBar;
    return <a {...anchorProps} onClick={(event) => { event.preventDefault(); onClick?.(event); }}>{children}</a>;
  },
}));

import { MobileNavigation } from "@/components/mobile-navigation";

afterEach(() => {
  cleanup();
  mocks.pathname = "/en/products";
});

describe("MobileNavigation", () => {
  it("opens the menu, exposes guest destinations and closes after navigation", () => {
    render(
      <MobileNavigation locale="en">
        <span>Guest account actions</span>
      </MobileNavigation>,
    );

    const openButton = screen.getByRole("button", { name: "Open navigation menu" });
    expect(openButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(openButton);

    expect(screen.getByRole("navigation", { name: "Mobile primary navigation" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Catalog" })).toHaveAttribute("href", "/en/products");
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/en/about");
    expect(screen.getByRole("link", { name: "My Library" })).toHaveAttribute("href", "/en/library");
    expect(screen.getByText("Guest account actions")).toBeVisible();

    fireEvent.click(screen.getByRole("link", { name: "Catalog" }));
    expect(document.getElementById("mobile-primary-navigation")).toHaveAttribute("hidden");
  });

  it("dismisses on Escape and restores focus to the hamburger", () => {
    render(<MobileNavigation locale="en"><span>Guest account actions</span></MobileNavigation>);
    const openButton = screen.getByRole("button", { name: "Open navigation menu" });

    fireEvent.click(openButton);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByRole("button", { name: "Open navigation menu" })).toHaveFocus();
    expect(document.getElementById("mobile-primary-navigation")).toHaveAttribute("hidden");
  });

  it("dismisses on outside pointer input and route changes", async () => {
    const view = render(<MobileNavigation locale="en"><span>Guest account actions</span></MobileNavigation>);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    fireEvent.pointerDown(document.body);
    expect(document.getElementById("mobile-primary-navigation")).toHaveAttribute("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    mocks.pathname = "/en/about";
    await act(async () => view.rerender(<MobileNavigation locale="en"><span>Guest account actions</span></MobileNavigation>));

    await waitFor(() => expect(document.getElementById("mobile-primary-navigation")).toHaveAttribute("hidden"));
  });
});
