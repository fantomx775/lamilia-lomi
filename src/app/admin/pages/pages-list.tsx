"use client";

import { AdminResourceList } from "@/components/admin/admin-resource-list";
import type { DataTableColumn } from "@/components/admin/data-table";

export type AdminPageListRow = {
  id: string;
  title: string;
  slug: string;
  languageCodes: string[];
  updatedAt: string;
};

const columns: DataTableColumn<AdminPageListRow>[] = [
  {
    id: "page",
    header: "Strona / tytuł",
    cell: (row) => <span className="font-medium text-[var(--color-ink)]">{row.title}</span>,
  },
  {
    id: "slug",
    header: "Slug / key",
    cell: (row) => <span className="font-mono text-xs">{row.slug}</span>,
  },
  {
    id: "languages",
    header: "Języki",
    cell: (row) => formatLanguages(row.languageCodes),
  },
  {
    id: "updated",
    header: "Ostatnia aktualizacja",
    cell: (row) => row.updatedAt,
  },
];

export function PagesResourceList({ rows }: { rows: AdminPageListRow[] }) {
  return (
    <AdminResourceList
      title="Strony"
      description="Przeglądaj dostępne wersje językowe stron informacyjnych."
      searchPlaceholder="Szukaj stron…"
      searchAriaLabel="Szukaj stron"
      caption="Lista stron"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      getSearchText={(row) => [row.title, row.slug, ...row.languageCodes, row.updatedAt].join(" ")}
      emptyState={<p className="p-8 text-center text-sm text-[var(--color-muted)]">Brak stron.</p>}
    />
  );
}

function formatLanguages(languageCodes: string[]) {
  return languageCodes.length > 0 ? languageCodes.map((code) => code.toUpperCase()).join(", ") : "—";
}
