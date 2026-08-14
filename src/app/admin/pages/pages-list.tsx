"use client";

import { AdminResourceList } from "@/components/admin/admin-resource-list";
import type { DataTableColumn } from "@/components/admin/data-table";
import Link from "next/link";

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
    cell: (row) => (
      <Link
        href={`/admin/pages/${row.slug}`}
        className="group block rounded-md font-medium text-[var(--color-ink)] hover:text-[var(--color-terracotta)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
      >
        {row.title}
      </Link>
    ),
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
      renderMobileCard={(row) => (
        <Link
          href={`/admin/pages/${row.slug}`}
          className="group block min-w-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
          aria-label={`Edytuj stronę ${row.title}`}
        >
          <p className="truncate font-medium text-[var(--color-ink)] group-hover:text-[var(--color-terracotta)]">{row.title}</p>
          <p className="mt-1 truncate font-mono text-xs text-[var(--color-muted)]">{row.slug}</p>
          <p className="mt-4 text-sm text-[var(--color-muted)]">{formatLanguages(row.languageCodes)} · {row.updatedAt}</p>
        </Link>
      )}
      emptyState={<p className="p-8 text-center text-sm text-[var(--color-muted)]">Brak stron.</p>}
    />
  );
}

function formatLanguages(languageCodes: string[]) {
  return languageCodes.length > 0 ? languageCodes.map((code) => code.toUpperCase()).join(", ") : "—";
}
