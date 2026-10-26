// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { AccountDeletionPanel } from "./account-deletion-panel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AccountDeletionPanel", () => {
  it("explains unlock and consumed-code consequences and requires exact confirmation", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ ok: true, message: "Your account was deleted." }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountDeletionPanel locale="en" />);

    expect(screen.getByText(/removes your login and access to product unlocks/)).toBeInTheDocument();
    expect(screen.getByText(/already redeemed are single-use and stay consumed/)).toBeInTheDocument();
    const submit = screen.getByTestId("account-deletion-submit");
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "delete");
    expect(submit).toBeDisabled();
    await user.clear(screen.getByLabelText("Type DELETE to confirm"));
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.click(submit);

    expect(await screen.findByRole("status")).toHaveTextContent("Your account was deleted.");
    expect(fetchMock).toHaveBeenCalledWith("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "DELETE" }),
    });
    expect(router.replace).toHaveBeenCalledWith("/en/account");
    expect(router.refresh).toHaveBeenCalled();
  });
});
