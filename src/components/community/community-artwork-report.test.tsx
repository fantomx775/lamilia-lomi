/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/ui/toast";
import { CommunityArtworkReport } from "./community-artwork-report";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.style.overflow = ""; });

describe("community artwork reports", () => {
  it("sends an identified report without putting reporter data in the body", async () => {
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      const init = args[1];
      expect(JSON.parse(String(init?.body))).toEqual({ reason: "privacy", details: "Please review the background." });
      return new Response(JSON.stringify({ ok: true, duplicate: false }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CommunityArtworkReport artworkId="22222222-2222-4222-8222-222222222222" access="join" returnTo="/en/club/artworks/22222222-2222-4222-8222-222222222222" />, { wrapper: ToastProvider });
    await user.click(screen.getByTestId("community-artwork-report-open"));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(document.body.style.overflow).toBe("hidden");
    await user.click(screen.getByLabelText("Personal information or privacy"));
    await user.type(screen.getByTestId("community-artwork-report-details"), "Please review the background.");
    await user.click(screen.getByTestId("community-artwork-report-submit"));
    expect(await screen.findByRole("status")).toHaveTextContent("sent to the moderation team");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(document.body.style.overflow).toBe("");
  });

  it("offers sign-in and contact routes to guests without an anonymous report endpoint", () => {
    render(<CommunityArtworkReport artworkId="22222222-2222-4222-8222-222222222222" access="guest" returnTo="/en/club/artworks/22222222-2222-4222-8222-222222222222" />, { wrapper: ToastProvider });
    expect(screen.getByTestId("community-artwork-report-login")).toHaveAttribute("href", expect.stringContaining("returnTo="));
    expect(screen.getByRole("link", { name: "contact form" })).toHaveAttribute("href", "/en/contact");
  });
  it("reports a profile photo through the avatar endpoint and retains entered details on failure", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ message: "Try again" }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CommunityArtworkReport artworkId="22222222-2222-4222-8222-222222222222" subject="avatar" access="member" returnTo="/en/club/creators/test" />, { wrapper: ToastProvider });
    await user.click(screen.getByRole("button", { name: "Report this profile photo" }));
    await user.click(screen.getByLabelText("Personal information or privacy"));
    await user.type(screen.getByTestId("community-artwork-report-details"), "Background concern");
    await user.click(screen.getByTestId("community-artwork-report-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/community/avatars/22222222-2222-4222-8222-222222222222/report");
    expect(screen.getByTestId("community-artwork-report-details")).toHaveValue("Background concern");
  });

});
