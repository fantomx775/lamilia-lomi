import { BookOpen, Info, Library, LogIn, Palette, UserRound } from "lucide-react";
import Image from "next/image";
import { Suspense } from "react";

import { logoutAction } from "@/app/actions";
import { mobileActionClass } from "@/components/mobile-header-styles";
import { MobileNavigation } from "@/components/mobile-navigation";
import { NavigationLink } from "@/components/navigation-link";
import type { Locale } from "@/i18n/routing";
import { getHeaderAccountStateForRequest } from "@/lib/session.server";
import { getMyCommunityProfile } from "@/lib/community/repository";
import { getCommunityFlags } from "@/lib/community-flags";

import { buttonClassName } from "./ui/button";

export function SiteHeader({ locale }: {
  locale: Locale;
}) {
  const labels = {
    products: "Catalog",
    library: "My Library",
    about: "About",
    navigation: "Primary navigation",
  };
  const flags = getCommunityFlags();
  const communityEnabled = flags.publicEnabled && locale === "en";

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <NavigationLink
          href={`/${locale}`}
          pendingLabel="Opening home"
          aria-label="LamiliaLomi home"
          className="flex items-center gap-3 rounded-sm transition-transform active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-terracotta)]"
        >
          <Image
            src="/assets/home/lamilia-lomi-logo.webp"
            alt=""
            aria-hidden
            width={1024}
            height={1024}
            sizes="(max-width: 640px) 56px, 64px"
            unoptimized
            loading="eager"
            className="size-14 shrink-0 object-contain sm:size-16"
          />
          <span className="min-w-0">
            <span className="block font-serif text-lg font-semibold text-[var(--color-ink)] sm:text-xl">
              LamiliaLomi
            </span>
            <span className="hidden text-xs text-[var(--color-muted)] sm:block">
              Premium creative books
            </span>
          </span>
        </NavigationLink>
        <nav aria-label={labels.navigation} className="hidden items-center gap-1 lg:flex">
          <NavigationLink className={headerLinkClassName()} href={`/${locale}/products`} pendingLabel="Opening catalog">
            <BookOpen className="size-4" aria-hidden />
            {labels.products}
          </NavigationLink>
          {communityEnabled && locale === "en" ? <NavigationLink className={headerLinkClassName()} href="/en/club" pendingLabel="Opening Coloring Club"><Palette className="size-4" aria-hidden />Coloring Club</NavigationLink> : null}
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
          <Suspense fallback={<HeaderAccountControls locale={locale} communityEnabled={communityEnabled} />}>
            <HeaderSessionControls locale={locale} communityEnabled={communityEnabled} uploadsEnabled={flags.uploadsEnabled} />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

async function HeaderSessionControls({ locale, communityEnabled, uploadsEnabled }: {
  locale: Locale;
  communityEnabled: boolean;
  uploadsEnabled: boolean;
}) {
  const account = await getHeaderAccountStateForRequest();
  const showCreations = Boolean(account?.emailVerified && (uploadsEnabled || await getMyCommunityProfile().catch(() => null)));
  return <HeaderAccountControls locale={locale} communityEnabled={communityEnabled}
    accountHref={account ? (account.isAdmin ? "/admin" : `/${locale}/account`) : undefined}
    showCreations={showCreations} />;
}

function HeaderAccountControls({ locale, communityEnabled, accountHref, showCreations }: {
  locale: Locale;
  communityEnabled: boolean;
  accountHref?: string;
  showCreations?: boolean;
}) {
  const label = accountHref ? "Account" : "Log in";
  const href = accountHref ?? `/${locale}/login`;
  const pendingLabel = accountHref ? "Opening account" : "Opening login";

  return (
    <>
      <NavigationLink href={href} pendingLabel={pendingLabel} aria-label={label}
        className={`${mobileActionClass} lg:hidden`}>
        <UserRound className="size-5" aria-hidden />
      </NavigationLink>
      <NavigationLink href={href} pendingLabel={pendingLabel} aria-label={label}
        className={buttonClassName({
          variant: accountHref ? "outline" : "default",
          size: "sm",
          className: "hidden min-h-10 gap-1.5 px-3 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] lg:inline-flex",
        })}>
        <LogIn className="size-4" aria-hidden />
        <span>{label}</span>
      </NavigationLink>
      <MobileNavigation locale={locale} communityEnabled={communityEnabled} accountHref={accountHref}
        showCreations={showCreations} logout={accountHref ? (
          <form action={logoutAction} className="flex-1">
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" className="min-h-11 w-full rounded-md px-2 text-left font-medium hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-[var(--color-terracotta)]">Log out</button>
          </form>
        ) : undefined} />
    </>
  );
}

function headerLinkClassName(className?: string) {
  return buttonClassName({
    variant: "ghost",
    size: "sm",
    className: `min-h-10 transition-transform active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] ${className ?? ""}`,
  });
}
