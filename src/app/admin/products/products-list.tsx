"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AdminResourceList } from "@/components/admin/admin-resource-list";
import { ImageWithFallback } from "@/components/image-with-fallback";
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
  coverPath?: string;
  collectionName?: string | null;
  categoryNames?: string[];
  tagNames?: string[];
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
        aria-label={`Edytuj produkt ${row.title}`}
        className="group block min-w-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="relative size-12 shrink-0 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]">
            <ImageWithFallback src={row.coverPath} alt={row.title} className="object-contain p-0.5" sizes="48px" />
          </span>
          <span className="min-w-0">
            <span title={row.title} className="line-clamp-2 [overflow-wrap:anywhere] font-medium text-[var(--color-ink)] group-hover:text-[var(--color-terracotta)]">{row.title}</span>
            <span className="mt-1 block truncate text-xs text-[var(--color-muted)]">{row.slug}</span>
          </span>
        </span>
      </Link>
    ),
    headerClassName: "w-[22%]",
  },
  {
    id: "status",
    header: "Status",
    cell: (row) => <Badge className={`${statusClasses[row.status]} shrink-0 whitespace-nowrap`}>{statusLabels[row.status]}</Badge>,
    headerClassName: "w-[18%] whitespace-nowrap",
  },
  {
    id: "audience",
    header: "Segment",
    cell: (row) => (row.audience === "kids" ? "Dzieci" : "Dorośli"),
    headerClassName: "w-[8%]",
  },
  {
    id: "product-type",
    header: "Typ produktu",
    cell: (row) => formatProductType(row.productType),
    headerClassName: "w-[12%]",
  },
  {
    id: "collection",
    header: "Kolekcja",
    cell: (row) => row.collectionName
      ? <Badge className="max-w-36 truncate" title={row.collectionName}>{row.collectionName}</Badge>
      : <span aria-label="Bez kolekcji">—</span>,
    headerClassName: "w-[12%]",
    cellClassName: "max-w-40",
  },
  {
    id: "categories",
    header: "Kategorie",
    cell: (row) => <CompactBadgeList rowId={row.id} kind="category" labels={row.categoryNames ?? []} />,
    headerClassName: "w-[14%]",
    cellClassName: "max-w-48",
  },
  {
    id: "tags",
    header: "Tagi",
    cell: (row) => <CompactBadgeList rowId={row.id} kind="tag" labels={row.tagNames ?? []} />,
    headerClassName: "w-[14%]",
    cellClassName: "max-w-48",
  },
];

export function ProductsResourceList({ rows }: { rows: AdminProductListRow[] }) {
  const router = useRouter();

  return (
    <AdminResourceList
      title="Produkty"
      description="Przeglądaj katalog produktów i ich aktualny status."
      searchPlaceholder="Szukaj produktów…"
      searchAriaLabel="Szukaj produktów"
      caption="Lista produktów"
      desktopBreakpoint="xl"
      tableLayout="fixed"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      getRowHref={(row) => `/admin/products/${row.id}`}
      getSearchText={(row) =>
        [row.title, row.slug, row.status, row.audience, row.productType, row.collectionName, ...(row.categoryNames ?? []), ...(row.tagNames ?? [])].join(" ")
      }
      toolbarActions={
        <Link className={buttonClassName({ size: "sm" })} href="/admin/products/new">
          <Plus className="size-4" aria-hidden />
          Nowy produkt
        </Link>
      }
      renderMobileCard={(row) => (
        <div
          className="group grid min-w-0 cursor-pointer gap-3 rounded-md hover:bg-[var(--color-bg-alt)]"
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest("a, button, [role='button'], [role='link']")) {
              return;
            }

            router.push(`/admin/products/${row.id}`);
          }}
        >
          <Link
            href={`/admin/products/${row.id}`}
            className="admin-motion group block min-w-0 cursor-pointer rounded-md p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] hover:bg-[var(--color-bg-alt)]"
            aria-label={`Edytuj produkt ${row.title}`}
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <span className="relative size-14 shrink-0 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]">
                <ImageWithFallback src={row.coverPath} alt={row.title} className="object-contain p-0.5" sizes="56px" />
              </span>
              <div className="min-w-0">
                <p title={row.title} className="line-clamp-2 [overflow-wrap:anywhere] font-medium text-[var(--color-ink)] group-hover:text-[var(--color-terracotta)]">{row.title}</p>
                <p className="mt-1 truncate text-xs text-[var(--color-muted)]">{row.slug}</p>
              </div>
              <Badge className={`${statusClasses[row.status]} shrink-0 whitespace-nowrap`}>{statusLabels[row.status]}</Badge>
            </div>
            <p className="mt-3 text-sm text-[var(--color-muted)]">
              {row.audience === "kids" ? "Dzieci" : "Dorośli"} · {formatProductType(row.productType)}
            </p>
          </Link>
          <dl className="grid gap-2 border-t border-[var(--color-border)] pt-3 text-sm">
            <MobileLabel label="Kolekcja">{row.collectionName ? <Badge className="max-w-56 truncate" title={row.collectionName}>{row.collectionName}</Badge> : <span aria-label="Bez kolekcji">—</span>}</MobileLabel>
            <MobileLabel label="Kategorie"><CompactBadgeList rowId={`${row.id}-mobile`} kind="category" labels={row.categoryNames ?? []} /></MobileLabel>
            <MobileLabel label="Tagi"><CompactBadgeList rowId={`${row.id}-mobile`} kind="tag" labels={row.tagNames ?? []} /></MobileLabel>
          </dl>
        </div>
      )}
      emptyState={<p className="p-8 text-center text-sm text-[var(--color-muted)]">Brak produktów.</p>}
    />
  );
}

