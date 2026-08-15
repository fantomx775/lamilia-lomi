"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type DataTableColumn<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  mobileLabel?: ReactNode;
  headerClassName?: string;
  cellClassName?: string;
};

type DataTableProps<T> = {
  caption: string;
  columns: DataTableColumn<T>[];
  data: T[];
  getRowId: (row: T) => string;
  emptyState: ReactNode;
  loadingState?: ReactNode;
  isLoading?: boolean;
  renderMobileCard?: (row: T) => ReactNode;
  getRowHref?: (row: T) => string;
  onRowActivate?: (row: T, triggerElement: HTMLElement | null) => void;
  className?: string;
};

const INTERACTIVE_SELECTOR =
  "a, button, input, select, textarea, summary, [role='button'], [role='link'], [contenteditable='true']";

export function DataTable<T>({
  caption,
  columns,
  data,
  getRowId,
  emptyState,
  loadingState = <p className="p-8 text-center text-sm text-[var(--color-muted)]">Ładowanie…</p>,
  isLoading = false,
  renderMobileCard,
  getRowHref,
  onRowActivate,
  className,
}: DataTableProps<T>) {
  const router = useRouter();
  const hasRowActivation = Boolean(getRowHref || onRowActivate);
  const renderDefaultMobileCard = (row: T) => (
    <dl className="grid gap-3">
      {columns.map((column) => (
        <div key={column.id} className="grid gap-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
            {column.mobileLabel ?? column.header}
          </dt>
          <dd className="min-w-0 text-sm text-[var(--color-ink)]">{column.cell(row)}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <div data-slot="data-table" className={cn("min-w-0", className)}>
      <div className="hidden overflow-hidden rounded-lg border border-[var(--color-border)] lg:block">
        {isLoading ? (
          loadingState
        ) : data.length === 0 ? (
          emptyState
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
              <caption className="sr-only">{caption}</caption>
              <thead className="bg-white/80 text-xs uppercase tracking-wide text-[var(--color-muted)]">
                <tr className="border-b border-[var(--color-border)]">
                  {columns.map((column) => (
                    <th
                      key={column.id}
                      className={cn("px-4 py-3 font-medium", column.headerClassName)}
                      scope="col"
                    >
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr
                    key={getRowId(row)}
                    className={cn(
                      "border-b border-[var(--color-border)] last:border-b-0",
                      hasRowActivation &&
                        "admin-motion cursor-pointer hover:bg-[var(--color-bg-alt)] focus-within:bg-[var(--color-bg-alt)]",
                    )}
                    onClick={
                      hasRowActivation
                        ? (event) => {
                            if (isInteractiveTarget(event.target, event.currentTarget)) {
                              return;
                            }

                            if (getRowHref) {
                              router.push(getRowHref(row));
                              return;
                            }

                            onRowActivate?.(row, getRowTrigger(event.currentTarget));
                          }
                        : undefined
                    }
                  >
                    {columns.map((column) => (
                      <td
                        key={column.id}
                        className={cn("px-4 py-4 align-middle", column.cellClassName)}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:hidden">
        {isLoading ? (
          <div className="rounded-lg border border-[var(--color-border)] bg-white/70">
            {loadingState}
          </div>
        ) : data.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border)] bg-white/70">
            {emptyState}
          </div>
        ) : (
          data.map((row) => (
            <div
              key={getRowId(row)}
              className="min-w-0 rounded-lg border border-[var(--color-border)] bg-white/70 p-4"
            >
              {renderMobileCard ? renderMobileCard(row) : renderDefaultMobileCard(row)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function isInteractiveTarget(target: EventTarget | null, currentTarget: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  const interactiveTarget = target.closest(INTERACTIVE_SELECTOR);

  return Boolean(interactiveTarget && interactiveTarget !== currentTarget);
}

function getRowTrigger(row: HTMLTableRowElement) {
  return row.querySelector<HTMLElement>(
    "td:first-child button, td:first-child a[href], td:first-child [role='button'], td:first-child [role='link']",
  );
}
