/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./toast";

function MutationControls() {
  const { showToast, resolveToast } = useToast();
  return <>
    <button onClick={() => showToast("success", "Saved")}>Save</button>
    <button onClick={() => showToast("error", "Save failed")}>Fail</button>
    <button onClick={() => showToast("error", "Upload failed")}>Other error</button>
    <button onClick={() => showToast("error", "Upload retry failed", { scope: "upload" })}>Scoped failure</button>
    <button onClick={() => showToast("success", "Upload saved", { scope: "upload" })}>Scoped retry success</button>
    <button onClick={() => resolveToast("upload")}>Resolve upload silently</button>
  </>;
}
function advance(ms: number) { act(() => vi.advanceTimersByTime(ms)); }
function setup() { vi.useFakeTimers(); return render(<MutationControls />, { wrapper: ToastProvider }); }
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("restarts identical success events, including their announcement and expiry", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const first = screen.getByRole("status").getAttribute("data-toast-id");
  advance(5000);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("status").getAttribute("data-toast-id")).not.toBe(first);
  advance(1000);
  expect(screen.getByRole("status")).toHaveTextContent("Saved");
  advance(5000);
  expect(screen.getByRole("status")).toHaveAttribute("data-closing", "true");
  advance(160);
  expect(screen.queryByRole("status")).toBeNull();
});

it("preserves errors through successes, queues later errors and requires dismissal", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(screen.getByRole("button", { name: "Fail" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(screen.getByRole("button", { name: "Other error" }));
  advance(20000);
  expect(screen.getByRole("alert")).toHaveTextContent("Save failed");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
  advance(160);
  expect(screen.getByRole("alert")).toHaveTextContent("Upload failed");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
  advance(160);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("shows a success queued after an error when that error is consciously dismissed", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Fail" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Save failed");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
  advance(160);
  expect(screen.getByRole("status")).toHaveTextContent("Saved");
});

it("pauses the remaining success lifetime on hover and keyboard focus", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  advance(2000);
  fireEvent.mouseEnter(screen.getByRole("status"));
  advance(10000);
  expect(screen.getByRole("status")).not.toHaveAttribute("data-closing");
  fireEvent.mouseLeave(screen.getByRole("status"));
  fireEvent.focus(screen.getByRole("button", { name: "Dismiss notification" }));
  advance(10000);
  expect(screen.getByRole("status")).not.toHaveAttribute("data-closing");
  fireEvent.blur(screen.getByRole("button", { name: "Dismiss notification" }));
  advance(4000);
  expect(screen.getByRole("status")).toHaveAttribute("data-closing", "true");
  advance(160);
  expect(screen.queryByRole("status")).toBeNull();
});

it("pauses while the document is hidden and cleans timers/listeners on unmount", () => {
  const view = setup();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  advance(1000);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  advance(12000);
  expect(screen.getByRole("status")).not.toHaveAttribute("data-closing");
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  fireEvent(document, new Event("visibilitychange"));
  advance(5000);
  expect(screen.getByRole("status")).toHaveAttribute("data-closing", "true");
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not restart a toast on unrelated provider rerenders or take focus", () => {
  const view = setup();
  const button = screen.getByRole("button", { name: "Save" });
  button.focus();
  fireEvent.click(button);
  const id = screen.getByRole("status").getAttribute("data-toast-id");
  advance(3000);
  view.rerender(<MutationControls />);
  expect(screen.getByRole("status")).toHaveAttribute("data-toast-id", id);
  expect(button).toHaveFocus();
  advance(3000);
  advance(160);
  expect(screen.queryByRole("status")).toBeNull();
});

it("keeps a notification operable in a modal and visible after the drawer closes", async () => {
  vi.useFakeTimers();
  const view = render(<ToastProvider><dialog open aria-label="Editor"><MutationControls /></dialog></ToastProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Fail" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toContainElement(screen.getByRole("alert"));
  await act(async () => { dialog.removeAttribute("open"); });
  expect(screen.getByRole("alert")).toHaveTextContent("Save failed");
  expect(dialog).not.toContainElement(screen.getByRole("alert"));
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
  advance(160);
  expect(screen.queryByRole("alert")).toBeNull();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("a successful scoped retry resolves its own error while preserving unrelated errors", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Scoped failure" }));
  fireEvent.click(screen.getByRole("button", { name: "Fail" }));
  fireEvent.click(screen.getByRole("button", { name: "Scoped retry success" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Save failed");
  expect(screen.queryByText("Upload retry failed")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
  advance(160);
  expect(screen.getByRole("status")).toHaveTextContent("Upload saved");
});

it("silently resolves only its own operation error without manufacturing a success", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Scoped failure" }));
  fireEvent.click(screen.getByRole("button", { name: "Fail" }));
  fireEvent.click(screen.getByRole("button", { name: "Resolve upload silently" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Save failed");
  expect(screen.queryByText("Upload retry failed")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});
