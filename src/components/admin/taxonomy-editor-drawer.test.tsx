/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveCategoryInlineAction: vi.fn(),
  deleteCategoryInlineAction: vi.fn(),
  saveTagInlineAction: vi.fn(),
  deleteTagInlineAction: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.routerRefresh }) }));
vi.mock("@/lib/image-ratios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/image-ratios")>();
  return { ...actual, readImageDimensions: vi.fn().mockResolvedValue({ width: 800, height: 800 }) };
});

vi.mock("@/app/admin/actions", () => ({
  saveCategoryInlineAction: mocks.saveCategoryInlineAction,
  deleteCategoryInlineAction: mocks.deleteCategoryInlineAction,
   saveTagInlineAction: mocks.saveTagInlineAction,
   deleteTagInlineAction: mocks.deleteTagInlineAction,
}));

import { TaxonomyEditorDrawer } from "./taxonomy-editor-drawer";

const {
  saveCategoryInlineAction,
  deleteCategoryInlineAction,
  saveTagInlineAction,
  deleteTagInlineAction,
} = mocks;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaxonomyEditorDrawer", () => {
  it("edits and submits the single category content language", async () => {
    saveCategoryInlineAction.mockResolvedValue({ ok: true, id: "category-1" });
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <TaxonomyEditorDrawer
        kind="category"
        item={{ id: "category-1", slug: "books", sortOrder: 1, translations: [
          { locale: "en", name: "Books" },
          { locale: "pl", name: "Książki" },
        ] }}
        open
        onClose={vi.fn()}
        onSaved={onSaved}
        saveAction={saveCategoryInlineAction}
        deleteAction={deleteCategoryInlineAction}
      />,
    );

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nazwa")).toHaveAttribute("name", "name");
    expect(screen.getByLabelText("Nazwa")).toHaveValue("Books");
    await user.clear(screen.getByLabelText("Nazwa"));
    await user.type(screen.getByLabelText("Nazwa"), "Story books");
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(saveCategoryInlineAction).toHaveBeenCalled();
    const formData = saveCategoryInlineAction.mock.calls[0][0] as FormData;
    expect(formData.get("name")).toBe("Story books");
    expect(formData.has("name_pl")).toBe(false);
    expect(onSaved).toHaveBeenCalled();
  });

  it("requires explicit confirmation before delete", async () => {
    deleteCategoryInlineAction.mockResolvedValue({ ok: true, id: "category-1" });
    vi.stubGlobal("confirm", vi.fn(() => true));
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <TaxonomyEditorDrawer
        kind="category"
        item={{ id: "category-1", slug: "books", sortOrder: 1, translations: [{ locale: "en", name: "Books" }] }}
        open
        onClose={vi.fn()}
        onSaved={onSaved}
        saveAction={saveCategoryInlineAction}
        deleteAction={deleteCategoryInlineAction}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Usuń kategorię" }));
    expect(deleteCategoryInlineAction).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("uses the same single-language save flow for tags", async () => {
    saveTagInlineAction.mockResolvedValue({ ok: true, id: "new-tag" });
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <TaxonomyEditorDrawer
        kind="tag"
        open
        onClose={vi.fn()}
        onSaved={onSaved}
        saveAction={saveTagInlineAction}
        deleteAction={deleteTagInlineAction}
      />,
    );

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Nazwa"), "Calm");
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(saveTagInlineAction).toHaveBeenCalled();
    const formData = saveTagInlineAction.mock.calls[0][0] as FormData;
    expect(formData.get("name")).toBe("Calm");
    expect(formData.has("name_de")).toBe(false);
    expect(onSaved).toHaveBeenCalled();
  });

  it("uploads, replaces, and removes a category image without submitting taxonomy text", async () => {
    const categoryId = "11111111-1111-4111-8111-111111111111";
    const firstImage = {
      id: "22222222-2222-4222-8222-222222222222",
      path: "/uploads/categories/11111111-1111-4111-8111-111111111111/image/first-books.webp",
      storagePath: "categories/11111111-1111-4111-8111-111111111111/image/first-books.webp",
      storageProvider: "supabase",
      filename: "books.webp",
      contentType: "image/webp",
      sizeBytes: 1200,
    };
    const replacementImage = {
      ...firstImage,
      id: "33333333-3333-4333-8333-333333333333",
      path: "/uploads/categories/11111111-1111-4111-8111-111111111111/image/second-books.webp",
      storagePath: "categories/11111111-1111-4111-8111-111111111111/image/second-books.webp",
      filename: "books-replacement.webp",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ image: firstImage }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ image: replacementImage }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cleanupDeferred: false }) });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    const user = userEvent.setup();
    render(
      <TaxonomyEditorDrawer
        kind="category"
        item={{ id: categoryId, slug: "books", sortOrder: 1, translations: [{ locale: "en", name: "Books" }] }}
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
        saveAction={saveCategoryInlineAction}
        deleteAction={deleteCategoryInlineAction}
      />,
    );

    const imageInput = screen.getByLabelText("Dodaj obraz");
    await user.upload(imageInput, new File(["image"], "books.webp", { type: "image/webp" }));
    expect(await screen.findByText("Obraz kategorii został zapisany.")).toBeInTheDocument();
    await user.upload(screen.getByLabelText("Zastąp obraz"), new File(["replacement"], "books-replacement.webp", { type: "image/webp" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("button", { name: "Usuń obraz" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "Usuń obraz" }));

    expect(await screen.findByText("Obraz kategorii został usunięty.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/category-image");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "DELETE" });
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(3);
    expect(saveCategoryInlineAction).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
