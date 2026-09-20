import Link from "next/link";
import { Suspense } from "react";

import { DashboardShell, type DashboardNavItem } from "@/components/dashboard-shell";
import { SiteHeader } from "@/components/site-header";
import { buttonClassName } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getAdminLayoutAccessForRequest } from "@/lib/session.server";

const nav: DashboardNavItem[] = [
  { href: "/admin", label: "Dashboard", icon: "dashboard" },
  { href: "/admin/products", label: "Produkty", icon: "products" },
  { href: "/admin/categories", label: "Kategorie", icon: "categories" },
  { href: "/admin/tags", label: "Tagi", icon: "tags" },
  { href: "/admin/users", label: "Użytkownicy", icon: "users" },
  { href: "/admin/pages", label: "Strony", icon: "pages" },
  { href: "/admin/settings", label: "Ustawienia", icon: "settings" },
];

export const metadata = {
  title: "Panel admina | LamiliaLomi",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AdminRouteLoading />}>
      <AdminAccessLayout>{children}</AdminAccessLayout>
    </Suspense>
  );
}

async function AdminAccessLayout({ children }: { children: React.ReactNode }) {
  const access = await getAdminLayoutAccessForRequest();

  if (!access) {
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
      <SiteHeader locale={access.preferredLocale} showLanguageSwitcher={false} />
      <DashboardShell nav={nav} title="LamiliaLomi" subtitle="Panel administracyjny">
        {children}
      </DashboardShell>
    </>
  );
}

function AdminRouteLoading() {
  return (
    <main data-testid="admin-route-loading" aria-busy="true" className="min-h-screen bg-[var(--color-bg)]">
      <p className="sr-only" role="status" aria-live="polite">Loading admin page</p>
      <div className="h-16 border-b border-[var(--color-border)] bg-white/80" />
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[15rem_1fr] lg:px-8">
        <div className="h-96 animate-pulse rounded-xl bg-white/80 motion-reduce:animate-none" />
        <div className="space-y-5">
          <div className="h-10 w-1/2 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="h-60 animate-pulse rounded-xl bg-white/80 motion-reduce:animate-none" />
        </div>
      </div>
    </main>
  );
}
