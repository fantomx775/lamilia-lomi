/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const editorMocks = vi.hoisted(() => {
  const uploadMedia = vi.fn();
  return { uploadMedia, uploadMediaWithTus: uploadMedia, routerReplace: vi.fn() };
});

vi.mock("@/lib/media-upload-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media-upload-client")>();

  return {
    ...actual,
    uploadMedia: editorMocks.uploadMedia,
    uploadMediaWithTus: editorMocks.uploadMedia,
  };
});

vi.mock("@/app/admin/actions", () => ({
  archiveProductAction: vi.fn(),
  deleteProductAction: vi.fn(),
  saveProductAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: editorMocks.routerReplace }),
}));

import { ProductEditor } from "./product-editor";
import { AdminProductEditorHistoryGuard } from "@/app/admin/admin-product-editor-history-guard";
import { buildProductFromFormData } from "@/lib/admin-content";
import { ADMIN_ERROR_CODES } from "@/lib/admin-errors";
import { getSeedContentSnapshot } from "@/lib/content-store";
import {
  PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_TITLE_MAX_LENGTH,
} from "@/lib/product-text";
import type { Product, ProductAsset } from "@/lib/types";

function productWithGalleryAssets(product: Product, filenames: string[], reverseStateOrder = false): Product {
  const template = product.assets.find((asset) => asset.kind === "gallery");
  if (!template) throw new Error("The seed product needs a gallery asset for the editor fixture.");

  const gallery: ProductAsset[] = filenames.map((filename, index) => ({
    ...template,
    id: `gallery-fixture-${index + 1}`,
    productId: product.id,
    path: `/uploads/${product.id}/gallery/${filename}`,
    storagePath: undefined,
    filename,
    contentType: "image/png",
    sizeBytes: 100 + index,
    title: `Gallery title ${index + 1}`,
    sortOrder: index + 1,
  }));

  return {
    ...product,
    assets: [
      ...product.assets.filter((asset) => asset.kind !== "gallery"),
      ...(reverseStateOrder ? gallery.slice().reverse() : gallery),
    ],
  };
}

function galleryPreviewOrder(view: RenderResult) {
  return view.getAllByRole("img").flatMap((image) => {
    const label = image.getAttribute("aria-label");
    return label?.startsWith("Podgląd image-") ? [label.slice("Podgląd ".length)] : [];
  });
}

function galleryActionOrder(view: RenderResult) {
  return Array.from(view.container.querySelectorAll<HTMLButtonElement>(
    'button[aria-label^="Przenieś image-"][aria-label$=" wyżej"]',
  )).map((button) => button.getAttribute("aria-label")!.slice("Przenieś ".length, -" wyżej".length));
}

function galleryRow(view: RenderResult, filename: string) {
  const row = view.getByRole("img", { name: `Podgląd ${filename}` }).closest<HTMLDivElement>("div.rounded-xl");
  if (!row) throw new Error(`Missing gallery row for ${filename}.`);
  return within(row);
}

function galleryAssetsFromFormData(formData: FormData) {
  const kinds = formData.getAll("assetKind").map(String);
  const ids = formData.getAll("assetId").map(String);
  const filenames = formData.getAll("assetFilename").map(String);
  const sortOrders = formData.getAll("assetSortOrder").map(String);

  return kinds.flatMap((kind, index) => kind === "gallery"
    ? [{ id: ids[index], filename: filenames[index], sortOrder: sortOrders[index] }]
    : []);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  editorMocks.uploadMedia.mockReset();
  editorMocks.uploadMediaWithTus.mockReset();
  editorMocks.routerReplace.mockReset();
});

