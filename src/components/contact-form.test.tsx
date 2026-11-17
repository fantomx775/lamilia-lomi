/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ContactForm } from "./contact-form";
const requestId = "11111111-1111-4111-8111-111111111111";
function setup() { return render(<ContactForm locale="en" requestId={requestId} />); }
function fill() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Test Reader" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "reader@example.test" } });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "A controlled test message." } });
}
function submit() { fireEvent.submit(screen.getByRole("button", { name: "Send" }).closest("form")!); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("shows validation at fields and focuses the first invalid input without a request", () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); setup(); submit();
  expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Name")).toHaveFocus();
  expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
  expect(screen.getByLabelText("Message")).toHaveAttribute("maxlength", "3000");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("preserves draft on failure, prevents duplicate submits and retries with the same key", async () => {
  let release!: (response: Response) => void;
  const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock); setup(); fill(); submit();
  fireEvent.submit(screen.getByRole("button", { name: "Sending…" }).closest("form")!);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
  await act(async () => release(new Response(JSON.stringify({ ok: false, error: "Please retry." }), { status: 502 })));
  expect(screen.getByRole("alert")).toHaveTextContent("Please retry.");
  expect(screen.getByLabelText("Message")).toHaveValue("A controlled test message.");
  submit();
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("accepted"));
  expect(fetchMock.mock.calls[0][1].body.get("requestId")).toBe(requestId);
  expect(fetchMock.mock.calls[1][1].body.get("requestId")).toBe(requestId);
  expect(screen.getByLabelText("Message")).toHaveValue("A controlled test message.");
});
it("times out with the draft and a safe retry path, and aborts on unmount", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn((_url, options) => new Promise((_resolve, reject) => { options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))); }));
  vi.stubGlobal("fetch", fetchMock); const view = setup(); fill(); submit();
  await act(async () => { vi.advanceTimersByTime(15000); });
  expect(screen.getByRole("alert")).toHaveTextContent("could not confirm delivery");
  expect(screen.getByLabelText("Message")).toHaveValue("A controlled test message.");
  submit();
  view.unmount();
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
