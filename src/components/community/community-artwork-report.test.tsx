/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommunityArtworkReport } from "./community-artwork-report";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.body.style.overflow = ""; });

describe("community artwork reports", () => {
  it("sends an identified report without putting reporter data in the body", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ reason: "privacy", details: "Please review the background." });
      return new Response(JSON.stringify({ ok: true, duplicate: false }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<CommunityArtworkReport artworkId="22222222-2222-4222-8222-222222222222" access="join" returnTo="/en/club/artworks/22222222-2222-4222-8222-222222222222" />);
    await user.click(screen.getByTestId("community-artwork-report-open"));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(document.body.style.overflow).toBe("hidden");
    await user.click(screen.getByLabelText("Personal information or privacy"));
    await user.type(screen.getByTestId("community-artwork-report-details"), "Please review the background.");
    await user.click(screen.getByTestId("community-artwork-report-submit"));
    expect(await screen.findByTestId("community-artwork-report-message")).toHaveTextContent("sent to the moderation team");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(document.body.style.overflow).toBe("");
  });

  it("offers sign-in and contact routes to guests without an anonymous report endpoint", () => {
    render(<CommunityArtworkReport artworkId="22222222-2222-4222-8222-222222222222" access="guest" returnTo="/en/club/artworks/22222222-2222-4222-8222-222222222222" />);
    expect(screen.getByTestId("community-artwork-report-login")).toHaveAttribute("href", expect.stringContaining("returnTo="));
    expect(screen.getByRole("link", { name: "contact form" })).toHaveAttribute("href", "/en/contact");
  });
});
