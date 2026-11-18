/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MobileNavigation } from "./mobile-navigation";
import { CommunityRouteNavigationProvider, CommunityRoutePendingRegion } from "@/components/community/community-route-transition";

const mocks = vi.hoisted(() => ({ push: vi.fn(), prefetch: vi.fn(), pathname: "/en/products" }));
vi.mock("next/link", () => ({
  default: ({ children, onNavigate, ...props }: import("react").AnchorHTMLAttributes<HTMLAnchorElement> & { onNavigate?: (event: { preventDefault: () => void }) => void }) => (
    <a {...props} onClick={(event) => { event.preventDefault(); onNavigate?.({ preventDefault() {} }); }}>{children}</a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => mocks,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, "");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.push.mockReset(); mocks.prefetch.mockClear(); mocks.pathname = "/en/products";
});

function setup() {
  history.replaceState(null, "", "/en/products");
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); } });
  vi.stubGlobal("matchMedia", () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
}

describe("MobileNavigation", () => {
  for (const withHistoryEntry of [true, false]) for (const reversed of [false, true]) it(`dispatches Club once after ${withHistoryEntry ? "menu history Back" : "direct exit"}, listeners ${reversed ? "reversed" : "registered"}`, async () => {
    vi.useFakeTimers(); setup();
    vi.spyOn(history, "back").mockImplementation(() => {});
    const listeners: Array<EventListenerOrEventListenerObject> = [];
    const add = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
      if (type === "popstate") listeners.push(listener);
      else add(type, listener, options);
    });
    const pop = () => act(() => {
      for (const listener of reversed ? [...listeners].reverse() : listeners) {
        const event = new PopStateEvent("popstate");
        if (typeof listener === "function") listener.call(window, event); else listener.handleEvent(event);
      }
    });
    let resolve!: () => void;
    mocks.push.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    render(<CommunityRouteNavigationProvider><MobileNavigation locale="en" communityEnabled /><CommunityRoutePendingRegion><h1>Original page</h1></CommunityRoutePendingRegion></CommunityRouteNavigationProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    if (!withHistoryEntry) history.replaceState(null, "");
    fireEvent.click(screen.getByRole("link", { name: "Coloring Club" }));
    expect(mocks.push).not.toHaveBeenCalled();
    if (withHistoryEntry) { history.replaceState(null, ""); pop(); }
    act(() => vi.advanceTimersByTime(280));
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/en/club");
    expect(screen.getByTestId("community-gallery-loading")).toBeVisible();
    expect(screen.getByTestId("mobile-navigation-pending")).toHaveTextContent("Opening Coloring Club");
    await act(async () => resolve());
    expect(screen.getByRole("heading", { name: "Original page" })).toBeVisible();
  });

  it("does not dispatch a deferred menu destination after a second external Back", () => {
    vi.useFakeTimers(); setup();
    vi.spyOn(history, "back").mockImplementation(() => {});
    render(<CommunityRouteNavigationProvider><MobileNavigation locale="en" communityEnabled /></CommunityRouteNavigationProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    fireEvent.click(screen.getByRole("link", { name: "Coloring Club" }));
    history.replaceState(null, ""); fireEvent.popState(window);
    history.replaceState(null, "", "/en/about"); fireEvent.popState(window);
    act(() => vi.advanceTimersByTime(280));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mobile-navigation-pending")).toBeNull();
  });

  it("keeps the accepted newer menu destination and feedback if an older route commits during exit", () => {
    vi.useFakeTimers(); setup();
    vi.spyOn(history, "back").mockImplementation(() => {});
    const app = () => <CommunityRouteNavigationProvider><MobileNavigation locale="en" communityEnabled /></CommunityRouteNavigationProvider>;
    const view = render(app());
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    fireEvent.click(screen.getByRole("link", { name: "Coloring Club" }));
    history.replaceState(null, ""); fireEvent.popState(window);
    mocks.pathname = "/en/about"; history.replaceState(null, "", "/en/about");
    view.rerender(app());
    act(() => vi.advanceTimersByTime(280));
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/en/club");
    expect(screen.getByTestId("mobile-navigation-pending")).toHaveTextContent("Opening Coloring Club");
  });

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
  it("confirms the selected destination before exit and keeps feedback until its route commits", () => {
    vi.useFakeTimers(); setup();
    vi.spyOn(history, "back").mockImplementation(() => {});
    const view = render(<MobileNavigation locale="en" communityEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const about = screen.getByRole("link", { name: "About" });
    fireEvent.click(about);
    expect(about).toHaveAttribute("aria-busy", "true");
    expect(mocks.prefetch).toHaveBeenCalledExactlyOnceWith("/en/about");
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "My Library" }));
    expect(mocks.prefetch).toHaveBeenCalledTimes(1);
    history.replaceState(null, ""); fireEvent.popState(window);
    act(() => vi.advanceTimersByTime(280));
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/en/about");
    expect(screen.getByTestId("mobile-navigation-pending")).toHaveTextContent("Opening About");
    mocks.pathname = "/en/about";
    view.rerender(<MobileNavigation locale="en" communityEnabled />);
    expect(screen.queryByTestId("mobile-navigation-pending")).toBeNull();
    act(() => vi.advanceTimersByTime(0));
    mocks.pathname = "/en/products";
    view.rerender(<MobileNavigation locale="en" communityEnabled />);
    expect(screen.queryByTestId("mobile-navigation-pending")).toBeNull();
  });

  it("Forward during exit cancels navigation, selection and pending feedback", () => {
    vi.useFakeTimers(); setup();
    vi.spyOn(history, "back").mockImplementation(() => {});
    render(<MobileNavigation locale="en" communityEnabled />);
    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    vi.spyOn(trigger, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("link", { name: "About" }));
    history.replaceState(null, ""); fireEvent.popState(window);
    history.replaceState({ lamiliaMobileNavigation: true }, ""); fireEvent.popState(window);
    act(() => vi.advanceTimersByTime(300));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    expect(screen.getByRole("link", { name: "About" })).not.toHaveAttribute("aria-busy");
  });

  it("closes the current route without a duplicate navigation or indefinite pending state", () => {
    vi.useFakeTimers(); setup();
    vi.spyOn(history, "back").mockImplementation(() => {});
    render(<MobileNavigation locale="en" communityEnabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    fireEvent.click(screen.getByRole("link", { name: "Catalog" }));
    history.replaceState(null, ""); fireEvent.popState(window);
    act(() => vi.advanceTimersByTime(280));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.prefetch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mobile-navigation-pending")).toBeNull();
    expect(screen.getByRole("button", { name: "Open navigation menu" })).toHaveFocus();
  });

});
