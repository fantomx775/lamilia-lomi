import { Box, FileText, LayoutDashboard, Settings, Tags, Users } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { buttonClassName } from "@/components/ui/button";
import { hasAdminAccess } from "@/lib/auth";
import { getDemoSession } from "@/lib/session.server";

const nav = [
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

  if (!hasAdminAccess(session)) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--color-bg)] px-4">
        <Card className="max-w-md">
          <CardHeader>
            <h1 className="font-serif text-3xl font-semibold">Brak dostępu</h1>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-[var(--color-muted)]">
              Panel admina jest dostępny tylko dla użytkownika z rolą admin.
              Zaloguj się jako `admin@lamilialomi.test`, aby zobaczyć tryb demo.
            </p>
            <Link className={buttonClassName({ className: "mt-5" })} href="/en/login?redirectTo=/admin">
              Logowanie demo
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-[var(--color-border)] bg-white/70 p-4 lg:block">
        <Link href="/admin" className="font-serif text-2xl font-semibold">
          LamiliaLomi Admin
        </Link>
        <nav className="mt-8 grid gap-2">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className={buttonClassName({ variant: "ghost", className: "justify-start" })}>
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
