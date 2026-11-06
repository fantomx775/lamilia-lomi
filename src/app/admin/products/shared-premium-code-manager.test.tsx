/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedPremiumCodeManager } from "./shared-premium-code-manager";

afterEach(() => vi.unstubAllGlobals());

describe("shared premium code manager", () => {
  it("requires a saved product before generating a permanent code", () => {
    render(<SharedPremiumCodeManager />);
    expect(screen.getByText(/Najpierw zapisz produkt/)).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("creates a shared code and offers preview and both print exports", async () => {
    const code = { id: "code", productId: "book", code: "KDP-ABCDEF", active: true, codeType: "shared" as const };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, code }) });
    vi.stubGlobal("fetch", fetch);
    render(<SharedPremiumCodeManager productId="book" isPublished />);
    fireEvent.click(screen.getByRole("button", { name: "Utwórz stały wspólny kod" }));
    expect(await screen.findByLabelText("Wspólny kod premium")).toHaveTextContent("KDP-ABCDEF");
    expect(fetch).toHaveBeenCalledWith("/api/admin/products/book/shared-code", expect.objectContaining({ method: "POST", body: '{"active":true}' }));
    expect(screen.getByRole("img")).toHaveAttribute("src", "/api/admin/products/book/shared-code?format=svg&preview=1");
    expect(screen.getByRole("link", { name: "Pobierz SVG do druku" })).toHaveAttribute("href", "/api/admin/products/book/shared-code?format=svg");
    expect(screen.getByRole("link", { name: "Pobierz PDF do druku" })).toHaveAttribute("href", "/api/admin/products/book/shared-code?format=pdf");
  });

  it("deactivates without allowing edits or rotation, hides exports, and reactivates the same code", async () => {
    const code = { id: "code", productId: "book", code: "KDP-STABLE", active: true, codeType: "shared" as const };
    const fetch = vi.fn().mockImplementation(async (_url, options) => ({ ok: true, json: async () => ({ code: { ...code, active: JSON.parse(options.body).active } }) }));
    vi.stubGlobal("fetch", fetch);
    render(<SharedPremiumCodeManager productId="book" isPublished initialCode={code} />);
    fireEvent.click(screen.getByRole("button", { name: "Dezaktywuj wspólny kod" }));
    await waitFor(() => expect(screen.queryByRole("img")).toBeNull());
    expect(screen.getByLabelText("Wspólny kod premium")).toHaveTextContent("KDP-STABLE");
    fireEvent.click(screen.getByRole("button", { name: "Aktywuj ponownie ten sam kod" }));
    expect(await screen.findByRole("img")).toBeVisible();
    expect(screen.getByLabelText("Wspólny kod premium")).toHaveTextContent("KDP-STABLE");
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
