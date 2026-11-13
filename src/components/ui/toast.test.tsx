/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "./toast";

function MutationControls() {
  const { showToast } = useToast();
  return <>
    <button onClick={() => showToast("success", "Saved")}>Save</button>
    <button onClick={() => showToast("error", "Save failed")}>Fail</button>
  </>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("deduplicates success, dismisses it automatically and leaves errors until dismissed", () => {
  vi.useFakeTimers();
  render(<MutationControls />, { wrapper: ToastProvider });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent("Saved");
  act(() => vi.advanceTimersByTime(6000));
  expect(screen.queryByRole("status")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Fail" }));
  act(() => vi.advanceTimersByTime(12000));
  expect(screen.getByRole("alert")).toHaveTextContent("Save failed");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
  expect(screen.queryByRole("alert")).toBeNull();
});
