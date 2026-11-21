/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityRouteNavigationProvider, CommunityRoutePendingRegion, communityRouteTarget, useCommunityRouteNavigation } from "./community-route-transition";
import { NavigationLink } from "@/components/navigation-link";
import { LinkPendingIndicator } from "@/components/link-pending-indicator";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ onNavigate, children, replace: _replace, scroll: _scroll, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { onNavigate?: (event: { preventDefault(): void }) => void; replace?: boolean; scroll?: boolean }) => {
    void _replace; void _scroll;
    return <a {...props} onClick={(event) => {
    const modified = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || props.target === "_blank";
    event.preventDefault(); // jsdom has no native document navigation.
    if (!modified) onNavigate?.({ preventDefault() {} });
  }}>{children}</a>; },
}));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function Controls() {
  const navigation = useCommunityRouteNavigation()!;
  return <>
    <button onClick={navigation.menuOpened}>Record opened menu</button>
    <NavigationLink href="/en/club" pendingLabel="Opening Club">Club<LinkPendingIndicator label="Card pending" /></NavigationLink>
    <NavigationLink href="/en/club/creators/artist" pendingLabel="Opening creator">Creator</NavigationLink>
  </>;
}
function App({ children = <Controls /> }: { children?: ReactNode }) {
  return <CommunityRouteNavigationProvider>{children}<CommunityRoutePendingRegion><h1>Actual server content</h1><input aria-label="Gallery draft" defaultValue="Initial" /></CommunityRoutePendingRegion></CommunityRouteNavigationProvider>;
}
beforeEach(() => { history.replaceState(null, "", "/en/about"); router.push.mockReset(); router.replace.mockReset(); });
afterEach(cleanup);

describe("public Club transition", () => {
  it("renders the actual document without a server Suspense fallback", () => {
    const html = renderToString(<App />);
    expect(html).toContain("Actual server content");
    expect(html).not.toContain("community-gallery-loading");
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelector("h1")?.closest("[hidden]")).toBeNull();
  });
  it("accepts only same-origin existing public route shapes, preserving query/hash", () => {
    const origin = location.origin;
    expect(communityRouteTarget(`${origin}/en/club/artworks/owned?q=1#image`, origin)).toEqual({ href: "/en/club/artworks/owned?q=1#image", variant: "artwork" });
    for (const href of ["//elsewhere/en/club", "https://elsewhere/en/club", "javascript:alert(1)", "/pl/club", "/en/club/moderation", "/en/club/artworks/one/two", "/en/library"]) expect(communityRouteTarget(href, origin)).toBeNull();
  });
  it("shows genuine transition pending and scopes both inline and card feedback without native Link status", async () => {
    const read = deferred(); router.push.mockReturnValue(read.promise);
    render(<App />);
    fireEvent.click(screen.getByRole("link", { name: "Club" }));
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/en/club");
    expect(screen.getByTestId("community-gallery-loading")).toBeVisible();
    expect(screen.getByTestId("product-card-pending")).toHaveAttribute("data-pending", "true");
    expect(screen.getAllByTestId("navigation-link-pending")[0]).toHaveAttribute("data-pending", "true");
    await act(async () => read.resolve());
    expect(screen.getByRole("heading", { name: "Actual server content" })).toBeVisible();
    expect(screen.queryByTestId("community-gallery-loading")).toBeNull();
  });
  it("honors a consumer cancellation and leaves its own imperative navigation single", () => {
    render(<App><NavigationLink href="/en/club" pendingLabel="Opening" onNavigate={(event) => { event.preventDefault(); router.push("/en/club"); }}>Owned navigation</NavigationLink></App>);
    fireEvent.click(screen.getByRole("link"));
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/en/club");
    expect(screen.queryByTestId("community-gallery-loading")).toBeNull();
  });
  it("retains the mounted source draft when Back abandons a pending navigation", async () => {
    const read = deferred(); router.push.mockReturnValue(read.promise);
    render(<App />);
    const draft = screen.getByRole("textbox", { name: "Gallery draft" });
    fireEvent.change(draft, { target: { value: "Newest unsent draft" } });
    fireEvent.click(screen.getByRole("link", { name: "Club" }));
    expect(draft).not.toBeVisible();
    history.replaceState(null, "", "/en/products"); fireEvent.popState(window);
    expect(screen.getByRole("textbox", { name: "Gallery draft" })).toBe(draft);
    expect(draft).toBeVisible(); expect(draft).toHaveValue("Newest unsent draft");
    await act(async () => read.resolve());
    expect(draft).toHaveValue("Newest unsent draft");
  });
  it("preserves replace/scroll and modifier/new-tab behavior", async () => {
    const read = deferred(); router.replace.mockReturnValue(read.promise);
    render(<App><NavigationLink href="/en/club" replace scroll={false} pendingLabel="Opening">Club</NavigationLink><NavigationLink href="/en/club" target="_blank" pendingLabel="Opening">New tab</NavigationLink></App>);
    fireEvent.click(screen.getByRole("link", { name: "Club" }), { ctrlKey: true });
    fireEvent.click(screen.getByRole("link", { name: "New tab" }));
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "Club" }));
    expect(router.replace).toHaveBeenCalledExactlyOnceWith("/en/club", { scroll: false });
    await act(async () => read.resolve());
  });
  it("keeps the latest target across older completion and cancels abandoned UI on real history navigation", async () => {
    const first = deferred(); const latest = deferred();
    router.push.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise);
    render(<App />);
    fireEvent.click(screen.getByRole("link", { name: "Club" }));
    fireEvent.click(screen.getByRole("link", { name: "Creator" }));
    expect(screen.getByTestId("community-creator-loading")).toBeVisible();
    await act(async () => first.resolve());
    expect(screen.getByTestId("community-creator-loading")).toBeVisible();
    history.replaceState(null, "", "/en/products"); fireEvent.popState(window);
    expect(screen.queryByTestId("community-creator-loading")).toBeNull();
    await act(async () => latest.resolve());
    expect(screen.getByRole("heading")).toBeVisible();
    expect(screen.queryByTestId("community-creator-loading")).toBeNull();
  });
  it("does not mistake consumption of the synthetic same-URL menu entry for an abandoned transition", async () => {
    const read = deferred(); router.push.mockReturnValue(read.promise);
    render(<App />);
    fireEvent.click(screen.getByRole("link", { name: "Club" }));
    history.pushState({ lamiliaMobileNavigation: true }, "");
    fireEvent.click(screen.getByRole("button", { name: "Record opened menu" }));
    const replace = vi.spyOn(history, "replaceState");
    history.replaceState(null, ""); fireEvent.popState(window);
    expect(screen.getByTestId("community-gallery-loading")).toBeVisible();
    expect(replace).toHaveBeenCalledTimes(1); // Only the test simulates history; provider never mutates it.
    history.replaceState({ lamiliaMobileNavigation: true }, ""); fireEvent.popState(window);
    expect(screen.queryByTestId("community-gallery-loading")).toBeNull();
    await act(async () => read.resolve());
    replace.mockRestore();
  });
});
