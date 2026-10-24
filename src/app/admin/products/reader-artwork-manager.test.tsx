/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderArtworkManager } from "./reader-artwork-manager";
import { AdminToastProvider } from "@/components/admin/admin-toast";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReaderArtworkManager", () => {
  it("shows a useful error and remains usable when the read response has no artwork list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }));

    render(<ReaderArtworkManager productId="product-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Odpowiedź serwera ma nieprawidłowy format.");
    expect(screen.getByLabelText("Obraz")).toBeInTheDocument();
    expect(screen.getByLabelText("Pseudonim")).toBeInTheDocument();
  });

  it("does not report success or replace current artwork when a mutation response is malformed", async () => {
    const artwork = { id: "art-1", displayName: "Mila", description: "Kwiaty", sortOrder: 0, isVisible: true, src: "/art.jpg" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ artworks: [artwork] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(<ReaderArtworkManager productId="product-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ukryj" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się potwierdzić zapisu.");
    expect(screen.getByText("Colored by Mila")).toBeInTheDocument();
  });

  it("shows success only after a valid persisted artwork list is returned", async () => {
    const artwork = { id: "art-1", displayName: "Mila", description: "Kwiaty", sortOrder: 0, isVisible: true, src: "/art.jpg" };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ artworks: [artwork] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ artworks: [{ ...artwork, isVisible: false }] }) }));

    render(<AdminToastProvider><ReaderArtworkManager productId="product-1" /></AdminToastProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Ukryj" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Prace czytelniczek zostały zapisane.");
    expect(screen.getByText("Ukryta")).toBeInTheDocument();
  });
});