describe("ProductEditor V2", () => {
  const snapshot = getSeedContentSnapshot();
  const product = snapshot.products[0];

  it("renders the canonical product content without language tabs or media selectors", () => {
    const view = render(
      <ProductEditor
        title="Edycja produktu"
        product={product}
        categories={snapshot.categories}
        tags={snapshot.tags}
      />,
    );

    expect(view.getByRole("heading", { name: "Podstawowe informacje" })).toBeInTheDocument();
    expect(view.queryByRole("tab")).not.toBeInTheDocument();
    expect(view.getByLabelText("Tytuł")).toHaveValue(product.translations.find((translation) => translation.locale === "en")?.title);
    expect(view.container.querySelector('[name="title_pl"]')).not.toBeInTheDocument();
    expect(view.container.querySelector('[name="assetLocale"]')).not.toBeInTheDocument();
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
    expect(view.queryByRole("heading", { name: "Zaawansowane" })).not.toBeInTheDocument();
    expect(view.getByLabelText("Adres produktu")).toHaveValue("");
    expect(view.getByLabelText("Pozycja w katalogu")).toHaveValue(100);
    expect(view.getByLabelText("Przypomnienie o opinii po (dniach)")).toHaveValue(14);
    expect(view.getByLabelText("Segment")).toHaveValue("kids");
    for (const title of ["OKŁADKA", "GALERIA", "WIDEO FLIPTHROUGH", "PUBLICZNE PLIKI DO POBRANIA", "MATERIAŁY PREMIUM"]) {
      expect(view.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(view.getByRole("heading", { name: "Sprzedaż na Amazon" })).toBeInTheDocument();
    expect(view.getByRole("heading", { name: "Dostęp premium" })).toBeInTheDocument();
    expect(view.getByLabelText("Status")).toHaveValue("draft");
    expect(view.getByText("Nowy produkt nie został jeszcze zapisany")).toBeInTheDocument();
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

  it("adds each available Amazon market once and then disables the add button", async () => {
    const user = userEvent.setup();
    const view = render(
      <ProductEditor
        title="Nowy produkt"
        categories={snapshot.categories}
        tags={snapshot.tags}
      />,
    );

    const addButton = view.getByRole("button", { name: "Dodaj rynek" });
    await user.click(addButton);
    await user.click(addButton);

    expect(view.getAllByLabelText("Rynek")).toHaveLength(2);
    expect(view.getAllByLabelText("Rynek").map((select) => (select as HTMLSelectElement).value)).toEqual([
      "amazon.com",
      "amazon.de",
    ]);
    expect(addButton).toBeDisabled();
    expect(view.getByText("Dodano wszystkie dostępne rynki.")).toBeInTheDocument();
  });

  it("points the publish requirement at Amazon after removing the last link", async () => {
    const saveAction = vi.fn().mockResolvedValue({
      ok: false,
      errors: [ADMIN_ERROR_CODES.VALIDATION_PUBLISH_REQUIREMENTS],
    });
    const user = userEvent.setup();
    const editorProduct = {
      ...product,
      status: "published" as const,
      amazonLinks: product.amazonLinks.slice(0, 1),
    };
    const view = render(
      <ProductEditor
        title="Edycja produktu"
        product={editorProduct}
        categories={snapshot.categories}
        tags={snapshot.tags}
        saveAction={saveAction}
      />,
    );
    const amazonSection = view.container.querySelector<HTMLElement>("#product-amazon-links");
    expect(amazonSection).not.toBeNull();

    await user.click(within(amazonSection!).getByRole("button", { name: "Usuń" }));
    await user.click(view.getByRole("button", { name: /Zapisz/ }));

    await waitFor(() => expect(saveAction).toHaveBeenCalled());
    expect(amazonSection).toHaveTextContent("Opublikowany produkt wymaga tytułu EN, krótkiego opisu, okładki i linku Amazon.");
    expect(view.getByLabelText("Status")).not.toHaveAttribute("aria-invalid", "true");
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

  it("shows where title and short description are used, counts text, and warns near each limit", () => {
    const view = render(
      <ProductEditor title="Nowy produkt" categories={snapshot.categories} tags={snapshot.tags} />,
    );
    const title = view.getByLabelText("Tytuł");
    const shortDescription = view.getByLabelText("Krótki opis");

    expect(title).toHaveAttribute("maxLength", String(PRODUCT_TITLE_MAX_LENGTH));
    expect(shortDescription.tagName).toBe("TEXTAREA");
    expect(shortDescription).toHaveAttribute("rows", "4");
    expect(shortDescription).toHaveAttribute("maxLength", String(PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH));
    expect(view.getByText("Używany w katalogu i na stronie produktu.")).toBeInTheDocument();
    expect(view.getByText(/Wyświetlany na kartach i w podglądzie produktu/)).toBeInTheDocument();

    fireEvent.change(title, { target: { value: "T".repeat(PRODUCT_TITLE_MAX_LENGTH - 20) } });
    fireEvent.change(shortDescription, { target: { value: "S".repeat(PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH - 20) } });

    expect(view.getByText(`${PRODUCT_TITLE_MAX_LENGTH - 20} / ${PRODUCT_TITLE_MAX_LENGTH} znaków`)).toBeInTheDocument();
    expect(view.getByText(`${PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH - 20} / ${PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH} znaków`)).toBeInTheDocument();
    expect(view.getAllByText("Zbliżasz się do limitu. Pozostało 20 znaków.")).toHaveLength(2);
  });

  it("blocks over-limit text with field-level feedback while preserving both values", async () => {
    const saveAction = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <ProductEditor
        title="Nowy produkt"
        categories={snapshot.categories}
        tags={snapshot.tags}
        saveAction={saveAction}
      />,
    );
    const title = view.getByLabelText("Tytuł");
    const shortDescription = view.getByLabelText("Krótki opis");
    const overlongTitle = "T".repeat(PRODUCT_TITLE_MAX_LENGTH + 1);
    const overlongDescription = "S".repeat(PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH + 1);

    fireEvent.change(title, { target: { value: overlongTitle } });
    fireEvent.change(shortDescription, { target: { value: overlongDescription } });
    await user.click(view.getByRole("button", { name: /Zapisz/ }));

    expect(saveAction).not.toHaveBeenCalled();
    expect(title).toHaveValue(overlongTitle);
    expect(shortDescription).toHaveValue(overlongDescription);
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(shortDescription).toHaveAttribute("aria-invalid", "true");
    expect(view.container.querySelector("#product-title-error")).toHaveTextContent("Tytuł może mieć maksymalnie 140 znaków.");
    expect(view.container.querySelector("#product-short-description-error")).toHaveTextContent("Krótki opis może mieć maksymalnie 300 znaków.");
  });

  it("submits the single product content fields through the provided server action", async () => {
    const saveAction = vi.fn().mockResolvedValue({ ok: true, id: product.id });
    vi.spyOn(window.history, "back").mockImplementation(() => {
      const state = {
        __lamiliaProductEditorHistoryGuard: { owner: window.location.href, role: "base" },
      };
      window.history.replaceState(state, "", window.location.href);
      window.dispatchEvent(new PopStateEvent("popstate", { state }));
    });
    const user = userEvent.setup();
    const view = render(
      <AdminProductEditorHistoryGuard>
        <ProductEditor
          title="Nowy produkt"
          categories={snapshot.categories}
          tags={snapshot.tags}
          saveAction={saveAction}
        />
      </AdminProductEditorHistoryGuard>,
    );

    const title = view.container.querySelector<HTMLInputElement>("#product-title");
    expect(title).not.toBeNull();
    await user.type(title!, "Ocean Calm");
    await user.click(screen.getByRole("button", { name: /Zapisz/ }));

    await waitFor(() => expect(saveAction).toHaveBeenCalled());
    const formData = saveAction.mock.calls[0][0] as FormData;
    expect(formData.get("title")).toBe("Ocean Calm");
    expect(formData.has("title_pl")).toBe(false);
    await waitFor(() => expect(editorMocks.routerReplace).toHaveBeenCalledWith(`/admin/products/${product.id}?saved=1`));
  });

  it("keeps entered values and points to the title after a server validation error", async () => {
    const saveAction = vi.fn().mockResolvedValue({
      ok: false,
      errors: ["admin.validation.product_title_required"],
    });
    const user = userEvent.setup();
    const view = render(
      <ProductEditor title="Nowy produkt" categories={snapshot.categories} tags={snapshot.tags} saveAction={saveAction} />,
    );
    const title = view.getByLabelText("Tytuł");
    const shortDescription = view.getByLabelText("Krótki opis");
    fireEvent.change(title, { target: { value: "Draft with retained fields" } });
    fireEvent.change(shortDescription, { target: { value: "This value must remain after the failed save." } });
    await user.click(screen.getByRole("button", { name: /Zapisz/ }));

    await waitFor(() => expect(view.getByText("Nie udało się zapisać. Twoje wpisane wartości są zachowane.")).toBeInTheDocument());
    expect(title).toHaveValue("Draft with retained fields");
    expect(shortDescription).toHaveValue("This value must remain after the failed save.");
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(view.getAllByText("Tytuł produktu po angielsku jest wymagany.").length).toBeGreaterThan(0);
  });

  it("warns before internal navigation and browser reload while edits are unsaved", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = render(
      <ProductEditor title="Nowy produkt" categories={snapshot.categories} tags={snapshot.tags} />,
    );
    const title = view.getByLabelText("Tytuł");
    fireEvent.change(title, { target: { value: "Unsaved draft" } });

    const backLink = view.getByRole("link", { name: "Produkty" });
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    backLink.dispatchEvent(clickEvent);

    expect(confirm).toHaveBeenCalledWith("Masz niezapisane zmiany. Opuścić edytor i je odrzucić?");
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(title).toHaveValue("Unsaved draft");

    const unloadEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloadEvent);
    expect(unloadEvent.defaultPrevented).toBe(true);
  });

  it("unregisters its popstate guard after the editor unmounts", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const forward = vi.spyOn(window.history, "forward").mockImplementation(() => {});
    const view = render(
      <AdminProductEditorHistoryGuard>
        <ProductEditor title="Nowy produkt" categories={snapshot.categories} tags={snapshot.tags} />
      </AdminProductEditorHistoryGuard>,
    );

    fireEvent.change(view.getByLabelText("Tytuł"), { target: { value: "Unsaved before unmount" } });
    view.rerender(<AdminProductEditorHistoryGuard>{null}</AdminProductEditorHistoryGuard>);
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));

    expect(confirm).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });

  it("registers a fresh guard after remount and keeps Back/Forward protection active", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const forward = vi.spyOn(window.history, "forward").mockImplementation(() => {});
    const editor = (
      <AdminProductEditorHistoryGuard>
        <ProductEditor title="Nowy produkt" categories={snapshot.categories} tags={snapshot.tags} />
      </AdminProductEditorHistoryGuard>
    );
    const view = render(editor);

    fireEvent.change(view.getByLabelText("Tytuł"), { target: { value: "First mount" } });
    view.rerender(<AdminProductEditorHistoryGuard>{null}</AdminProductEditorHistoryGuard>);
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(confirm).not.toHaveBeenCalled();

    view.rerender(editor);
    fireEvent.change(view.getByLabelText("Tytuł"), { target: { value: "Second mount" } });
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("does not let an older editor's cleanup unregister the newer editor", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const forward = vi.spyOn(window.history, "forward").mockImplementation(() => {});
    const newerEditor = (
      <ProductEditor key="newer" title="Nowszy produkt" categories={snapshot.categories} tags={snapshot.tags} />
    );
    const view = render(
      <AdminProductEditorHistoryGuard>
        <>
          <ProductEditor key="older" title="Starszy produkt" categories={snapshot.categories} tags={snapshot.tags} />
          {newerEditor}
        </>
      </AdminProductEditorHistoryGuard>,
    );

    const titles = view.container.querySelectorAll<HTMLInputElement>("#product-title");
    expect(titles).toHaveLength(2);
    fireEvent.change(titles[1], { target: { value: "Newer editor" } });
    view.rerender(
      <AdminProductEditorHistoryGuard>
        <>{newerEditor}</>
      </AdminProductEditorHistoryGuard>,
    );
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);

    view.rerender(<AdminProductEditorHistoryGuard>{null}</AdminProductEditorHistoryGuard>);
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("updates the visible status badge as the product status changes", async () => {
    const user = userEvent.setup();
    const view = render(
      <ProductEditor title="Nowy produkt" categories={snapshot.categories} tags={snapshot.tags} />,
    );

    await user.selectOptions(view.getByLabelText("Status"), "archived");
    expect(view.getByLabelText("Status")).toHaveValue("archived");
    expect(view.getAllByText("Zarchiwizowany")).toHaveLength(2);
  });

  it("moves the selected gallery thumbnail exactly one position and enforces both boundaries", async () => {
    const names = ["image-a.png", "image-b.png", "image-c.png", "image-d.png"];
    const editorProduct = productWithGalleryAssets(product, names);
    const user = userEvent.setup();
    const view = render(
      <ProductEditor title="Edycja produktu" product={editorProduct} categories={snapshot.categories} tags={snapshot.tags} />,
    );
    const move = async (filename: string, direction: "wyżej" | "niżej") => {
      await user.click(galleryRow(view, filename).getByRole("button", { name: `Przenieś ${filename} ${direction}` }));
    };

    expect(galleryPreviewOrder(view)).toEqual(names);
    expect(galleryRow(view, names[0]).getByRole("button", { name: `Przenieś ${names[0]} wyżej` })).toBeDisabled();
    expect(galleryRow(view, names[3]).getByRole("button", { name: `Przenieś ${names[3]} niżej` })).toBeDisabled();

    await move(names[0], "niżej");
    expect(galleryPreviewOrder(view)).toEqual([names[1], names[0], names[2], names[3]]);
    await move(names[0], "niżej");
    expect(galleryPreviewOrder(view)).toEqual([names[1], names[2], names[0], names[3]]);
    await move(names[0], "wyżej");
    expect(galleryPreviewOrder(view)).toEqual([names[1], names[0], names[2], names[3]]);

    await move(names[3], "wyżej");
    expect(galleryPreviewOrder(view)).toEqual([names[1], names[0], names[3], names[2]]);
    await move(names[3], "wyżej");
    expect(galleryPreviewOrder(view)).toEqual([names[1], names[3], names[0], names[2]]);
    await move(names[3], "wyżej");
    expect(galleryPreviewOrder(view)).toEqual([names[3], names[1], names[0], names[2]]);
    expect(galleryRow(view, names[3]).getByRole("button", { name: `Przenieś ${names[3]} wyżej` })).toBeDisabled();

    await move(names[3], "niżej");
    expect(galleryPreviewOrder(view)).toEqual([names[1], names[3], names[0], names[2]]);
    await move(names[3], "niżej");
    expect(galleryPreviewOrder(view)).toEqual([names[1], names[0], names[3], names[2]]);
    await move(names[3], "niżej");
    expect(galleryPreviewOrder(view)).toEqual([names[1], names[0], names[2], names[3]]);
    expect(galleryRow(view, names[3]).getByRole("button", { name: `Przenieś ${names[3]} niżej` })).toBeDisabled();
  }, 15_000);

  it("loads existing images by sort order and preserves reordered IDs and metadata through save and reload", async () => {
    const names = ["image-a.png", "image-b.png", "image-c.png", "image-d.png"];
    const editorProduct = productWithGalleryAssets(product, names, true);
    const saveAction = vi.fn().mockResolvedValue({ ok: true, id: editorProduct.id });
    const user = userEvent.setup();
    const view = render(
      <ProductEditor title="Edycja produktu" product={editorProduct} categories={snapshot.categories} tags={snapshot.tags} saveAction={saveAction} />,
    );
    const moveUp = async (filename: string) => {
      await user.click(galleryRow(view, filename).getByRole("button", { name: `Przenieś ${filename} wyżej` }));
    };

    expect(galleryPreviewOrder(view)).toEqual(names);
    await moveUp(names[3]);
    expect(galleryPreviewOrder(view)).toEqual([names[0], names[1], names[3], names[2]]);
    await moveUp(names[3]);
    expect(galleryPreviewOrder(view)).toEqual([names[0], names[3], names[1], names[2]]);
    await moveUp(names[3]);
    expect(galleryPreviewOrder(view)).toEqual([names[3], names[0], names[1], names[2]]);

    await user.click(screen.getByRole("button", { name: /Zapisz/ }));
    await waitFor(() => expect(saveAction).toHaveBeenCalled());
    const formData = saveAction.mock.calls[0][0] as FormData;
    const submittedGallery = galleryAssetsFromFormData(formData);
    expect(submittedGallery.map(({ filename }) => filename)).toEqual([names[3], names[0], names[1], names[2]]);
    expect(submittedGallery.map(({ sortOrder }) => sortOrder)).toEqual(["1", "2", "3", "4"]);

    const savedProduct = buildProductFromFormData(formData, {
      existing: editorProduct,
      snapshot,
      now: new Date("2026-09-27T12:00:00.000Z"),
    }).product;
    const savedGallery = savedProduct.assets.filter((asset) => asset.kind === "gallery");
    expect(savedGallery.map(({ filename }) => filename)).toEqual([names[3], names[0], names[1], names[2]]);
    expect(savedGallery.map(({ id }) => id)).toEqual([
      "gallery-fixture-4",
      "gallery-fixture-1",
      "gallery-fixture-2",
      "gallery-fixture-3",
    ]);
    expect(savedGallery.map(({ title }) => title)).toEqual([
      "Gallery title 4",
      "Gallery title 1",
      "Gallery title 2",
      "Gallery title 3",
    ]);

    view.unmount();
    const reloaded = render(
      <ProductEditor title="Edycja produktu" product={savedProduct} categories={snapshot.categories} tags={snapshot.tags} />,
    );
    expect(galleryPreviewOrder(reloaded)).toEqual([names[3], names[0], names[1], names[2]]);
  });

  it("keeps order after adding an image and moving images after a removal", async () => {
    const names = ["image-a.png", "image-b.png"];
    const editorProduct = productWithGalleryAssets(product, names);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        status: 415,
        ok: false,
        json: async () => ({ error: "Lokalny upload wymaga przesłania pliku." }),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ asset: {
          id: "gallery-uploaded-c",
          productId: editorProduct.id,
          kind: "gallery",
          bucket: "public-media",
          path: `/uploads/${editorProduct.id}/gallery/image-c.png`,
          filename: "image-c.png",
          contentType: "image/png",
          sizeBytes: 5,
          title: "Uploaded gallery title",
          sortOrder: 100,
          isPublic: true,
          isActive: true,
          uploaded: true,
        } }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const saveAction = vi.fn().mockResolvedValue({ ok: true, id: editorProduct.id });
    const user = userEvent.setup();
    const view = render(
      <ProductEditor title="Edycja produktu" product={editorProduct} categories={snapshot.categories} tags={snapshot.tags} saveAction={saveAction} />,
    );

    const input = view.container.querySelector<HTMLInputElement>("#media-upload-gallery");
    expect(input).not.toBeNull();
    await user.upload(input!, new File(["new image"], "image-c.png", { type: "image/png" }));
    await waitFor(() => expect(galleryPreviewOrder(view)).toContain("image-c.png"));
    expect(galleryPreviewOrder(view)).toEqual([...names, "image-c.png"]);

    await user.click(galleryRow(view, "image-c.png").getByRole("button", { name: "Przenieś image-c.png wyżej" }));
    expect(galleryPreviewOrder(view)).toEqual([names[0], "image-c.png", names[1]]);
    await user.click(galleryRow(view, names[0]).getByRole("button", { name: "Usuń" }));
    expect(galleryPreviewOrder(view)).toEqual(["image-c.png", names[1]]);

    await user.click(galleryRow(view, names[1]).getByRole("button", { name: `Przenieś ${names[1]} wyżej` }));
    expect(galleryPreviewOrder(view)).toEqual([names[1], "image-c.png"]);
    await user.click(screen.getByRole("button", { name: /Zapisz/ }));
    await waitFor(() => expect(saveAction).toHaveBeenCalled());

    const savedProduct = buildProductFromFormData(saveAction.mock.calls[0][0] as FormData, {
      existing: editorProduct,
      snapshot,
      now: new Date("2026-09-27T12:00:00.000Z"),
    }).product;
    const savedGallery = savedProduct.assets.filter((asset) => asset.kind === "gallery");
    expect(savedGallery.map(({ filename }) => filename)).toEqual([names[1], "image-c.png"]);
    expect(savedGallery[0].id).toBe("gallery-fixture-2");
    expect(savedGallery[1].id).toBe("gallery-uploaded-c");
  });

  it("preserves an intentional order when multiple uploads finish in reverse order", async () => {
    const filenames = ["image-a.png", "image-b.png", "image-c.png"];
    const finishers = new Map<string, () => void>();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body as string) as { productId: string; filename: string; sizeBytes: number; contentType: string };
      const storagePath = `products/${body.productId}/gallery/${body.filename}`;
      const id = `asset-${body.filename}`;

      return {
        status: 200,
        ok: true,
        json: async () => ({
          asset: {
            id,
            productId: body.productId,
            kind: "gallery",
            bucket: "public-media",
            path: `/api/media/${id}`,
            storagePath,
            filename: body.filename,
            contentType: body.contentType,
            sizeBytes: body.sizeBytes,
            title: body.filename,
            sortOrder: 100,
            isPublic: true,
            isActive: true,
            uploaded: false,
          },
          upload: {
            endpoint: "https://project.storage.supabase.co/storage/v1/upload/resumable",
            token: `signed-${body.filename}`,
            bucket: "public-media",
            path: storagePath,
          },
        }),
      };
    }));
    editorMocks.uploadMedia.mockImplementation((file: File) => new Promise<void>((resolve) => {
      finishers.set(file.name, () => resolve());
    }));

    const user = userEvent.setup();
    const saveAction = vi.fn().mockResolvedValue({ ok: true, id: product.id });
    const view = render(<ProductEditor title="Nowy produkt" categories={snapshot.categories} tags={snapshot.tags} saveAction={saveAction} />);
    const input = view.container.querySelector<HTMLInputElement>("#media-upload-gallery");
    expect(input).not.toBeNull();

    await user.upload(input!, filenames.map((filename) => new File([filename], filename, { type: "image/png" })));
    await waitFor(() => expect(editorMocks.uploadMedia).toHaveBeenCalledTimes(3));
    expect(galleryActionOrder(view)).toEqual(filenames);

    await user.click(view.getByRole("button", { name: "Przenieś image-c.png wyżej" }));
    expect(galleryActionOrder(view)).toEqual(["image-a.png", "image-c.png", "image-b.png"]);

    const uploaded = new Set<string>();
    const expectedOrder = ["image-a.png", "image-c.png", "image-b.png"];
    for (const filename of filenames.slice().reverse()) {
      finishers.get(filename)?.();
      await waitFor(() => expect(view.getByRole("img", { name: `Podgląd ${filename}` })).toBeInTheDocument());
      uploaded.add(filename);
      expect(galleryActionOrder(view)).toEqual(expectedOrder);
      expect(galleryPreviewOrder(view)).toEqual(expectedOrder.filter((name) => uploaded.has(name)));
    }
  });

  it("blocks an empty premium code row before invoking the server action", async () => {
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

    await user.click(view.getByRole("button", { name: "Dodaj kod" }));
    await user.click(screen.getByRole("button", { name: /Zapisz/ }));

    expect(saveAction).not.toHaveBeenCalled();
    expect(view.getByText("Wpisz kod premium albo usuń pusty wiersz.")).toBeInTheDocument();
  });

  it("blocks duplicate premium codes after normalization and marks both fields", async () => {
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

    await user.click(view.getByRole("button", { name: "Dodaj kod" }));
    await user.click(view.getByRole("button", { name: "Dodaj kod" }));
    const codeInputs = view.getAllByLabelText("Kod");
    await user.type(codeInputs[0], "lomi-book");
    await user.type(codeInputs[1], "LOMI – BOOK");
    await user.click(screen.getByRole("button", { name: /Zapisz/ }));

    expect(saveAction).not.toHaveBeenCalled();
    expect(view.getAllByText("Każdy kod premium może wystąpić w tym produkcie tylko raz.")).toHaveLength(2);
    expect(codeInputs[0]).toHaveAttribute("aria-invalid", "true");
    expect(codeInputs[1]).toHaveAttribute("aria-invalid", "true");
  });

  it("limits premium code inputs and reports an oversized value", async () => {
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

    await user.click(view.getByRole("button", { name: "Dodaj kod" }));
    const codeInput = view.getByLabelText("Kod");
    expect(codeInput).toHaveAttribute("maxLength", "128");

    fireEvent.change(codeInput, { target: { value: "x".repeat(129) } });
    await user.click(screen.getByRole("button", { name: /Zapisz/ }));

    expect(saveAction).not.toHaveBeenCalled();
    expect(view.getByText("Kod premium może mieć maksymalnie 128 znaków.")).toBeInTheDocument();
    expect(codeInput).toHaveAttribute("aria-invalid", "true");
  });

  it("shows an existing premium-code conflict at the section without marking every code invalid", async () => {
    const saveAction = vi.fn().mockResolvedValue({
      ok: false,
      errors: [ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_EXISTING],
    });
    const user = userEvent.setup();
    const view = render(
      <ProductEditor
        title="Nowy produkt"
        categories={snapshot.categories}
        tags={snapshot.tags}
        saveAction={saveAction}
      />,
    );

    await user.click(view.getByRole("button", { name: "Dodaj kod" }));
    await user.click(view.getByRole("button", { name: "Dodaj kod" }));
    const codeInputs = view.getAllByLabelText("Kod");
    await user.type(codeInputs[0], "LOMI-ONE");
    await user.type(codeInputs[1], "LOMI-TWO");
    await user.click(view.getByRole("button", { name: /Zapisz/ }));

    expect(view.getAllByText("Ten kod premium jest już przypisany do innego produktu.")).toHaveLength(2);
    expect(codeInputs[0]).not.toHaveAttribute("aria-invalid", "true");
    expect(codeInputs[1]).not.toHaveAttribute("aria-invalid", "true");
  });

  it("marks the only submitted premium code invalid for an existing-code conflict", async () => {
    const saveAction = vi.fn().mockResolvedValue({
      ok: false,
      errors: [ADMIN_ERROR_CODES.CONFLICT_PREMIUM_CODE_EXISTING],
    });
    const user = userEvent.setup();
    const view = render(
      <ProductEditor
        title="Nowy produkt"
        categories={snapshot.categories}
        tags={snapshot.tags}
        saveAction={saveAction}
      />,
    );

    await user.click(view.getByRole("button", { name: "Dodaj kod" }));
    const codeInput = view.getByLabelText("Kod");
    await user.type(codeInput, "LOMI-TAKEN");
    await user.click(view.getByRole("button", { name: /Zapisz/ }));

    expect(codeInput).toHaveAttribute("aria-invalid", "true");
    expect(view.getAllByText("Ten kod premium jest już przypisany do innego produktu.")).toHaveLength(2);
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

  it("retains an uploaded asset path when server cleanup fails so the user can retry deletion", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ asset: {
          id: "asset-cleanup-retry",
          productId: "product-upload",
          kind: "cover",
          bucket: "public-media",
          path: "/uploads/product-upload/cover/cover-cleanup-retry.jpg",
          storagePath: "/uploads/product-upload/cover/cover-cleanup-retry.jpg",
          filename: "cover-cleanup-retry.jpg",
          contentType: "image/jpeg",
          sizeBytes: 12,
          title: "cover-cleanup-retry.jpg",
          sortOrder: 1,
          isPublic: true,
          isActive: true,
          uploaded: true,
        } }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const saveAction = vi.fn().mockResolvedValue({
      ok: false,
      errors: [ADMIN_ERROR_CODES.INTERNAL],
      mediaCleanupFailures: [{
        assetId: "asset-cleanup-retry",
        kind: "cover",
        storagePath: "/uploads/product-upload/cover/cover-cleanup-retry.jpg",
      }],
    });
    const view = render(
      <ProductEditor
        title="Nowy produkt"
        categories={snapshot.categories}
        tags={snapshot.tags}
        saveAction={saveAction}
      />,
    );
    const input = view.container.querySelector<HTMLInputElement>("#media-upload-cover");

    await user.upload(input!, new File(["cover"], "cover-cleanup-retry.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(view.getByText("Przesłano")).toBeInTheDocument());
    await user.click(view.getByRole("button", { name: /Zapisz/ }));

    expect(await view.findByText("Nie udało się usunąć niezapisanego pliku. Możesz ponowić zapis albo użyć Usuń, aby ponowić sprzątanie.")).toBeInTheDocument();
    expect(view.container.querySelector<HTMLInputElement>('input[name="assetPath"]')).toHaveValue("/uploads/product-upload/cover/cover-cleanup-retry.jpg");
    await user.click(view.getByRole("button", { name: "Usuń" }));
    await waitFor(() => expect(view.queryByText("cover-cleanup-retry.jpg")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/assets", expect.objectContaining({ method: "DELETE" }));
  });

  it("falls back to multipart upload for the local backend", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        status: 415,
        ok: false,
        json: async () => ({ error: "Lokalny upload wymaga przesłania pliku." }),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ asset: {
          id: "asset-local-cover",
          productId: "product-upload",
          kind: "cover",
          bucket: "public-media",
          path: "/uploads/product-upload/cover/cover.jpg",
          storagePath: "/uploads/product-upload/cover/cover.jpg",
          filename: "cover.jpg",
          contentType: "image/jpeg",
          sizeBytes: 5,
          title: "cover.jpg",
          sortOrder: 1,
          isPublic: true,
          isActive: true,
          uploaded: true,
        } }),
      });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    const view = render(<ProductEditor title="Nowy produkt" categories={snapshot.categories} tags={snapshot.tags} />);
    const input = view.container.querySelector<HTMLInputElement>("#media-upload-cover");

    await user.upload(input!, new File(["cover"], "cover.jpg", { type: "image/jpeg" }));

    await waitFor(() => expect(view.getByText("cover.jpg")).toBeInTheDocument());
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/admin/assets", expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
  });

  it("keeps Save disabled until a signed resumable upload completes", async () => {
    let finishUpload!: () => void;
    editorMocks.uploadMedia.mockImplementation(() => new Promise<void>((resolve) => {
      finishUpload = resolve;
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        asset: {
          id: "11111111-1111-4111-8111-111111111199",
          productId: "11111111-1111-4111-8111-111111111111",
          kind: "cover",
          bucket: "public-media",
          path: "/api/media/11111111-1111-4111-8111-111111111199",
          storagePath: "products/11111111-1111-4111-8111-111111111111/cover/11111111-1111-4111-8111-111111111199-cover.jpg",
          filename: "cover.jpg",
          contentType: "image/jpeg",
          sizeBytes: 5,
          title: "cover.jpg",
          sortOrder: 1,
          isPublic: true,
          isActive: true,
          uploaded: false,
        },
        upload: {
          endpoint: "https://project.storage.supabase.co/storage/v1/upload/resumable",
          token: "signed-token",
          bucket: "public-media",
          path: "products/11111111-1111-4111-8111-111111111111/cover/11111111-1111-4111-8111-111111111199-cover.jpg",
        },
      }),
    }));
    const user = userEvent.setup();
    const saveAction = vi.fn().mockResolvedValue({ ok: true, id: product.id });
    const view = render(<ProductEditor title="Nowy produkt" categories={snapshot.categories} tags={snapshot.tags} saveAction={saveAction} />);
    const input = view.container.querySelector<HTMLInputElement>("#media-upload-cover");

    await user.upload(input!, new File(["cover"], "cover.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Zapisz/ })).toBeDisabled());
    expect(view.getByText("Zapis produktu będzie dostępny po zakończeniu przesyłania plików.")).toBeInTheDocument();

    finishUpload();
    await waitFor(() => expect(view.getByText("Przesłano")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: /Zapisz/ })).not.toBeDisabled());
  });

  it("preserves the existing cover when a replacement upload fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Nie udało się przesłać pliku. Spróbuj ponownie." }),
    }));
    const user = userEvent.setup();
    const view = render(<ProductEditor title="Edycja produktu" product={product} categories={snapshot.categories} tags={snapshot.tags} />);
    const input = view.container.querySelector<HTMLInputElement>("#media-upload-cover");

    await user.upload(input!, new File(["cover"], "replacement.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(view.getByText("Nie udało się przesłać pliku. Spróbuj ponownie.")).toBeInTheDocument());
    expect(view.getByText("moon-garden.svg")).toBeInTheDocument();
  });

  it("shows a friendly message when TUS returns a raw Storage error", async () => {
    editorMocks.uploadMedia.mockRejectedValue(new Error(
      "tus: unexpected response while creating upload, response code: 400, response text: Invalid key: products/example/gallery/Zdjęcie cyfrowe 1.webp",
    ));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        asset: {
          id: "asset-uploaded-gallery",
          productId: "product-upload",
          kind: "gallery",
          bucket: "public-media",
          path: "/api/media/asset-uploaded-gallery",
          storagePath: "products/product-upload/gallery/asset-uploaded-gallery-Zdjecie-cyfrowe-1.webp",
          filename: "Zdjęcie cyfrowe 1.webp",
          contentType: "image/webp",
          sizeBytes: 12,
          title: "Zdjęcie cyfrowe 1.webp",
          sortOrder: 1,
          isPublic: true,
          isActive: true,
          uploaded: false,
        },
        upload: {
          endpoint: "https://project.storage.supabase.co/storage/v1/upload/resumable",
          token: "signed-token",
          bucket: "public-media",
          path: "products/product-upload/gallery/asset-uploaded-gallery-Zdjecie-cyfrowe-1.webp",
        },
      }),
    }));
    const user = userEvent.setup();
    const view = render(<ProductEditor title="Nowy produkt" categories={snapshot.categories} tags={snapshot.tags} />);
    const input = view.container.querySelector<HTMLInputElement>("#media-upload-gallery");

    await user.upload(input!, new File(["image"], "Zdjęcie cyfrowe 1.webp", { type: "image/webp" }));

    const friendlyError = "Nie udało się przesłać pliku. Spróbuj ponownie.";
    await waitFor(() => expect(view.getByText(friendlyError)).toBeInTheDocument());
    expect(view.container.textContent).not.toContain("tus: unexpected response");
    expect(view.container.textContent).not.toContain("Invalid key");
  });

  it("uses a retry action icon for a failed upload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Nie udało się przesłać pliku. Spróbuj ponownie." }),
    }));
    const user = userEvent.setup();
    const view = render(<ProductEditor title="Nowy produkt" categories={snapshot.categories} tags={snapshot.tags} />);
    const input = view.container.querySelector<HTMLInputElement>("#media-upload-cover");

    await user.upload(input!, new File(["cover"], "cover.jpg", { type: "image/jpeg" }));
    const retry = await view.findByRole("button", { name: "Ponów" });

    expect(retry.querySelector("svg")?.getAttribute("class")).toContain("lucide-rotate-ccw");
    expect(retry.querySelector("svg")?.getAttribute("class")).not.toContain("lucide-loader-circle");
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
