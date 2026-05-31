import { BookOpen, LayoutDashboard, Library, LogIn } from "lucide-react";

import type { Locale } from "@/i18n/routing";
import { getDemoSession } from "@/lib/session.server";

import { LanguageSwitcher } from "./language-switcher";
import { buttonClassName } from "./ui/button";
import Link from "next/link";

export async function SiteHeader({ locale }: { locale: Locale }) {
  const session = await getDemoSession();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-bg)]/92 backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link href={`/${locale}`} className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-[var(--color-sage)] font-serif text-lg font-semibold text-[var(--color-ink)]">
            LL
          </span>
          <span className="min-w-0">
            <span className="block font-serif text-xl font-semibold text-[var(--color-ink)]">
              LamiliaLomi
            </span>
            <span className="hidden text-xs text-[var(--color-muted)] sm:block">
              Premium creative books
            </span>
          </span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          <Link className={buttonClassName({ variant: "ghost", size: "sm" })} href={`/${locale}/products`}>
            <BookOpen className="size-4" aria-hidden />
            Catalog
          </Link>
          <Link className={buttonClassName({ variant: "ghost", size: "sm" })} href={`/${locale}/library`}>
            <Library className="size-4" aria-hidden />
            Library
          </Link>
          <Link className={buttonClassName({ variant: "ghost", size: "sm" })} href="/admin">
            <LayoutDashboard className="size-4" aria-hidden />
            Admin
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <Link
            className={buttonClassName({ variant: session ? "outline" : "default", size: "sm" })}
            href={session ? `/${locale}/account` : `/${locale}/login`}
          >
            <LogIn className="size-4" aria-hidden />
            <span className="hidden sm:inline">{session ? "Account" : "Log in"}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
