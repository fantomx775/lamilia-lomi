"use client";

import { Plus } from "lucide-react";
import Link from "next/link";

import { AdminResourceList } from "@/components/admin/admin-resource-list";
import type { DataTableColumn } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import type { Audience, ProductStatus } from "@/lib/types";

export type AdminProductListRow = {
  id: string;
  title: string;
  slug: string;
  status: ProductStatus;
  audience: Audience;
  productType: string;
  languageCodes: string[];
};

const statusLabels: Record<ProductStatus, string> = {
  draft: "Szkic",
  published: "Opublikowany",
  archived: "Zarchiwizowany",
};

const statusClasses: Record<ProductStatus, string> = {
  draft: "border-amber-200 bg-amber-50 text-amber-900",
  published: "border-emerald-200 bg-emerald-50 text-emerald-900",
  archived: "border-slate-200 bg-slate-100 text-slate-700",
};

const columns: DataTableColumn<AdminProductListRow>[] = [
  {
    id: "product",
    header: "Produkt",
    cell: (row) => (
      <Link
        href={`/admin/products/${row.id}`}
        className="group block min-w-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
      >
        <p className="font-medium text-[var(--color-ink)] group-hover:text-[var(--color-terracotta)]">{row.title}</p>
        <p className="mt-1 truncate text-xs text-[var(--color-muted)]">{row.slug}</p>
      </Link>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: (row) => <Badge className={statusClasses[row.status]}>{statusLabels[row.status]}</Badge>,
  },
  {
    id: "audience",
    header: "Segment",
    cell: (row) => (row.audience === "kids" ? "Dzieci" : "Dorośli"),
  },
  {
    id: "product-type",
    header: "Typ produktu",
    cell: (row) => formatProductType(row.productType),
  },
  {
    id: "languages",
    header: "Języki",
    cell: (row) => formatLanguages(row.languageCodes),
  },
];

export function ProductsResourceList({ rows }: { rows: AdminProductListRow[] }) {
  return (
    <AdminResourceList
      title="Produkty"
      description="Przeglądaj katalog produktów i ich aktualny status."
      searchPlaceholder="Szukaj produktów…"
      searchAriaLabel="Szukaj produktów"
      caption="Lista produktów"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      getSearchText={(row) =>
        [row.title, row.slug, row.status, row.audience, row.productType, ...row.languageCodes].join(" ")
      }
      toolbarActions={
        <Link className={buttonClassName({ size: "sm" })} href="/admin/products/new">
          <Plus className="size-4" aria-hidden />
          Nowy produkt
        </Link>
      }
      renderMobileCard={(row) => (
        <Link
          href={`/admin/products/${row.id}`}
          className="group block min-w-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
          aria-label={`Edytuj produkt ${row.title}`}
        >
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-[var(--color-ink)] group-hover:text-[var(--color-terracotta)]">{row.title}</p>
              <p className="mt-1 truncate text-xs text-[var(--color-muted)]">{row.slug}</p>
            </div>
            <Badge className={statusClasses[row.status]}>{statusLabels[row.status]}</Badge>
          </div>
          <p className="mt-4 text-sm text-[var(--color-muted)]">
            {row.audience === "kids" ? "Dzieci" : "Dorośli"} · {formatProductType(row.productType)} · {formatLanguages(row.languageCodes)}
          </p>
        </Link>
      )}
      emptyState={<p className="p-8 text-center text-sm text-[var(--color-muted)]">Brak produktów.</p>}
    />
  );
}

function formatProductType(value: string) {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatLanguages(languageCodes: string[]) {
  return languageCodes.length > 0 ? languageCodes.map((code) => code.toUpperCase()).join(", ") : "—";
}
