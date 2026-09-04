/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveCategoryInlineAction: vi.fn(),
  deleteCategoryInlineAction: vi.fn(),
  saveTagInlineAction: vi.fn(),
  deleteTagInlineAction: vi.fn(),
}));

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
  it("switches locales and submits the shared category form", async () => {
    saveCategoryInlineAction.mockResolvedValue({ ok: true, id: "new-category" });
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <TaxonomyEditorDrawer
        kind="category"
        open
        onClose={vi.fn()}
        onSaved={onSaved}
        saveAction={saveCategoryInlineAction}
        deleteAction={deleteCategoryInlineAction}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /DE/ }));
    expect(screen.getByLabelText("Nazwa")).toHaveAttribute("name", "name_de");
    await user.type(screen.getByLabelText("Nazwa"), "Calm books");
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(saveCategoryInlineAction).toHaveBeenCalled();
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

  it("supports the same locale and save flow for tags", async () => {
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

    await user.type(screen.getByLabelText("Nazwa"), "Calm");
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(saveTagInlineAction).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });
});
