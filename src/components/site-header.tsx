import { BookOpen, Info, Library, LogIn } from "lucide-react";
import { Suspense } from "react";

import { NavigationLink } from "@/components/navigation-link";
import type { Locale } from "@/i18n/routing";
import { getHeaderAccountStateForRequest } from "@/lib/session.server";

import { buttonClassName } from "./ui/button";

export function SiteHeader({ locale }: {
  locale: Locale;
}) {
  const labels = {
    products: "Catalog",
    library: "My Library",
    about: "About",
    account: "Account",
    login: "Log in",
    navigation: "Primary navigation",
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-bg)]/92 backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <NavigationLink
          href={`/${locale}`}
          pendingLabel="Opening home"
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
        </NavigationLink>
        <nav aria-label={labels.navigation} className="hidden items-center gap-1 md:flex">
          <NavigationLink className={headerLinkClassName()} href={`/${locale}/products`} pendingLabel="Opening catalog">
            <BookOpen className="size-4" aria-hidden />
            {labels.products}
          </NavigationLink>
          <NavigationLink className={headerLinkClassName()} href={`/${locale}/about`} pendingLabel="Opening about page">
            <Info className="size-4" aria-hidden />
            {labels.about}
          </NavigationLink>
          <NavigationLink className={headerLinkClassName()} href={`/${locale}/library`} pendingLabel="Opening library">
            <Library className="size-4" aria-hidden />
            {labels.library}
          </NavigationLink>
        </nav>
        <div className="flex items-center gap-2">
          <Suspense fallback={<HeaderAccountFallback />}>
            <HeaderAccountLink locale={locale} labels={labels} />
          </Suspense>
        </div>
        <nav aria-label={labels.navigation} className="grid w-full grid-cols-3 gap-1 border-t border-[var(--color-border)] py-2 md:hidden">
          <NavigationLink className={headerLinkClassName("min-w-0 gap-1 px-2 text-xs")} href={`/${locale}/products`} pendingLabel="Opening catalog">
            <BookOpen className="size-4" aria-hidden />
            {labels.products}
          </NavigationLink>
          <NavigationLink className={headerLinkClassName("min-w-0 gap-1 px-2 text-xs")} href={`/${locale}/about`} pendingLabel="Opening about page">
            <Info className="size-4" aria-hidden />
            {labels.about}
          </NavigationLink>
          <NavigationLink className={headerLinkClassName("min-w-0 gap-1 px-2 text-xs")} href={`/${locale}/library`} pendingLabel="Opening library">
            <Library className="size-4" aria-hidden />
            {labels.library}
          </NavigationLink>
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
    <NavigationLink
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
      pendingLabel={isSignedIn ? "Opening account" : "Opening login"}
    >
      <LogIn className="size-4" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </NavigationLink>
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