function CompactBadgeList({ rowId, kind, labels }: { rowId: string; kind: "category" | "tag"; labels: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const instanceId = useId();
  const emptyLabel = kind === "category" ? "kategorii" : "tagów";
  const collectionLabel = kind === "category" ? "kategorie" : "tagi";
  if (!labels.length) return <span aria-label={`Brak ${emptyLabel}`}>—</span>;

  const visible = labels.slice(0, 2);
  const hidden = labels.slice(2);
  const detailsId = `product-${rowId}-${kind.replaceAll(" ", "-")}-${instanceId}`;

  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {visible.map((label, index) => (
          <Badge key={`${label}-${index}`} className="max-w-32 truncate px-2" title={label}>{label}</Badge>
        ))}
        {hidden.length ? (
          <button
            id={`${detailsId}-trigger`}
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-haspopup="true"
            aria-label={`${expanded ? "Ukryj" : "Pokaż"} ${formatHiddenBadgeCount(hidden.length, kind)}`}
            popoverTarget={detailsId}
            popoverTargetAction="toggle"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex min-h-7 items-center rounded-md border border-[var(--color-border)] bg-white px-2 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
          >
            +{hidden.length}
          </button>
        ) : null}
      </div>
      {hidden.length ? (
        <div
          id={detailsId}
          popover="auto"
          role="group"
          aria-label={`Pozostałe ${collectionLabel}`}
          onToggle={(event) => setExpanded(event.currentTarget.matches(":popover-open"))}
          onClick={(event) => event.stopPropagation()}
          className="m-0 inset-auto w-[min(28rem,calc(100vw-2rem))] max-h-[min(28rem,calc(100dvh-2rem))] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-white p-3 text-xs text-[var(--color-ink)] shadow-xl [position-area:bottom] [position-try-fallbacks:flip-block]"
        >
          <p className="mb-2 font-medium">Pozostałe {collectionLabel}</p>
          <ul className="grid gap-1 text-[var(--color-muted)]">
            {hidden.map((label, index) => <li key={`${label}-${index}`} className="break-words">{label}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function formatHiddenBadgeCount(count: number, kind: "category" | "tag") {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  if (count === 1) return kind === "category" ? "1 kolejną kategorię" : "1 kolejny tag";
  if (lastTwoDigits < 12 || lastTwoDigits > 14) {
    if (lastDigit >= 2 && lastDigit <= 4) {
      return kind === "category" ? `${count} kolejne kategorie` : `${count} kolejne tagi`;
    }
  }
  return kind === "category" ? `${count} kolejnych kategorii` : `${count} kolejnych tagów`;
}

function MobileLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-2"><dt className="text-xs text-[var(--color-muted)]">{label}</dt><dd className="min-w-0">{children}</dd></div>;
}

function formatProductType(value: string) {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
