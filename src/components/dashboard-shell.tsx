import Link from "next/link";

import { AdminPageTransition } from "@/components/admin-page-transition";
import { DashboardNav, type DashboardNavItem } from "@/components/dashboard-nav";
import { cn } from "@/lib/utils";

export type { DashboardNavItem };

export function DashboardShell({
  children,
  nav,
  title,
  subtitle,
  className,
}: {
  children: React.ReactNode;
  nav: DashboardNavItem[];
  title: string;
  subtitle: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-h-[calc(100vh-4rem)] bg-[var(--color-bg)]",
        className,
      )}
    >
      <aside className="min-w-0 border-b border-[var(--color-border)] bg-white/72 px-4 py-4 lg:fixed lg:inset-y-16 lg:left-0 lg:w-64 lg:border-b-0 lg:border-r lg:px-5">
        <Link href={nav[0]?.href ?? "/"} className="block">
          <span className="block font-serif text-2xl font-semibold text-[var(--color-ink)]">
            {title}
          </span>
          <span className="mt-1 block text-xs text-[var(--color-muted)]">{subtitle}</span>
        </Link>
        <DashboardNav nav={nav} />
      </aside>
      <main className="min-w-0 lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <AdminPageTransition>{children}</AdminPageTransition>
        </div>
      </main>
    </div>
  );
}
