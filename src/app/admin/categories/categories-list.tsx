"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { AdminResourceList } from "@/components/admin/admin-resource-list";
import { TaxonomyEditorDrawer, type DeleteAction, type SaveAction } from "@/components/admin/taxonomy-editor-drawer";
import type { DataTableColumn } from "@/components/admin/data-table";
import { Button } from "@/components/ui/button";
import type { AdminMutationResult } from "@/lib/admin-errors";
import type { Category } from "@/lib/types";

export type AdminCategoryListRow = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  productCount: number;
};

function buildColumns(onEdit: (id: string, trigger: HTMLElement) => void): DataTableColumn<AdminCategoryListRow>[] {
  return [
    {
      id: "name",
      header: "Nazwa",
      cell: (row) => (
        <button
          type="button"
          onClick={(event) => onEdit(row.id, event.currentTarget)}
          aria-label={`Edytuj kategorię ${row.name}`}
          className="group block min-w-0 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
        >
          <span className="font-medium text-[var(--color-ink)] group-hover:text-[var(--color-terracotta)]">{row.name}</span>
          <span className="mt-1 block truncate text-xs text-[var(--color-muted)]">{row.slug}</span>
        </button>
      ),
    },
    { id: "slug", header: "Slug", cell: (row) => <span className="font-mono text-xs">{row.slug}</span> },
    { id: "sort-order", header: "Kolejność", cell: (row) => row.sortOrder },
    { id: "products", header: "Produkty", cell: (row) => row.productCount },
  ];
}

export function CategoriesResourceList({
  rows,
  items = [],
  saveAction,
  deleteAction,
  initialCleanupDeferredCategoryId,
}: {
  rows: AdminCategoryListRow[];
  items?: Category[];
  saveAction?: SaveAction;
  deleteAction?: DeleteAction;
  initialCleanupDeferredCategoryId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [restoreFocusElement, setRestoreFocusElement] = useState<HTMLElement | null>(null);
  const [cleanupDeferredCategoryId, setCleanupDeferredCategoryId] = useState<string | null>(initialCleanupDeferredCategoryId ?? null);
  const editingItem = items.find((item) => item.id === editingId);

  const openCreate = (trigger: HTMLElement) => {
    setRestoreFocusElement(trigger);
    setEditingId(null);
    setOpen(true);
  };

  const openEdit = (id: string, trigger: HTMLElement | null) => {
    setRestoreFocusElement(trigger);
    setEditingId(id);
    setOpen(true);
  };

  const columns = buildColumns(openEdit);

  const handleSaved = () => {
    setOpen(false);
    router.refresh();
  };

  const handleDeleted = (result: Extract<AdminMutationResult, { ok: true }>) => {
    setOpen(false);
    setCleanupDeferredCategoryId(result.cleanupDeferred ? result.id : null);
    router.refresh();
  };

  return (
    <>
      {cleanupDeferredCategoryId ? (
        <div role="alert" className="mb-4 flex items-start justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p>
            Kategorię usunięto, ale jej plik obrazu nie został usunięty z magazynu. Sprzątnięcie wymaga interwencji administratora; przekaż mu ID kategorii: <code className="font-mono">{cleanupDeferredCategoryId}</code>.
          </p>
          <button type="button" className="shrink-0 font-medium underline" onClick={() => setCleanupDeferredCategoryId(null)}>
            Zamknij komunikat
          </button>
        </div>
      ) : null}
      <AdminResourceList
        title="Kategorie"
        description="Przeglądaj kategorie przypisane do katalogu produktów."
        searchPlaceholder="Szukaj kategorii…"
        searchAriaLabel="Szukaj kategorii"
        caption="Lista kategorii"
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        getSearchText={(row) => [row.name, row.slug].join(" ")}
        onRowActivate={(row, trigger) => openEdit(row.id, trigger)}
        toolbarActions={<Button type="button" size="sm" onClick={(event) => openCreate(event.currentTarget)}><Plus className="size-4" aria-hidden />Dodaj kategorię</Button>}
        renderMobileCard={(row) => (
          <button
            type="button"
            onClick={(event) => openEdit(row.id, event.currentTarget)}
            className="group block w-full min-w-0 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
            aria-label={`Edytuj kategorię ${row.name}`}
          >
            <p className="truncate font-medium text-[var(--color-ink)] group-hover:text-[var(--color-terracotta)]">{row.name}</p>
            <p className="mt-1 truncate font-mono text-xs text-[var(--color-muted)]">{row.slug}</p>
            <p className="mt-4 text-sm text-[var(--color-muted)]">{row.productCount} produktów</p>
          </button>
        )}
        emptyState={<p className="p-8 text-center text-sm text-[var(--color-muted)]">Brak kategorii.</p>}
      />
      <TaxonomyEditorDrawer
        kind="category"
        item={editingItem}
        open={open}
        onClose={() => setOpen(false)}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        saveAction={saveAction}
        deleteAction={deleteAction}
        restoreFocusElement={restoreFocusElement}
      />
    </>
  );
}
