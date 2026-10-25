/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AboutPageEditor } from "./about-page-editor";
import type { AboutPageSettings } from "@/lib/types";

afterEach(() => cleanup());

const products = [
  { id: "color-ocean", title: "Ocean Calm Coloring Book", subtitle: "A relaxing coloring book", productType: "coloring-book", status: "published" },
  { id: "color-garden", title: "Garden Days Coloring Book", subtitle: "Flowers and gardens", productType: "coloring-book", status: "published" },
  { id: "color-stars", title: "Starry Night Coloring Book", subtitle: "Night sky scenes", productType: "coloring-book", status: "published" },
  { id: "color-draft", title: "Unpublished Coloring Book", productType: "coloring-book", status: "draft" },
  { id: "picture-moon", title: "Moon Garden Picture Book", subtitle: "A bedtime story", productType: "picture-book", status: "published" },
  { id: "picture-forest", title: "Little Forest Picture Book", subtitle: "A forest adventure", productType: "picture-book", status: "published" },
  { id: "audio-story", title: "Audio Story", productType: "audiobook", status: "published" },
];

const emptyConfig: AboutPageSettings = {
  intro: "",
  favoriteColoringBookIds: ["", "", ""],
  favoritePictureBookIds: ["", "", ""],
};

const duplicateConfigs: Array<[string, AboutPageSettings]> = [
  ["within one section", {
    ...emptyConfig,
    favoriteColoringBookIds: ["color-ocean", "color-ocean", ""],
  }],
  ["across sections", {
    ...emptyConfig,
    favoriteColoringBookIds: ["color-ocean", "", ""],
    favoritePictureBookIds: ["color-ocean", "", ""],
  }],
];

