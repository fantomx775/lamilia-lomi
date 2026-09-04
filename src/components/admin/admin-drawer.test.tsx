/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { AdminDrawer } from "./admin-drawer";

afterEach(() => cleanup());

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);

  return (
    <>
      <button type="button" onClick={(event) => { setTrigger(event.currentTarget); setOpen(true); }}>Otwórz drawer</button>
      <AdminDrawer open={open} onClose={() => setOpen(false)} title="Szczegóły" restoreFocusElement={trigger}>
        <input autoFocus aria-label="Pole" />
        <button type="button">Akcja</button>
      </AdminDrawer>
    </>
  );
}

describe("AdminDrawer", () => {
  it("restores focus to the trigger after Escape and contains Tab focus", async () => {
    const user = userEvent.setup();
    const view = render(<DrawerHarness />);
    const trigger = view.getByRole("button", { name: "Otwórz drawer" });

    await user.click(trigger);

    const close = within(screen.getByRole("dialog")).getByRole("button", { name: "Zamknij panel" });
    const action = screen.getByRole("button", { name: "Akcja" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(action).toHaveFocus();
    fireEvent.keyDown(action, { key: "Tab" });
    expect(close).toHaveFocus();

    await user.keyboard("{Escape}");
    const backdrop = document.body.querySelector('[data-slot="admin-drawer"]');
    expect(backdrop).toHaveClass("admin-drawer-exiting");
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    fireEvent(backdrop!, new Event("animationend", { bubbles: true }));
    await waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("cancels a stale exit when reopened before the animation ends", async () => {
    const user = userEvent.setup();
    const view = render(<DrawerHarness />);
    const trigger = view.getByRole("button", { name: "Otwórz drawer" });

    await user.click(trigger);
    await user.keyboard("{Escape}");
    const backdrop = document.body.querySelector('[data-slot="admin-drawer"]');

    await user.click(trigger);
    fireEvent(backdrop!, new Event("animationend", { bubbles: true }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes from the backdrop and waits for its exit animation", async () => {
    const user = userEvent.setup();
    const view = render(<DrawerHarness />);
    const trigger = view.getByRole("button", { name: "Otwórz drawer" });

    await user.click(trigger);
    const backdrop = document.body.querySelector('[data-slot="admin-drawer"]');
    const backdropButton = backdrop?.querySelector<HTMLButtonElement>('button[aria-label="Zamknij panel"]');

    expect(backdropButton).not.toBeNull();
    await user.click(backdropButton!);
    expect(backdrop).toHaveClass("admin-drawer-exiting");

    fireEvent(backdrop!, new Event("animationend", { bubbles: true }));
    await waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("closes immediately when reduced motion is requested", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const user = userEvent.setup();
    const view = render(<DrawerHarness />);
    const trigger = view.getByRole("button", { name: "Otwórz drawer" });

    await user.click(trigger);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    vi.unstubAllGlobals();
  });
});
