/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderArtworkManager } from "./reader-artwork-manager";
import { AdminToastProvider } from "@/components/admin/admin-toast";

beforeEach(() => {
  let sequence = 0;
  const NativeURL = URL;
  vi.stubGlobal("URL", class extends NativeURL {
    static createObjectURL = vi.fn(() => `blob:preview-${++sequence}`);
    static revokeObjectURL = vi.fn();
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ReaderArtworkManager", () => {
  it("shows a useful error and remains usable when the read response has no artwork list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }));

    render(<ReaderArtworkManager productId="product-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Odpowiedź serwera ma nieprawidłowy format.");
    expect(screen.getByLabelText(/Obraz/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wybierz pliki prac czytelniczek" })).toBeDisabled();
    expect(screen.queryByLabelText("Pseudonim")).not.toBeInTheDocument();
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

  it("waits for the initial list before allowing upload and retains existing artwork", async () => {
    let resolveInitial!: (response: unknown) => void;
    const initial = new Promise((resolve) => { resolveInitial = resolve; });
    const oldArtwork = { id: "old", displayName: "Existing artwork", sortOrder: 0, isVisible: true, src: "/old.jpg" };
    const savedArtwork = { id: "saved", displayName: "Saved artwork", sortOrder: 1, isVisible: true, src: "/saved.jpg" };
    vi.stubGlobal("fetch", vi.fn()
      .mockReturnValueOnce(initial)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ artwork: savedArtwork }) }));

    render(<AdminToastProvider><ReaderArtworkManager productId="product-1" /></AdminToastProvider>);
    expect(screen.getByRole("button", { name: "Wybierz pliki prac czytelniczek" })).toBeDisabled();
    resolveInitial({ ok: true, json: async () => ({ artworks: [oldArtwork] }) });
    expect(await screen.findByText("Colored by Existing artwork")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wybierz pliki prac czytelniczek" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/Obraz/), { target: { files: [new File(["x"], "work.png", { type: "image/png" })] } });
    expect(screen.getByRole("img", { name: "Podgląd work.png" })).toHaveAttribute("src", "blob:preview-1");
    expect(screen.getByRole("button", { name: "Dodaj pracę" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Pseudonim"), { target: { value: "Saved" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj pracę" }));

    expect(await screen.findByText("Colored by Saved artwork")).toBeInTheDocument();
    expect(screen.getByText("Colored by Existing artwork")).toBeInTheDocument();
  });

  it("keeps mutations blocked after a failed load until retry succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ artworks: [] }) }));
    render(<ReaderArtworkManager productId="product-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się wczytać prac.");
    expect(screen.getByRole("button", { name: "Wybierz pliki prac czytelniczek" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Ponów wczytywanie" }));
    await screen.findByText("Nie dodano jeszcze prac.");
    expect(screen.getByRole("button", { name: "Wybierz pliki prac czytelniczek" })).toBeEnabled();
  });

  it("rejects a reader image over 4 MiB in the client without posting it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ artworks: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ReaderArtworkManager productId="product-1" />);
    await screen.findByText("Nie dodano jeszcze prac.");

    fireEvent.change(screen.getByLabelText(/Obraz/), { target: { files: [new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Maksymalny rozmiar to 4 MB.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not let a stale endpoint response finish a newer load", async () => {
    let resolveOld!: (response: unknown) => void;
    const oldRequest = new Promise((resolve) => { resolveOld = resolve; });
    let resolveNew!: (response: unknown) => void;
    const newRequest = new Promise((resolve) => { resolveNew = resolve; });
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(oldRequest).mockReturnValueOnce(newRequest));
    const view = render(<ReaderArtworkManager productId="product-1" />);
    view.rerender(<ReaderArtworkManager productId="product-2" />);

    resolveOld({ ok: true, json: async () => ({ artworks: [] }) });
    expect(screen.getByRole("button", { name: "Wybierz pliki prac czytelniczek" })).toBeDisabled();
    expect(screen.getByText("Wczytywanie prac…")).toBeInTheDocument();
    resolveNew({ ok: true, json: async () => ({ artworks: [] }) });
    await screen.findByText("Nie dodano jeszcze prac.");
    expect(screen.getByRole("button", { name: "Wybierz pliki prac czytelniczek" })).toBeEnabled();
  });

  it("queues dropped previews with independent attribution before any upload and releases removed previews", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ artworks: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<ReaderArtworkManager productId="product-1" />);
    await screen.findByText("Nie dodano jeszcze prac.");
    fireEvent.drop(screen.getByRole("button", { name: "Wybierz pliki prac czytelniczek" }), {
      dataTransfer: { files: [new File(["a"], "first.png", { type: "image/png" }), new File(["b"], "second.png", { type: "image/png" })] },
    });
    const drafts = screen.getAllByTestId("reader-artwork-draft");
    expect(drafts).toHaveLength(2);
    expect(screen.getByRole("img", { name: "Podgląd first.png" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Podgląd second.png" })).toBeVisible();
    fireEvent.change(within(drafts[0]).getByLabelText("Pseudonim"), { target: { value: "Lila" } });
    expect(fireEvent.keyDown(within(drafts[0]).getByLabelText("Pseudonim"), { key: "Enter" })).toBe(false);
    fireEvent.change(within(drafts[0]).getByLabelText("Opis obrazu (opcjonalnie)"), { target: { value: "Kwiaty" } });
    expect(within(drafts[1]).getByLabelText("Pseudonim")).toHaveValue("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(within(drafts[1]).getByRole("button", { name: "Usuń" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-2");
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
  });

  it("keeps the selected thumbnail and typed attribution after an upload failure, then allows retry", async () => {
    const artwork = { id: "saved", displayName: "Mila", description: "Kwiaty", sortOrder: 0, isVisible: true, src: "/saved.jpg" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ artworks: [] }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "unavailable" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ artwork }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ReaderArtworkManager productId="product-1" />);
    await screen.findByText("Nie dodano jeszcze prac.");
    fireEvent.change(screen.getByLabelText(/Obraz/), { target: { files: [new File(["x"], "work.png", { type: "image/png" })] } });
    fireEvent.change(screen.getByLabelText("Pseudonim"), { target: { value: "Mila" } });
    fireEvent.change(screen.getByLabelText("Opis obrazu (opcjonalnie)"), { target: { value: "Kwiaty" } });
    fireEvent.click(screen.getByRole("button", { name: "Dodaj pracę" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się zapisać zmian.");
    expect(screen.getByLabelText("Pseudonim")).toHaveValue("Mila");
    expect(screen.getByRole("img", { name: "Podgląd work.png" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Dodaj pracę" }));
    expect(await screen.findByText("Colored by Mila")).toBeInTheDocument();
    expect(screen.queryByTestId("reader-artwork-draft")).not.toBeInTheDocument();
    const submitted = fetchMock.mock.calls[2][1].body as FormData;
    expect(submitted.get("displayName")).toBe("Mila");
    expect(submitted.get("description")).toBe("Kwiaty");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
  });
});
