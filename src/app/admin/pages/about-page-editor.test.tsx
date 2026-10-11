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

    await user.click(view.getAllByRole("button", { name: "Zapisz" })[0]);
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
});
