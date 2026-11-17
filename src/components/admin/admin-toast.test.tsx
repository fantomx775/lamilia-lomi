/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminRouteToast, AdminToastProvider, adminRouteToastScope, useAdminToast } from "./admin-toast";

function Trigger({ kind = "success" as const }: { kind?: "success" | "error" }) {
  const publish = useAdminToast();
  return <button onClick={() => publish(kind, "Pomyślnie zapisano.")}>Pokaż</button>;
}

afterEach(() => { cleanup(); vi.useRealTimers(); sessionStorage.clear(); });

describe("admin toasts", () => {
  it("shows success accessibly and dismisses it after six seconds", () => {
    vi.useFakeTimers();
    render(<AdminToastProvider><Trigger /></AdminToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Pokaż" }));
    expect(screen.getByRole("status")).toHaveTextContent("Pomyślnie zapisano.");
    act(() => { vi.advanceTimersByTime(6000); });
    act(() => { vi.advanceTimersByTime(160); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps errors readable until explicitly dismissed", () => {
    vi.useFakeTimers();
    render(<AdminToastProvider><Trigger kind="error" /></AdminToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Pokaż" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Pomyślnie zapisano.");
    act(() => { vi.advanceTimersByTime(20000); });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zamknij powiadomienie" }));
    act(() => { vi.advanceTimersByTime(160); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("maps server redirect success to its client operation and retains another route error", async () => {
    function ClientFailure() {
      const toast = useAdminToast();
      return <><button onClick={() => toast("error", "Product save failed", { scope: "product-save" })}>Fail product</button>
        <button onClick={() => toast("error", "About save failed", { scope: adminRouteToastScope("/admin/pages/about") })}>Fail About</button></>;
    }
    const view = render(<AdminToastProvider><ClientFailure /></AdminToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Fail product" }));
    fireEvent.click(screen.getByRole("button", { name: "Fail About" }));
    window.history.replaceState(null, "", "/admin/products/owned?toast=retry&filter=active");
    view.rerender(<AdminToastProvider><ClientFailure /><AdminRouteToast eventId="retry-product-save" kind="success" message="Product saved" cleanPath="/admin/products/owned" /></AdminToastProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("About save failed");
    expect(screen.queryByText("Product save failed")).toBeNull();
    expect(window.location.search).toBe("?filter=active");
    expect(adminRouteToastScope("/admin/products", "delete")).not.toBe(adminRouteToastScope("/admin/products", "save"));
    expect(adminRouteToastScope("/admin/pages/about")).not.toBe(adminRouteToastScope("/admin/pages/contact"));
  });

  it("consumes each event once, handles a later save, preserves other query state, and cleans the flash URL", async () => {
    const id = "9a5a26ea-a22e-47da-a551-49e54bb8998f";
    window.history.replaceState({ next: true }, "", "/admin/products?toast=old&filter=active&error=stale");
    const view = render(<AdminToastProvider><AdminRouteToast eventId={id} kind="success" message="Produkt został zapisany." cleanPath="/admin/products" /></AdminToastProvider>);
    expect(await screen.findByRole("status")).toHaveTextContent("Produkt został zapisany.");
    expect(window.location.search).toBe("?filter=active");
    expect(window.history.state).toEqual({ next: true });
    const nextId = "8a5a26ea-a22e-47da-a551-49e54bb8998f";
    view.rerender(<AdminToastProvider><AdminRouteToast eventId={nextId} kind="success" message="Ponowny zapis zakończony." cleanPath="/admin/products" /></AdminToastProvider>);
    expect(await screen.findByRole("status")).toHaveTextContent("Ponowny zapis zakończony.");
    view.rerender(<AdminToastProvider><AdminRouteToast eventId={id} kind="success" message="Stary zapis." cleanPath="/admin/products" /></AdminToastProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("Ponowny zapis zakończony.");
  });
});
