/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderArtworkManager } from "./reader-artwork-manager";

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
    await waitFor(() => expect(screen.queryByText("Zmiany zapisane.")).not.toBeInTheDocument());
  });
});
