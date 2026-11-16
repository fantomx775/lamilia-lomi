/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.ComponentProps<"a">) => <a href={href} {...props}>{children}</a> }));

import { CommunityHeartControl } from "./community-heart-control";
import { ToastProvider } from "@/components/ui/toast";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("community heart control", () => {
  it("renders a like and unlike before the server responds and keeps successful reactions silent", async () => {
    const like = Promise.withResolvers<Response>();
    const unlike = Promise.withResolvers<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(like.promise).mockReturnValueOnce(unlike.promise);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CommunityHeartControl artworkId="art-1" likesCount={2} likedByMe={false} access="member" />, { wrapper: ToastProvider });

    const button = screen.getByTestId("community-heart-toggle");
    await user.click(button);
    expect(fetchMock).toHaveBeenCalledWith("/api/community/artworks/art-1/heart", { method: "PUT", cache: "no-store" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("community-heart-count")).toHaveTextContent("3");
    like.resolve(Response.json({ liked: true, likesCount: 5 }));
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByTestId("community-heart-count")).toHaveTextContent("5");
    expect(screen.queryByRole("status")).toBeNull();

    await user.click(button);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/community/artworks/art-1/heart", { method: "DELETE", cache: "no-store" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("community-heart-count")).toHaveTextContent("4");
    unlike.resolve(Response.json({ liked: false, likesCount: 4 }));
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("rolls back a failed optimistic action and offers safe guest login return", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const user = userEvent.setup();
    const { rerender } = render(<CommunityHeartControl artworkId="art-1" likesCount={2} likedByMe={false} access="member" />, { wrapper: ToastProvider });
    await user.click(screen.getByTestId("community-heart-toggle"));
    expect(await screen.findByRole("alert")).toHaveTextContent("was not saved");
    expect(screen.getByTestId("community-heart-toggle")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("community-heart-count")).toHaveTextContent("2");

    rerender(<CommunityHeartControl artworkId="art-1" likesCount={2} likedByMe={false} access="guest" returnTo="/en/club/artworks/art-1" />);
    expect(screen.getByRole("link", { name: /Log in to like/ })).toHaveAttribute("href", "/en/login?returnTo=%2Fen%2Fclub%2Fartworks%2Fart-1");
  });
});
