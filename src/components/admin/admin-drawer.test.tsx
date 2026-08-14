/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
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

    const close = within(view.getByRole("dialog")).getByRole("button", { name: "Zamknij panel" });
    const action = view.getByRole("button", { name: "Akcja" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(action).toHaveFocus();
    fireEvent.keyDown(action, { key: "Tab" });
    expect(close).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(view.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