describe("AboutPageEditor", () => {
  it("renders three searchable slots per section and submits ordered repeated fields", async () => {
    const saveAction = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const view = render(
      <AboutPageEditor
        config={{
          ...emptyConfig,
          favoriteColoringBookIds: ["color-ocean", "color-garden", ""],
          favoritePictureBookIds: ["picture-moon", "", ""],
        }}
        products={products}
        saveAction={saveAction}
      />,
    );

    expect(view.getAllByRole("combobox", { name: /Favorite (Coloring|Picture) Books/ })).toHaveLength(6);
    expect(view.getAllByRole("heading", { name: "Favorite Coloring Books" })).toHaveLength(1);
    expect(view.getAllByRole("heading", { name: "Favorite Picture Books" })).toHaveLength(1);

    await user.click(view.getByRole("button", { name: "Przesuń produkt Coloring Books, pozycja 2, wyżej" }));

    const coloringInputs = view.container.querySelectorAll<HTMLInputElement>('input[name="favoriteColoringBookIds"]');
    expect(Array.from(coloringInputs, (input) => input.value)).toEqual(["color-garden", "color-ocean", ""]);
    expect(view.container.querySelectorAll('input[name="favoritePictureBookIds"]')).toHaveLength(3);

    await user.click(view.getByTestId("admin-save-bar").querySelector("button")!);
    await waitFor(() => expect(saveAction).toHaveBeenCalledTimes(1));

    const formData = saveAction.mock.calls[0][0] as FormData;
    expect(formData.getAll("favoriteColoringBookIds")).toEqual(["color-garden", "color-ocean", ""]);
    expect(formData.getAll("favoritePictureBookIds")).toEqual(["picture-moon", "", ""]);
  });

  it("searches available published products and updates exclusions after selection or replacement", async () => {
    const user = userEvent.setup();
    const view = render(<AboutPageEditor config={emptyConfig} products={products} />);
    const firstSlot = view.getByRole("combobox", { name: "Favorite Coloring Books, pozycja 1" });
    const secondSlot = view.getByRole("combobox", { name: "Favorite Coloring Books, pozycja 2" });

    await user.click(firstSlot);
    await user.type(firstSlot, "Garden");
    expect(view.getByRole("option", { name: /Garden Days Coloring Book/ })).toBeInTheDocument();
    expect(view.queryByRole("option", { name: /Moon Garden Picture Book/ })).not.toBeInTheDocument();
    expect(view.queryByRole("option", { name: /Unpublished Coloring Book/ })).not.toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");

    await user.click(secondSlot);
    expect(view.queryByRole("option", { name: /Garden Days Coloring Book/ })).not.toBeInTheDocument();
    expect(view.getByRole("option", { name: /Ocean Calm Coloring Book/ })).toBeInTheDocument();
    await user.click(view.getByRole("option", { name: /Ocean Calm Coloring Book/ }));

    await user.click(firstSlot);
    await user.type(firstSlot, "Starry");
    await user.click(view.getByRole("option", { name: /Starry Night Coloring Book/ }));

    await user.click(secondSlot);
    expect(view.getByRole("option", { name: /Garden Days Coloring Book/ })).toBeInTheDocument();
    expect(view.queryByRole("option", { name: /Starry Night Coloring Book/ })).not.toBeInTheDocument();
  });

  it("closes a product list when keyboard focus leaves its combobox", async () => {
    const user = userEvent.setup();
    const view = render(<AboutPageEditor config={emptyConfig} products={products} />);
    const firstSlot = view.getByRole("combobox", { name: "Favorite Coloring Books, pozycja 1" });
    const secondSlot = view.getByRole("combobox", { name: "Favorite Coloring Books, pozycja 2" });

    await user.click(firstSlot);
    expect(firstSlot).toHaveAttribute("aria-expanded", "true");
    expect(view.getByRole("listbox", { name: /pozycja 1/ })).toBeInTheDocument();

    await user.tab();

    expect(secondSlot).toHaveFocus();
    expect(firstSlot).toHaveAttribute("aria-expanded", "false");
    expect(view.queryByRole("listbox", { name: /pozycja 1/ })).not.toBeInTheDocument();
  });

  it("closes a selected product list before Tab focuses its clear button", async () => {
    const user = userEvent.setup();
    const view = render(
      <AboutPageEditor
        config={{ ...emptyConfig, favoriteColoringBookIds: ["color-ocean", "", ""] }}
        products={products}
      />,
    );
    const firstSlot = view.getByRole("combobox", { name: "Favorite Coloring Books, pozycja 1" });
    const clearButton = view.getByRole("button", { name: "Wyczyść wybór: Favorite Coloring Books, pozycja 1" });

    await user.click(firstSlot);
    expect(firstSlot).toHaveAttribute("aria-expanded", "true");

    await user.tab();

    expect(clearButton).toHaveFocus();
    expect(firstSlot).toHaveAttribute("aria-expanded", "false");
    expect(view.queryByRole("listbox", { name: /pozycja 1/ })).not.toBeInTheDocument();
  });

  it("warns about missing and unpublished saved products while allowing their replacement", async () => {
    const user = userEvent.setup();
    const view = render(
      <AboutPageEditor
        config={{
          ...emptyConfig,
          favoriteColoringBookIds: ["color-draft", "removed-product", ""],
        }}
        products={products}
      />,
    );

    expect(view.getByText(/nie jest opublikowany/)).toBeInTheDocument();
    expect(view.getByText(/nie jest już dostępny/)).toBeInTheDocument();

    const firstSlot = view.getByRole("combobox", { name: "Favorite Coloring Books, pozycja 1" });
    await user.click(firstSlot);
    expect(view.queryByRole("option", { name: /Unpublished Coloring Book/ })).not.toBeInTheDocument();
    await user.click(view.getByRole("option", { name: /Ocean Calm Coloring Book/ }));

    expect(firstSlot).toHaveValue("Ocean Calm Coloring Book");
    expect(view.getByText(/nie jest już dostępny/)).toBeInTheDocument();
  });

  it("excludes selections from every slot, including a stale cross-section type mismatch", async () => {
    const user = userEvent.setup();
    const view = render(
      <AboutPageEditor
        config={{
          ...emptyConfig,
          favoritePictureBookIds: ["color-stars", "", ""],
        }}
        products={products}
      />,
    );

    expect(view.getByText(/ma inny typ/)).toBeInTheDocument();
    const coloringSlot = view.getByRole("combobox", { name: "Favorite Coloring Books, pozycja 1" });
    await user.click(coloringSlot);
    expect(view.queryByRole("option", { name: /Starry Night Coloring Book/ })).not.toBeInTheDocument();
  });

  it.each(duplicateConfigs)("blocks submission when duplicate IDs are selected %s", async (_scope, config) => {
    const saveAction = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <AboutPageEditor
        config={config}
        products={products}
        saveAction={saveAction}
      />,
    );

    fireEvent.submit(view.container.querySelector("form")!);

    expect(view.getByRole("alert")).toHaveTextContent(/wybrany w kilku pozycjach/);
    expect(saveAction).not.toHaveBeenCalled();
  });

  it("warns before leaving with an unapplied HTML draft", async () => {
    const user = userEvent.setup();
    const view = render(<AboutPageEditor config={emptyConfig} products={products} />);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    await user.click(view.getByRole("button", { name: "HTML" }));
    fireEvent.change(view.getByRole("textbox", { name: "Źródło HTML" }), {
      target: { value: "<p>Unapplied About intro</p>" },
    });

    expect(view.getByText("Masz niezapisane zmiany.")).toHaveAttribute("role", "status");
    await user.click(view.getByRole("link", { name: "Strony" }));

    expect(confirm).toHaveBeenCalledWith("Masz niezapisane zmiany. Opuścić edytor i je odrzucić?");
    expect(view.getByRole("textbox", { name: "Źródło HTML" })).toHaveValue("<p>Unapplied About intro</p>");
    confirm.mockRestore();
  });

  it("uses the fixed shared bar, blocks an unapplied source draft, and preserves it after failure", async () => {
    const saveAction = vi.fn();
    const user = userEvent.setup();
    const view = render(<AboutPageEditor config={emptyConfig} products={products} saveAction={saveAction} />);
    const bar = await view.findByTestId("admin-save-bar");

    await user.click(view.getByRole("button", { name: "HTML" }));
    const source = view.getByRole("textbox", { name: "Źródło HTML" });
    fireEvent.change(source, { target: { value: "<p>Keep this draft</p>" } });
    expect(bar).toHaveTextContent("Niezapisane zmiany");
    expect(bar.querySelector("button")).toBeDisabled();
    expect(view.container.querySelector("form")?.className).toContain("pb-28");
    expect(saveAction).not.toHaveBeenCalled();

    view.rerender(<AboutPageEditor config={emptyConfig} products={products} feedback="Zapis nie powiódł się." saveAction={saveAction} />);
    expect(view.getByRole("textbox", { name: "Źródło HTML" })).toHaveValue("<p>Keep this draft</p>");
    expect(view.getByTestId("admin-save-bar")).toHaveTextContent("Błąd zapisu");
  });
});
