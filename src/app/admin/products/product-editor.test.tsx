/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/actions", () => ({
  archiveProductAction: vi.fn(),
  deleteProductAction: vi.fn(),
  saveProductAction: vi.fn(),
}));

import { ProductEditor } from "./product-editor";
import { getSeedContentSnapshot } from "@/lib/content-store";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProductEditor V2", () => {
  const snapshot = getSeedContentSnapshot();
  const product = snapshot.products[0];

  it("renders one active locale panel and preserves locale values while switching", async () => {
    const user = userEvent.setup();
    const view = render(
      <ProductEditor
        title="Edycja produktu"
        product={product}
        categories={snapshot.categories}
        tags={snapshot.tags}
      />,
    );

    expect(view.getByRole("heading", { name: "Podstawowe informacje" })).toBeInTheDocument();
    expect(view.getAllByRole("tabpanel")).toHaveLength(1);
    expect(view.getByRole("tabpanel").querySelector('input[name="title_en"]')).toHaveValue(product.translations[0].title);

    await user.click(view.getByRole("tab", { name: /PL/ }));
    expect(view.getByRole("tabpanel").querySelector('input[name="title_pl"]')).toHaveValue(product.translations[1].title);
    expect(view.getByText("SEO i wygląd w Google")).toBeInTheDocument();
  });

  it("shows five purpose-built media sections without the legacy asset builder", () => {
    const view = render(
      <ProductEditor
        title="Nowy produkt"
        categories={snapshot.categories}
        tags={snapshot.tags}
      />,
    );

    expect(view.getByRole("heading", { name: "Organizacja" })).toBeInTheDocument();
    expect(view.getByLabelText("Segment")).toHaveValue("kids");
    for (const title of ["OKŁADKA", "GALERIA", "WIDEO FLIPTHROUGH", "PUBLICZNE PLIKI DO POBRANIA", "MATERIAŁY PREMIUM"]) {
      expect(view.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(view.getByRole("heading", { name: "Sprzedaż na Amazon" })).toBeInTheDocument();
    expect(view.getByRole("heading", { name: "Dostęp premium" })).toBeInTheDocument();
    expect(view.getByLabelText("Status")).toHaveValue("draft");
    expect(view.queryByText("Bucket")).not.toBeInTheDocument();
    expect(view.queryByText("Ścieżka / URL")).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Dodaj asset" })).not.toBeInTheDocument();
  });

  it("keeps existing taxonomy, primary Amazon link, and premium code values visible", () => {
    const view = render(
      <ProductEditor
        title="Edycja produktu"
        product={product}
        categories={snapshot.categories}
        tags={snapshot.tags}
      />,
    );

    expect(view.getByLabelText("Coloring books")).toBeChecked();
    expect(view.getByLabelText("Printable bonus")).toBeChecked();
    expect(view.getAllByRole("radio", { name: "Domyślny" })[0]).toBeChecked();
    expect(view.getByLabelText("Kod")).toHaveValue("LOMI-BOOK-2026");
    expect(view.getByLabelText("Aktywny")).toBeChecked();
  });

  it("reveals and collapses SEO details without leaving the native disclosure open", async () => {
    const user = userEvent.setup();
    const view = render(
      <ProductEditor
        title="Edycja produktu"
        product={product}
        categories={snapshot.categories}
        tags={snapshot.tags}
      />,
    );

    const summary = view.getByText("SEO i wygląd w Google").closest("summary");
    const disclosure = summary?.closest("details");

    expect(summary).not.toBeNull();
    expect(disclosure).not.toHaveAttribute("open");

    await user.click(summary!);
    await waitFor(() => expect(disclosure).toHaveAttribute("open"));

    await user.click(summary!);
    await waitFor(() => expect(disclosure).not.toHaveAttribute("open"));
  });

  it("exposes validation feedback inline", () => {
    const view = render(
      <ProductEditor
        title="Nowy produkt"
        categories={snapshot.categories}
        tags={snapshot.tags}
        feedback="English title is required."
      />,
    );

    expect(view.getByRole("alert")).toHaveTextContent("English title is required.");
  });

  it("submits current locale values through the provided server action", async () => {
    const saveAction = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const view = render(
      <ProductEditor
        title="Nowy produkt"
        categories={snapshot.categories}
        tags={snapshot.tags}
        saveAction={saveAction}
      />,
    );

    const title = view.container.querySelector<HTMLInputElement>("#product-title-en");
    expect(title).not.toBeNull();
    await user.type(title!, "Ocean Calm");
    await user.click(view.getByRole("button", { name: "Zapisz" }));

    await waitFor(() => expect(saveAction).toHaveBeenCalled());
    const formData = saveAction.mock.calls[0][0] as FormData;
    expect(formData.get("title_en")).toBe("Ocean Calm");
  });

  it("uploads a selected file through the admin binary endpoint and keeps its filename", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ asset: {
        id: "asset-uploaded-cover",
        productId: "product-upload",
        kind: "cover",
        bucket: "public-media",
        path: "/uploads/product-upload/cover/moon-garden-cover.jpg",
        storagePath: "/uploads/product-upload/cover/moon-garden-cover.jpg",
        filename: "moon-garden-cover.jpg",
        contentType: "image/jpeg",
        sizeBytes: 12,
        title: "moon-garden-cover.jpg",
        sortOrder: 1,
        isPublic: true,
        isActive: true,
        uploaded: true,
      } }),
    }));
    const user = userEvent.setup();
    const view = render(
      <ProductEditor
        title="Nowy produkt"
        categories={snapshot.categories}
        tags={snapshot.tags}
      />,
    );

    const input = view.container.querySelector<HTMLInputElement>("#media-upload-cover");
    expect(input).not.toBeNull();
    await user.upload(input!, new File(["cover"], "moon-garden-cover.jpg", { type: "image/jpeg" }));

    await waitFor(() => expect(view.getByText("moon-garden-cover.jpg")).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith("/api/admin/assets", expect.objectContaining({ method: "POST" }));
    expect(view.getByText("Przesłano")).toBeInTheDocument();

    await user.click(view.getByRole("button", { name: "Usuń" }));
    await waitFor(() => expect(view.queryByText("moon-garden-cover.jpg")).not.toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith("/api/admin/assets", expect.objectContaining({ method: "DELETE" }));
  });

  it("rejects a gallery selection above the twenty-image limit before uploading", async () => {
    const user = userEvent.setup();
    const view = render(
      <ProductEditor title="Nowy produkt" categories={snapshot.categories} tags={snapshot.tags} />,
    );
    const input = view.container.querySelector<HTMLInputElement>("#media-upload-gallery");
    const files = Array.from({ length: 21 }, (_, index) => new File(["image"], `page-${index}.png`, { type: "image/png" }));

    await user.upload(input!, files);

    expect(view.getByRole("alert")).toHaveTextContent("maksymalnie 20");
  });
});
