import Link from "next/link";

import { getCommunityAdminAccess } from "@/lib/community/admin-http";
import CommunityReports from "./community-reports";

export const dynamic = "force-dynamic";

export default async function CommunityReportsPage() {
  const access = await getCommunityAdminAccess();
  if (access.response) return <section role="alert" className="m-4 rounded-2xl border border-[var(--color-border)] bg-white p-6"><h1 className="font-serif text-2xl font-semibold">Brak dostępu do zgłoszeń</h1><p className="mt-2 text-sm text-[var(--color-muted)]">Zaloguj się na zweryfikowane konto administratora.</p></section>;
  return <section className="space-y-5 p-4 sm:p-6" data-testid="community-reports-page">
    <header className="space-y-2"><Link href="/admin/community" className="text-sm font-medium underline">← Moderacja prac</Link><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-muted)]">Panel administracyjny</p><h1 className="font-serif text-3xl font-semibold text-[var(--color-ink)]">Zgłoszenia społeczności</h1><p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)]">Zgłoszenia są prywatne. Dane kontaktowe i adresy IP nie są wyświetlane.</p></header>
    <CommunityReports />
  </section>;
}
