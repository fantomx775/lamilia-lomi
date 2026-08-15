"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { AdminDrawer } from "@/components/admin/admin-drawer";
import { AdminResourceList } from "@/components/admin/admin-resource-list";
import type { DataTableColumn } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import type { UserRole } from "@/lib/types";
import Link from "next/link";

export type AdminUserListRow = {
  id: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  marketingConsent: boolean;
  unlockCount: number;
  unlockedProducts?: string[];
};

function buildColumns(onOpen: (id: string, trigger: HTMLElement) => void): DataTableColumn<AdminUserListRow>[] {
  return [
    {
      id: "user",
      header: "Użytkownik / email",
      cell: (row) => (
        <button
          type="button"
          onClick={(event) => onOpen(row.id, event.currentTarget)}
          aria-label={`Pokaż szczegóły użytkownika ${row.email}`}
          className="group inline-flex min-w-0 items-center gap-2 rounded-md text-left font-medium text-[var(--color-ink)] hover:text-[var(--color-terracotta)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
        >
          <UserRound className="size-4 shrink-0 text-[var(--color-muted)]" aria-hidden />
          <span className="truncate">{row.email}</span>
        </button>
      ),
    },
    {
      id: "role",
      header: "Rola",
      cell: (row) => <Badge className={row.role === "admin" ? "border-purple-200 bg-purple-50 text-purple-900" : ""}>{row.role === "admin" ? "Administrator" : "Użytkownik"}</Badge>,
    },
    {
      id: "verification",
      header: "Weryfikacja",
      cell: (row) => <Badge className={row.emailVerified ? "border-emerald-200 bg-emerald-50 text-emerald-900" : ""}>{row.emailVerified ? "Zweryfikowany" : "Niezweryfikowany"}</Badge>,
    },
    { id: "marketing", header: "Marketing consent", cell: (row) => row.marketingConsent ? "Tak" : "Nie" },
    { id: "unlocks", header: "Odblokowania", cell: (row) => row.unlockCount },
  ];
}

export function UsersResourceList({ rows }: { rows: AdminUserListRow[] }) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoreFocusElement, setRestoreFocusElement] = useState<HTMLElement | null>(null);
  const selected = rows.find((row) => row.id === selectedId);
  const openUser = (id: string, trigger: HTMLElement | null) => {
    setRestoreFocusElement(trigger);
    setSelectedId(id);
    setOpen(true);
  };

  return (
    <>
      <AdminResourceList
        title="Użytkownicy"
        description="Przeglądaj konta, role i zgody marketingowe użytkowników."
        searchPlaceholder="Szukaj użytkowników…"
        searchAriaLabel="Szukaj użytkowników"
        caption="Lista użytkowników"
        rows={rows}
        columns={buildColumns(openUser)}
        getRowId={(row) => row.id}
        getSearchText={(row) => [row.email, row.role, row.emailVerified ? "verified zweryfikowany" : "unverified niezweryfikowany"].join(" ")}
        onRowActivate={(row, trigger) => openUser(row.id, trigger)}
        toolbarActions={<Link className={buttonClassName({ variant: "outline", size: "sm" })} href="/admin/users/export?marketingOnly=1">Eksport marketing CSV</Link>}
        renderMobileCard={(row) => (
          <button
            type="button"
            onClick={(event) => openUser(row.id, event.currentTarget)}
            className="group block w-full min-w-0 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
            aria-label={`Pokaż szczegóły użytkownika ${row.email}`}
          >
            <p className="truncate font-medium text-[var(--color-ink)] group-hover:text-[var(--color-terracotta)]">{row.email}</p>
            <p className="mt-1 text-sm text-[var(--color-muted)]">{row.role === "admin" ? "Administrator" : "Użytkownik"} · {row.unlockCount} odblokowań</p>
          </button>
        )}
        emptyState={<p className="p-8 text-center text-sm text-[var(--color-muted)]">Brak użytkowników.</p>}
      />
      <AdminDrawer
        open={open}
        onClose={() => setOpen(false)}
        title="Szczegóły użytkownika"
        description={selected?.email}
        restoreFocusElement={restoreFocusElement}
      >
        {selected ? <UserDetails row={selected} /> : null}
      </AdminDrawer>
    </>
  );
}

function UserDetails({ row }: { row: AdminUserListRow }) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Detail label="Email" value={row.email} />
        <Detail label="Rola" value={row.role === "admin" ? "Administrator" : "Użytkownik"} />
        <Detail label="Weryfikacja" value={row.emailVerified ? "Zweryfikowany" : "Niezweryfikowany"} />
        <Detail label="Zgoda marketingowa" value={row.marketingConsent ? "Tak" : "Nie"} />
      </div>
      <div className="rounded-lg border border-[var(--color-border)] bg-white p-4">
        <p className="text-sm font-semibold">Odblokowane produkty</p>
        {row.unlockedProducts?.length ? (
          <ul className="mt-3 grid gap-2 text-sm text-[var(--color-muted)]">
            {row.unlockedProducts.map((product) => <li key={product}>{product}</li>)}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--color-muted)]">Brak odblokowanych produktów.</p>
        )}
      </div>
      <p className="text-xs leading-5 text-[var(--color-muted)]">Ten panel jest obecnie tylko do odczytu. System nie udostępnia bezpiecznego admin CRUD dla użytkowników.</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-[var(--color-border)] bg-white p-4"><p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">{label}</p><p className="mt-1 break-words text-sm font-medium">{value}</p></div>;
}
