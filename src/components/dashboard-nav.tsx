"use client";

import {
  Box,
  BookOpen,
  FileText,
  Library,
  LayoutDashboard,
  Settings,
  Tags,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { buttonClassName } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DashboardNavItem = {
  href: string;
  label: string;
  icon: DashboardNavIcon;
};

const dashboardNavIcons = {
  account: UserRound,
  catalog: BookOpen,
  library: Library,
  dashboard: LayoutDashboard,
  products: Box,
  categories: Tags,
  tags: Tags,
  users: Users,
  pages: FileText,
  settings: Settings,
} satisfies Record<string, LucideIcon>;

export type DashboardNavIcon = keyof typeof dashboardNavIcons;

export function getActiveHref(pathname: string, nav: DashboardNavItem[]) {
  const sorted = [...nav].sort((a, b) => b.href.length - a.href.length);

  for (const item of sorted) {
    const isNestedRoute = item.href !== "/admin" && pathname.startsWith(`${item.href}/`);

    if (pathname === item.href || isNestedRoute) {
      return item.href;
    }
  }

  return null;
}

export function DashboardNav({ nav }: { nav: DashboardNavItem[] }) {
  const pathname = usePathname();
  const activeHref = getActiveHref(pathname, nav);

  return (
    <nav className="mt-5 grid grid-cols-2 gap-2 pb-1 lg:grid-cols-1 lg:pb-0">
      {nav.map((item) => {
        const isActive = item.href === activeHref;
        const Icon = dashboardNavIcons[item.icon];

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={buttonClassName({
              variant: "ghost",
              className: cn(
                "admin-motion min-w-0 w-full justify-start",
                isActive && "bg-[var(--color-blush)] hover:bg-[var(--color-blush)]",
              ),
            })}
          >
            <Icon className="size-4" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
