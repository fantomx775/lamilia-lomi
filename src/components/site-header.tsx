import { BookOpen, Library, LogIn } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import type { Locale } from "@/i18n/routing";
import { getHeaderAccountStateForRequest } from "@/lib/session.server";

import { LanguageSwitcher } from "./language-switcher";
import { buttonClassName } from "./ui/button";

export function SiteHeader({
  locale,
  showLanguageSwitcher = true,
}: {
  locale: Locale;
  showLanguageSwitcher?: boolean;
}) {
  const labels = {
    products: locale === "pl" ? "Katalog" : "Catalog",
    library: locale === "pl" ? "Moja biblioteka" : "My Library",
    account: locale === "pl" ? "Moje konto" : "Account",
    login: locale === "pl" ? "Logowanie" : "Log in",
    navigation: locale === "pl" ? "Główna nawigacja" : "Primary navigation",
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-bg)]/92 backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          href={`/${locale}`}
          className="flex items-center gap-3 rounded-sm transition-transform active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-terracotta)]"
        >
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
        <nav aria-label={labels.navigation} className="hidden items-center gap-1 md:flex">
          <Link className={headerLinkClassName()} href={`/${locale}/products`}>
            <BookOpen className="size-4" aria-hidden />
            {labels.products}
          </Link>
          <Link className={headerLinkClassName()} href={`/${locale}/library`}>
            <Library className="size-4" aria-hidden />
            {labels.library}
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          {showLanguageSwitcher ? <LanguageSwitcher locale={locale} /> : null}
          <Suspense fallback={<HeaderAccountFallback />}>
            <HeaderAccountLink locale={locale} labels={labels} />
          </Suspense>
        </div>
        <nav aria-label={labels.navigation} className="flex w-full items-center gap-2 border-t border-[var(--color-border)] py-2 md:hidden">
          <Link className={headerLinkClassName("flex-1")} href={`/${locale}/products`}>
            <BookOpen className="size-4" aria-hidden />
            {labels.products}
          </Link>
          <Link className={headerLinkClassName("flex-1")} href={`/${locale}/library`}>
            <Library className="size-4" aria-hidden />
            {labels.library}
          </Link>
        </nav>
      </div>
    </header>
  );
}

async function HeaderAccountLink({
  locale,
  labels,
}: {
  locale: Locale;
  labels: {
    account: string;
    login: string;
  };
}) {
  const accountState = await getHeaderAccountStateForRequest();
  const isSignedIn = accountState?.isSignedIn ?? false;
  const label = isSignedIn ? labels.account : labels.login;

  return (
    <Link
      aria-label={label}
      className={buttonClassName({
        variant: isSignedIn ? "outline" : "default",
        size: "sm",
        className:
          "min-h-10 transition-transform active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]",
      })}
      href={
        isSignedIn
          ? accountState?.isAdmin
            ? "/admin"
            : `/${locale}/account`
          : `/${locale}/login`
      }
    >
      <LogIn className="size-4" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}

function HeaderAccountFallback() {
  return (
    <span
      aria-hidden="true"
      className="h-10 w-10 rounded-md bg-[var(--color-border)] motion-safe:animate-pulse motion-reduce:animate-none sm:w-24"
    />
  );
}

function headerLinkClassName(className?: string) {
  return buttonClassName({
    variant: "ghost",
    size: "sm",
    className: `min-h-10 transition-transform active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] ${className ?? ""}`,
  });
}
