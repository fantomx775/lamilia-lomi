import { AdminPageTransition } from "@/components/admin-page-transition";
import { DashboardNav, type DashboardNavItem } from "@/components/dashboard-nav";
import { NavigationLink } from "@/components/navigation-link";
import { cn } from "@/lib/utils";

export type { DashboardNavItem };

export function DashboardShell({
  children,
  nav,
  title,
  subtitle,
  className,
  hideMobileNav = false,
}: {
  children: React.ReactNode;
  nav: DashboardNavItem[];
  title: string;
  subtitle: string;
  className?: string;
  hideMobileNav?: boolean;
}) {
  const Content = hideMobileNav ? "div" : "main";
  return (
    <div
      className={cn(
        "min-h-[calc(100vh-4rem)] bg-[var(--color-bg)]",
        className,
      )}
    >
      <aside className={cn("min-w-0 border-b border-[var(--color-border)] bg-white/72 px-4 py-4 lg:fixed lg:inset-y-16 lg:left-0 lg:w-64 lg:border-b-0 lg:border-r lg:px-5", hideMobileNav && "hidden lg:block")}>
        <NavigationLink
          href={nav[0]?.href ?? "/"}
          pendingLabel="Otwieranie panelu administracyjnego"
          className="block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-terracotta)] active:opacity-70"
        >
          <span className="block font-serif text-2xl font-semibold text-[var(--color-ink)]">
            {title}
          </span>
          <span className="mt-1 block text-xs text-[var(--color-muted)]">{subtitle}</span>
        </NavigationLink>
        <DashboardNav nav={nav} />
      </aside>
      <Content className="min-w-0 lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <AdminPageTransition>{children}</AdminPageTransition>
        </div>
      </Content>
    </div>
  );
}
