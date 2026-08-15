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

afterEach(() => cleanup());

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

  it("shows readable organization, media, Amazon, premium and publishing controls", () => {
    const view = render(
      <ProductEditor
        title="Nowy produkt"
        categories={snapshot.categories}
        tags={snapshot.tags}
      />,
    );

    expect(view.getByRole("heading", { name: "Organizacja" })).toBeInTheDocument();
    expect(view.getByLabelText("Segment")).toHaveValue("kids");
    expect(view.getByRole("heading", { name: "Okładka i media" })).toBeInTheDocument();
    expect(view.getByRole("heading", { name: "Sprzedaż na Amazon" })).toBeInTheDocument();
    expect(view.getByRole("heading", { name: "Dostęp premium" })).toBeInTheDocument();
    expect(view.getByLabelText("Status")).toHaveValue("draft");
    expect(view.queryByText("Bucket")).not.toBeInTheDocument();
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
});
