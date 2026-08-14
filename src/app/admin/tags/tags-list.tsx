"use client";

import { AdminResourceList } from "@/components/admin/admin-resource-list";
import type { DataTableColumn } from "@/components/admin/data-table";

export type AdminTagListRow = {
  id: string;
  name: string;
  slug: string;
  productCount: number;
  languageCodes: string[];
};

const columns: DataTableColumn<AdminTagListRow>[] = [
  {
    id: "name",
    header: "Nazwa",
    cell: (row) => (
      <div className="min-w-0">
        <p className="font-medium text-[var(--color-ink)]">{row.name}</p>
        <p className="mt-1 truncate text-xs text-[var(--color-muted)]">{row.slug}</p>
      </div>
    ),
  },
  {
    id: "slug",
    header: "Slug",
    cell: (row) => <span className="font-mono text-xs">{row.slug}</span>,
  },
  {
    id: "products",
    header: "Produkty",
    cell: (row) => row.productCount,
  },
  {
    id: "languages",
    header: "Języki",
    cell: (row) => formatLanguages(row.languageCodes),
  },
];

export function TagsResourceList({ rows }: { rows: AdminTagListRow[] }) {
  return (
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
      emptyState={<p className="p-8 text-center text-sm text-[var(--color-muted)]">Brak tagów.</p>}
    />
  );
}

function formatLanguages(languageCodes: string[]) {
  return languageCodes.length > 0 ? languageCodes.map((code) => code.toUpperCase()).join(", ") : "—";
}
