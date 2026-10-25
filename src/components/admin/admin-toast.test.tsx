/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminRouteToast, AdminToastProvider, useAdminToast } from "./admin-toast";

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
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
