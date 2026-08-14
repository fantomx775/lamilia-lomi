"use client";

import { useMemo, useState } from "react";

import {
  DataTable,
  type DataTableColumn,
} from "@/components/admin/data-table";
import { AdminResourceTableShell } from "@/components/admin/admin-resource-table-shell";

type AdminResourceListProps<T> = {
  title: string;
  description?: string;
  searchPlaceholder: string;
  searchAriaLabel: string;
  caption: string;
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  getSearchText: (row: T) => string;
  toolbarActions?: React.ReactNode;
  filters?: React.ReactNode;
  emptyState: React.ReactNode;
  noResultsState?: React.ReactNode;
  isLoading?: boolean;
  loadingState?: React.ReactNode;
  resultsLabel?: (visibleCount: number) => string;
};

export function AdminResourceList<T>({
  title,
  description,
  searchPlaceholder,
  searchAriaLabel,
  caption,
  rows,
  columns,
  getRowId,
  getSearchText,
  toolbarActions,
  filters,
  emptyState,
  noResultsState = <p className="p-8 text-center text-sm text-[var(--color-muted)]">Brak wyników.</p>,
  isLoading = false,
  loadingState,
  resultsLabel = defaultResultsLabel,
}: AdminResourceListProps<T>) {
  const [searchValue, setSearchValue] = useState("");
  const normalizedSearch = normalizeResourceSearchText(searchValue);
  const filteredRows = useMemo(() => {
    if (!normalizedSearch) {
      return rows;
    }

    return rows.filter((row) =>
      normalizeResourceSearchText(getSearchText(row)).includes(normalizedSearch),
    );
  }, [getSearchText, normalizedSearch, rows]);

  const visibleEmptyState = normalizedSearch ? noResultsState : emptyState;

  return (
    <AdminResourceTableShell
      title={title}
      description={description}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      searchPlaceholder={searchPlaceholder}
      searchAriaLabel={searchAriaLabel}
      resultsLabel={resultsLabel(filteredRows.length)}
      toolbarActions={toolbarActions}
      filters={filters}
    >
      <DataTable
        caption={caption}
        columns={columns}
        data={filteredRows}
        getRowId={getRowId}
        emptyState={visibleEmptyState}
        isLoading={isLoading}
        loadingState={loadingState}
      />
    </AdminResourceTableShell>
  );
}

export function normalizeResourceSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[łŁ]/g, "l")
    .toLocaleLowerCase()
    .trim();
}

function defaultResultsLabel(count: number) {
  if (count === 1) {
    return "1 wynik";
  }

  if (count >= 2 && count <= 4) {
    return `${count} wyniki`;
  }

  return `${count} wyników`;
}
