"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { AdminResourceList } from "@/components/admin/admin-resource-list";
import { TaxonomyEditorDrawer, type DeleteAction, type SaveAction } from "@/components/admin/taxonomy-editor-drawer";
import type { DataTableColumn } from "@/components/admin/data-table";
import { Button } from "@/components/ui/button";
import type { Tag } from "@/lib/types";

export type AdminTagListRow = {
  id: string;
  name: string;
  slug: string;
  productCount: number;
  languageCodes: string[];
};

function buildColumns(onEdit: (id: string, trigger: HTMLElement) => void): DataTableColumn<AdminTagListRow>[] {
  return [
    {
      id: "name",
      header: "Nazwa",
      cell: (row) => (
        <button
          type="button"
          onClick={(event) => onEdit(row.id, event.currentTarget)}
          aria-label={`Edytuj tag ${row.name}`}
          className="group block min-w-0 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
        >
          <span className="font-medium text-[var(--color-ink)] group-hover:text-[var(--color-terracotta)]">{row.name}</span>
          <span className="mt-1 block truncate text-xs text-[var(--color-muted)]">{row.slug}</span>
        </button>
      ),
    },
    { id: "slug", header: "Slug", cell: (row) => <span className="font-mono text-xs">{row.slug}</span> },
    { id: "products", header: "Produkty", cell: (row) => row.productCount },
    { id: "languages", header: "Języki", cell: (row) => formatLanguages(row.languageCodes) },
  ];
}

export function TagsResourceList({
  rows,
  items = [],
  saveAction,
  deleteAction,
}: {
  rows: AdminTagListRow[];
  items?: Tag[];
  saveAction?: SaveAction;
  deleteAction?: DeleteAction;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [restoreFocusElement, setRestoreFocusElement] = useState<HTMLElement | null>(null);
  const editingItem = items.find((item) => item.id === editingId);

  const openCreate = (trigger: HTMLElement) => {
    setRestoreFocusElement(trigger);
    setEditingId(null);
    setOpen(true);
  };

  const openEdit = (id: string, trigger: HTMLElement) => {
    setRestoreFocusElement(trigger);
    setEditingId(id);
    setOpen(true);
  };

  const columns = buildColumns(openEdit);

  return (
    <>
      <AdminResourceList
        title="Tagi"
        description="Przeglądaj tagi używane do porządkowania produktów."
        searchPlaceholder="Szukaj tagów…"
        searchAriaLabel="Szukaj tagów"
        caption="Lista tagów"
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        getSearchText={(row) => [row.name, row.slug, ...row.languageCodes].join(" ")}
        toolbarActions={<Button type="button" size="sm" onClick={(event) => openCreate(event.currentTarget)}><Plus className="size-4" aria-hidden />Dodaj tag</Button>}
        renderMobileCard={(row) => (
          <button
            type="button"
            onClick={(event) => openEdit(row.id, event.currentTarget)}
            className="group block w-full min-w-0 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
            aria-label={`Edytuj tag ${row.name}`}
          >
            <p className="truncate font-medium text-[var(--color-ink)] group-hover:text-[var(--color-terracotta)]">{row.name}</p>
            <p className="mt-1 truncate font-mono text-xs text-[var(--color-muted)]">{row.slug}</p>
            <p className="mt-4 text-sm text-[var(--color-muted)]">{row.productCount} produktów · {formatLanguages(row.languageCodes)}</p>
          </button>
        )}
        emptyState={<p className="p-8 text-center text-sm text-[var(--color-muted)]">Brak tagów.</p>}
      />
      <TaxonomyEditorDrawer
        kind="tag"
        item={editingItem}
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => { setOpen(false); router.refresh(); }}
        saveAction={saveAction}
        deleteAction={deleteAction}
        restoreFocusElement={restoreFocusElement}
      />
    </>
  );
}

function formatLanguages(languageCodes: string[]) {
  return languageCodes.length > 0 ? languageCodes.map((code) => code.toUpperCase()).join(", ") : "—";
}
