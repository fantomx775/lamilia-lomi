// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CommunityAccountPanel } from "./community-account-panel";

const activeProfile = {
  username: "garden_user",
  avatarSeed: "safe-seed",
  isAdult: true,
  adultAttestedAt: "2026-10-25T12:00:00.000Z",
  optedInAt: "2026-10-25T12:00:00.000Z",
  participationRevokedAt: null,
  rulesVersion: "2026-10-25-v1",
  acceptedAt: "2026-10-25T12:00:00.000Z",
  suspendedAt: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CommunityAccountPanel", () => {
  it("requires unchecked adult and current-rules opt-ins and sends no marketing or actor fields", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({
      ok: true,
      profile: activeProfile,
      }), { status: 201, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CommunityAccountPanel
      profile={null}
      enabled
      publicEnabled={false}
      emailVerified
      guidelinesHref="/en/community-guidelines"
      creatorProfileBaseHref="/en/club/creators"
      contactHref="/en/contact"
    />);

    const adult = screen.getByLabelText(/I confirm that I am 18 years or older/);
    const rules = screen.getByLabelText(/I accept the current community guidelines/);
    expect(adult).not.toBeChecked();
    expect(rules).not.toBeChecked();
    expect(screen.getByText(/No date of birth or marketing consent/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Public username"), "garden_user");
    await user.click(screen.getByRole("button", { name: "Join the Coloring Club" }));
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(adult);
    await user.click(rules);
    await user.click(screen.getByRole("button", { name: "Join the Coloring Club" }));
    expect(await screen.findByRole("status")).toHaveTextContent("You joined the Coloring Club");
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/community/join");
    const payload = JSON.parse(String(options.body));
    expect(payload).toEqual({
      username: "garden_user",
      adultAttested: true,
      rulesAccepted: true,
      rulesVersion: "2026-10-25-v1",
    });
    expect(payload).not.toHaveProperty("marketingConsent");
    expect(payload).not.toHaveProperty("userId");
  });

  it("shows public profile only while public access is enabled and handles username conflict safely", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({
      ok: false,
      error: "conflict",
      message: "That username is unavailable. Try another.",
      }), { status: 409, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<CommunityAccountPanel
      profile={activeProfile}
      enabled
      publicEnabled={false}
      emailVerified
      guidelinesHref="/en/community-guidelines"
      creatorProfileBaseHref="/en/club/creators"
      contactHref="/en/contact"
    />);
    expect(screen.queryByRole("link", { name: "View profile" })).toBeNull();
    view.unmount();
    render(<CommunityAccountPanel
      profile={activeProfile}
      enabled
      publicEnabled
      emailVerified
      guidelinesHref="/en/community-guidelines"
      creatorProfileBaseHref="/en/club/creators"
      contactHref="/en/contact"
    />);
    expect(screen.getByRole("link", { name: "View profile" })).toHaveAttribute("href", "/en/club/creators/garden_user");
    const usernameInput = screen.getByLabelText("Change public username");
    await user.clear(usernameInput);
    await user.type(usernameInput, "taken_name");
    await user.click(screen.getByRole("button", { name: "Save username" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That username is unavailable. Try another.");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1] && (fetchMock.mock.calls[0][1] as RequestInit).body)))
      .toEqual({ username: "taken_name" });
  });

  it("explains that unverified accounts must verify email before joining", () => {
    render(<CommunityAccountPanel
      profile={null}
      enabled
      publicEnabled
      emailVerified={false}
      guidelinesHref="/en/community-guidelines"
      creatorProfileBaseHref="/en/club/creators"
      contactHref="/en/contact"
    />);
    expect(screen.getByText("Verify your email before joining or changing community settings.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join the Coloring Club" })).toBeNull();
  });

  it("keeps a prior username fixed during rejoin and gives suspended members a contact path", () => {
    const revokedProfile = { ...activeProfile, participationRevokedAt: "2026-10-25T12:00:00.000Z" };
    const view = render(<CommunityAccountPanel
      profile={revokedProfile}
      enabled
      publicEnabled={false}
      emailVerified
      guidelinesHref="/en/community-guidelines"
      creatorProfileBaseHref="/en/club/creators"
      contactHref="/en/contact"
    />);
    const rejoinUsername = screen.getByLabelText("Public username");
    expect(rejoinUsername).toHaveValue("garden_user");
    expect(rejoinUsername).toHaveAttribute("readonly");
    expect(screen.getByText(/Your current username stays assigned while you rejoin/)).toBeInTheDocument();

    view.unmount();
    render(<CommunityAccountPanel
      profile={{ ...activeProfile, suspendedAt: "2026-10-25T12:00:00.000Z" }}
      enabled
      publicEnabled
      emailVerified
      guidelinesHref="/en/community-guidelines"
      creatorProfileBaseHref="/en/club/creators"
      contactHref="/en/contact"
    />);
    expect(screen.queryByRole("button", { name: "Join the Coloring Club" })).toBeNull();
    expect(screen.getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "/en/contact");
  });
});
