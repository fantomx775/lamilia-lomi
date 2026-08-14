"use client";

import Link from "next/link";

import { AdminResourceList } from "@/components/admin/admin-resource-list";
import type { DataTableColumn } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import type { UserRole } from "@/lib/types";

export type AdminUserListRow = {
  id: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  marketingConsent: boolean;
  unlockCount: number;
};

const columns: DataTableColumn<AdminUserListRow>[] = [
  {
    id: "user",
    header: "Użytkownik / email",
    cell: (row) => <span className="font-medium text-[var(--color-ink)]">{row.email}</span>,
  },
  {
    id: "role",
    header: "Rola",
    cell: (row) => (
      <Badge className={row.role === "admin" ? "border-purple-200 bg-purple-50 text-purple-900" : ""}>
        {row.role === "admin" ? "Administrator" : "Użytkownik"}
      </Badge>
    ),
  },
  {
    id: "verification",
    header: "Weryfikacja",
    cell: (row) => (
      <Badge className={row.emailVerified ? "border-emerald-200 bg-emerald-50 text-emerald-900" : ""}>
        {row.emailVerified ? "Zweryfikowany" : "Niezweryfikowany"}
      </Badge>
    ),
  },
  {
    id: "marketing",
    header: "Marketing consent",
    cell: (row) => (row.marketingConsent ? "Tak" : "Nie"),
  },
  {
    id: "unlocks",
    header: "Odblokowania",
    cell: (row) => row.unlockCount,
  },
];

export function UsersResourceList({ rows }: { rows: AdminUserListRow[] }) {
  return (
    <AdminResourceList
      title="Użytkownicy"
      description="Przeglądaj konta, role i zgody marketingowe użytkowników."
      searchPlaceholder="Szukaj użytkowników…"
      searchAriaLabel="Szukaj użytkowników"
      caption="Lista użytkowników"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      getSearchText={(row) =>
        [row.email, row.role, row.emailVerified ? "verified zweryfikowany" : "unverified niezweryfikowany"].join(" ")
      }
      toolbarActions={
        <Link className={buttonClassName({ variant: "outline", size: "sm" })} href="/admin/users/export?marketingOnly=1">
          Eksport marketing CSV
        </Link>
      }
      emptyState={<p className="p-8 text-center text-sm text-[var(--color-muted)]">Brak użytkowników.</p>}
    />
  );
}
