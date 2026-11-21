"use client";

import { BookOpen, Images, Info, Library, LogIn, LogOut, Menu, Palette, UserRound, X } from "lucide-react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { mobileActionClass } from "@/components/mobile-header-styles";
import { mobileNavigationHistoryKey as mobileHistoryKey, useCommunityRouteNavigation } from "@/components/community/community-route-transition";
import { NavigationLink } from "@/components/navigation-link";
import type { Locale } from "@/i18n/routing";

const menuLinkClass = "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 font-medium text-[var(--color-ink)] hover:bg-[var(--color-blush)] active:bg-[var(--color-blush)] active:brightness-90 aria-busy:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-[var(--color-terracotta)]";

export function MobileNavigation({ locale, communityEnabled, accountHref, showCreations, logout }: {
  locale: Locale;
  communityEnabled: boolean;
  accountHref?: string;
  showCreations?: boolean;
  logout?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const community = useCommunityRouteNavigation();
  const navigateCommunity = community?.navigate;
  const cancelCommunity = community?.cancel;
  const menuOpened = community?.menuOpened;
  const requestVersion = useRef(0);
  const navigateDestination = useCallback((destination: string) => {
    if (!navigateCommunity?.(destination)) router.push(destination);
  }, [navigateCommunity, router]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openedPath = useRef<string | null>(null);
  const pendingClose = useRef<{ destination?: string; version: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [selection, setSelection] = useState<{ href: string; label: string; from: string } | null>(null);
  const navigating = selection && selection.href !== pathname ? selection : null;
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitAction = useRef<(() => void) | null>(null);
  const pendingLogout = useRef<(() => void) | null>(null);
  const submittingLogout = useRef(false);
  const finishExit = useCallback(() => {
    if (!exitAction.current) return;
    const action = exitAction.current;
    exitAction.current = null;
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = null;
    dialogRef.current?.close();
    setOpen(false);
    setClosing(false);
    action();
    const logoutAction = pendingLogout.current;
    pendingLogout.current = null;
    logoutAction?.();
  }, []);
  const beginExit = useCallback((action: () => void) => {
    if (exitAction.current) return;
    exitAction.current = action;
    const dialog = dialogRef.current;
    if (dialog) dialog.style.setProperty("--navigation-exit-start", getComputedStyle(dialog).transform);
    setClosing(true);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) finishExit();
    else exitTimer.current = setTimeout(finishExit, 280);
  }, [finishExit]);
  useEffect(() => () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    function syncHistory() {
      if (history.state?.[mobileHistoryKey] && trigger?.getClientRects().length) {
        if (exitTimer.current) clearTimeout(exitTimer.current);
        exitTimer.current = null;
        exitAction.current = null;
        pendingLogout.current = null;
        pendingClose.current = null;
        requestVersion.current += 1;
        setSelection(null);
        if (dialog?.open) dialog.style.setProperty("--navigation-enter-start", getComputedStyle(dialog).transform);
        else dialog?.style.removeProperty("--navigation-enter-start");
        setClosing(false);
        if (!dialog?.open) {
          dialog?.showModal();
          openedPath.current = window.location.pathname;
          setOpen(true);
        }
        return;
      }
      if (!pendingClose.current) setSelection(null);
      const request = pendingClose.current;
      const destination = request?.destination;
      if (!request && exitAction.current) requestVersion.current += 1;
      pendingClose.current = null;
      if (dialog?.open) beginExit(() => {
        if (destination && request?.version === requestVersion.current && destination !== window.location.pathname) navigateDestination(destination);
        else if (openedPath.current === window.location.pathname) trigger?.focus();
        openedPath.current = null;
      });
    }
    const desktop = window.matchMedia("(min-width: 64rem)");
    function onDesktop(event: MediaQueryListEvent) {
      if (event.matches && dialog?.open) {
        if (history.state?.[mobileHistoryKey]) history.back();
        else syncHistory();
      }
    }
    window.addEventListener("popstate", syncHistory);
    desktop.addEventListener("change", onDesktop);
    return () => {
      window.removeEventListener("popstate", syncHistory);
      desktop.removeEventListener("change", onDesktop);
    };
  }, [navigateDestination, beginExit]);

  useEffect(() => {
    if (dialogRef.current?.open && openedPath.current !== pathname) dialogRef.current.close();
    if (!selection || selection.from === pathname || pendingClose.current || exitAction.current) return;
    const clear = window.setTimeout(() => setSelection(null), 0);
    return () => window.clearTimeout(clear);
  }, [pathname, selection]);

  function closeForLogout(event: FormEvent<HTMLDivElement>) {
    if (submittingLogout.current || !(event.target instanceof HTMLFormElement)) return;
    event.preventDefault();
    cancelCommunity?.();
    const form = event.target;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    pendingLogout.current = () => {
      submittingLogout.current = true;
      form.requestSubmit(submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? submitter : undefined);
      submittingLogout.current = false;
    };
    closeMenu();
  }

  function openMenu() {
    if (dialogRef.current?.open) return;
    setSelection(null);
    requestVersion.current += 1;
    history.pushState({ ...history.state, [mobileHistoryKey]: true }, "");
    menuOpened?.();
    dialogRef.current?.style.removeProperty("--navigation-enter-start");
    dialogRef.current?.showModal();
    openedPath.current = pathname;
    setOpen(true);
  }

  const closeMenu = useCallback((destination?: string) => {
    if (!dialogRef.current?.open) return;
    if (history.state?.[mobileHistoryKey]) {
      if (pendingClose.current) return;
      if (destination) cancelCommunity?.();
      pendingClose.current = { destination, version: ++requestVersion.current };
      history.back();
    } else {
      if (destination) cancelCommunity?.();
      const version = ++requestVersion.current;
      beginExit(() => {
        if (destination && version === requestVersion.current && destination !== window.location.pathname) navigateDestination(destination);
        else triggerRef.current?.focus();
      });
    }
  }, [navigateDestination, cancelCommunity, beginExit]);

  const links = [
    { label: "Catalog", href: `/${locale}/products`, icon: BookOpen },
    ...(communityEnabled ? [{ label: "Coloring Club", href: "/en/club", icon: Palette }] : []),
    { label: "About", href: `/${locale}/about`, icon: Info },
    { label: "My Library", href: `/${locale}/library`, icon: Library },
    ...(showCreations ? [{ label: "My Creations", href: `/${locale}/library/creations`, icon: Images }] : []),
    ...(accountHref ? [{ label: "Account", href: accountHref, icon: UserRound }] : []),
  ];
  if (!accountHref) links.push(
    { label: "Log in", href: `/${locale}/login`, icon: LogIn },
    { label: "Sign up", href: `/${locale}/register`, icon: UserRound },
  );

  return (
    <div className="lg:hidden">
      <button ref={triggerRef} type="button" aria-label="Open navigation menu" aria-expanded={open}
        aria-controls="mobile-primary-navigation" aria-haspopup="dialog" onClick={openMenu} className={mobileActionClass}>
        <Menu className="size-5" aria-hidden />
      </button>
      {navigating && !open ? (
        <div role="status" aria-live="polite" data-testid="mobile-navigation-pending"
          className="pointer-events-none fixed inset-x-4 top-[calc(4.5rem+env(safe-area-inset-top))] z-[100] flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm shadow-lg">
          <span aria-hidden className="size-3 shrink-0 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin" />
          {navigating.label}
        </div>
      ) : null}
      <dialog ref={dialogRef} id="mobile-primary-navigation" aria-label="Mobile primary navigation"
        data-closing={closing || undefined}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && event.animationName === "mobile-navigation-exit") finishExit();
        }}
        className="mobile-navigation-dialog fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto overscroll-contain bg-[var(--color-bg)] text-[var(--color-ink)]"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("a[href],button:not(:disabled)"));
          const index = controls.indexOf(document.activeElement as HTMLElement);
          const offset = event.shiftKey ? -1 : 1;
          event.preventDefault();
          controls[(index + offset + controls.length) % controls.length]?.focus();
        }}
        onClick={(event) => {
          const target = event.target;
          if (target === event.currentTarget || (target instanceof Element && target.matches("[data-mobile-navigation-surface]"))) closeMenu();
        }}
        onCancel={(event) => { event.preventDefault(); closeMenu(); }}
        onClose={() => { if (!dialogRef.current?.open) setOpen(false); }}>
        <div data-mobile-navigation-surface className="flex min-h-full flex-col px-4 pt-[env(safe-area-inset-top)] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex min-h-16 items-center justify-between gap-3 border-b border-[var(--color-border)]">
            <div className="flex min-w-0 items-center gap-2 font-serif text-xl font-semibold">
              <Image src="/assets/home/lamilia-lomi-logo-192.webp" width={48} height={48} alt="" unoptimized />
              LamiliaLomi
            </div>
            <button type="button" aria-label="Close navigation menu" onClick={() => closeMenu()} className={mobileActionClass}>
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <nav data-mobile-navigation-surface className="flex flex-1 flex-col gap-1 py-4" aria-label="Storefront">
            {links.map(({ href, label, icon: Icon }) => (
              <NavigationLink key={href} href={href} pendingLabel={`Opening ${label}`}
                className={`${menuLinkClass}${label === "Log in" ? " mt-auto border-t border-[var(--color-border)]" : ""}`}
                pending={navigating?.href === href}
                aria-busy={navigating?.href === href || undefined}
                aria-current={pathname === href ? "page" : undefined}
                onNavigate={(event) => {
                  event.preventDefault();
                  if (pendingClose.current || exitAction.current) return;
                  if (href !== pathname) {
                    setSelection({ href, label: `Opening ${label}`, from: pathname });
                    // These known menu destinations are read-only pages, never redeem URLs.
                    router.prefetch(href);
                  }
                  closeMenu(href);
                }}>
                <Icon className="size-5" aria-hidden />{label}
              </NavigationLink>
            ))}
          </nav>
          {logout ? (
            <div className="flex items-center gap-2 border-t border-[var(--color-border)] pt-4" onSubmit={closeForLogout}>
              <LogOut className="ml-3 size-5" aria-hidden />{logout}
            </div>
          ) : null}
        </div>
      </dialog>
    </div>
  );
}
