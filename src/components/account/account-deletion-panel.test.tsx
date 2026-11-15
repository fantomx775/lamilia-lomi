// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/components/ui/toast";
import { AccountDeletionPanel } from "./account-deletion-panel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("AccountDeletionPanel", () => {
  it("explains shared-code consequences and requires exact confirmation", async () => {
    const user = userEvent.setup();
    const replaceDocument = vi.fn();
    vi.stubGlobal("location", { replace: replaceDocument });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ ok: true, message: "Your account was deleted." }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountDeletionPanel locale="en" />, { wrapper: ToastProvider });

    expect(screen.getByText(/removes your login and access to product unlocks/)).toBeInTheDocument();
    expect(screen.getByText(/single-use code you redeemed stays consumed/)).toBeInTheDocument();
    expect(screen.getByText(/Shared codes remain available to other accounts/)).toBeInTheDocument();
    expect(screen.getByText("Danger Zone")).toBeInTheDocument();
    const submit = screen.getByTestId("account-deletion-submit");
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "delete");
    expect(submit).toBeDisabled();
    await user.clear(screen.getByLabelText("Type DELETE to confirm"));
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.click(submit);

    expect(sessionStorage.getItem("lamilia-account-deleted")).toBe("1");
    expect(fetchMock).toHaveBeenCalledWith("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "DELETE" }),
    });
    expect(replaceDocument).toHaveBeenCalledExactlyOnceWith("/en/account");
  });

  it("keeps the current account document when deletion fails", async () => {
    const user = userEvent.setup();
    const replaceDocument = vi.fn();
    vi.stubGlobal("location", { replace: replaceDocument });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: false, message: "We could not delete the account right now. Try again later.",
    }), { status: 503 })));
    render(<AccountDeletionPanel locale="en" />, { wrapper: ToastProvider });
    await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    await user.click(screen.getByTestId("account-deletion-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not delete the account right now.");
    expect(replaceDocument).not.toHaveBeenCalled();
    expect(screen.getByTestId("account-deletion-submit")).toBeEnabled();
  });
});
