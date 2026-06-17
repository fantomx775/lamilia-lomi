import { Box, FileText, LayoutDashboard, Settings, Tags, Users } from "lucide-react";
import Link from "next/link";

import { DashboardShell, type DashboardNavItem } from "@/components/dashboard-shell";
import { SiteHeader } from "@/components/site-header";
import { buttonClassName } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { hasAdminAccess } from "@/lib/auth";
import { getDemoSession } from "@/lib/session.server";

const nav: DashboardNavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/products", label: "Produkty", icon: Box },
  { href: "/admin/categories", label: "Kategorie", icon: Tags },
  { href: "/admin/tags", label: "Tagi", icon: Tags },
  { href: "/admin/users", label: "Użytkownicy", icon: Users },
  { href: "/admin/pages", label: "Strony", icon: FileText },
  { href: "/admin/settings", label: "Ustawienia", icon: Settings },
];

export const metadata = {
  title: "Panel admina | LamiliaLomi",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getDemoSession();

  if (!session || !hasAdminAccess(session)) {
    return (
      <>
        <SiteHeader locale="pl" showLanguageSwitcher={false} />
        <main className="grid min-h-[calc(100vh-4rem)] place-items-center bg-[var(--color-bg)] px-4">
          <Card className="max-w-md">
            <CardHeader>
              <h1 className="font-serif text-3xl font-semibold">Brak dostępu</h1>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Panel admina jest dostępny tylko dla użytkownika z rolą admin.
                Zaloguj się jako `admin@lamilialomi.test`, aby zobaczyć tryb demo.
              </p>
              <Link className={buttonClassName({ className: "mt-5" })} href="/pl/login?redirectTo=/admin">
                Logowanie demo
              </Link>
            </CardContent>
          </Card>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader locale={session.preferredLocale} showLanguageSwitcher={false} />
      <DashboardShell nav={nav} title="LamiliaLomi" subtitle="Panel administracyjny">
        {children}
      </DashboardShell>
    </>
  );
}
