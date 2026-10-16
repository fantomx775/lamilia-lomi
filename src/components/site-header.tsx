import { BookOpen, Info, Library, LogIn, UserPlus } from "lucide-react";
import { Suspense, type ReactNode } from "react";

import { MobileNavigation } from "@/components/mobile-navigation";
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
      <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <NavigationLink
          href={`/${locale}`}
          pendingLabel="Opening home"
          aria-label="LamiliaLomi home"
          className="flex items-center gap-3 rounded-sm transition-transform active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-terracotta)]"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[var(--color-sage)] font-serif text-lg font-semibold text-[var(--color-ink)] sm:size-10">
            LL
          </span>
          <span className="min-w-0 max-[360px]:hidden">
            <span className="block font-serif text-lg font-semibold text-[var(--color-ink)] sm:text-xl">
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
          <NavigationLink
            className={headerLinkClassName()}
            href={`/${locale}/about`}
            pendingLabel="Opening about page"
            showPendingBar={false}
          >
            <Info className="size-4" aria-hidden />
            {labels.about}
          </NavigationLink>
          <NavigationLink className={headerLinkClassName()} href={`/${locale}/library`} pendingLabel="Opening library">
            <Library className="size-4" aria-hidden />
            {labels.library}
          </NavigationLink>
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <Suspense fallback={<HeaderAccountFallback locale={locale} />}>
            <HeaderAccountLink locale={locale} labels={labels} />
          </Suspense>
          <MobileNavigation locale={locale}>
            <Suspense fallback={<MobileGuestAccountLinks locale={locale} />}>
              <MobileAccountLinks locale={locale} />
            </Suspense>
          </MobileNavigation>
        </div>
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
          "min-h-10 gap-1.5 px-3 transition-transform active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]",
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
      <span>{label}</span>
    </NavigationLink>
  );
}

function MobileAccountLink({
  href,
  label,
  icon,
  pendingLabel,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  pendingLabel: string;
}) {
  return (
    <NavigationLink
      href={href}
      pendingLabel={pendingLabel}
      className="flex min-h-11 items-center gap-3 rounded-lg px-3 font-medium hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
    >
      {icon}
      {label}
    </NavigationLink>
  );
}

async function MobileAccountLinks({ locale }: { locale: Locale }) {
  const accountState = await getHeaderAccountStateForRequest();

  if (!accountState?.isSignedIn) {
    return <MobileGuestAccountLinks locale={locale} />;
  }

  return (
    <MobileAccountLink
      href={accountState.isAdmin ? "/admin" : `/${locale}/account`}
      label="Account"
      icon={<LogIn className="size-4" aria-hidden />}
      pendingLabel="Opening account"
    />
  );
}

function MobileGuestAccountLinks({ locale }: { locale: Locale }) {
  return (
    <>
      <MobileAccountLink
        href={`/${locale}/login`}
        label="Log in"
        icon={<LogIn className="size-4" aria-hidden />}
        pendingLabel="Opening login"
      />
      <MobileAccountLink
        href={`/${locale}/register`}
        label="Sign up"
        icon={<UserPlus className="size-4" aria-hidden />}
        pendingLabel="Opening sign up"
      />
    </>
  );
}

function HeaderAccountFallback({ locale }: { locale: Locale }) {
  return (
    <NavigationLink
      href={`/${locale}/login`}
      pendingLabel="Opening login"
      aria-label="Log in"
      className={buttonClassName({
        size: "sm",
        className: "min-h-10 gap-1.5 px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]",
      })}
    >
      <LogIn className="size-4" aria-hidden />
      <span>Log in</span>
    </NavigationLink>
  );
}

function headerLinkClassName(className?: string) {
  return buttonClassName({
    variant: "ghost",
    size: "sm",
    className: `min-h-10 transition-transform active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] ${className ?? ""}`,
  });
}
