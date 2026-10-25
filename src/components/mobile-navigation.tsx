"use client";

import { BookOpen, Info, Library, Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { NavigationLink } from "@/components/navigation-link";
import type { Locale } from "@/i18n/routing";

type MobileNavigationProps = {
  locale: Locale;
  children: ReactNode;
};

export function MobileNavigation({ locale, children }: MobileNavigationProps) {
  const [openOnPathname, setOpenOnPathname] = useState<string | null>(null);
  const pathname = usePathname();
  const isOpen = openOnPathname === pathname;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = "mobile-primary-navigation";

  useEffect(() => {
    if (!isOpen) return;

    const dismissOnOutsidePress = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpenOnPathname(null);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      event.preventDefault();
      setOpenOnPathname(null);
      buttonRef.current?.focus();
    };

    document.addEventListener("pointerdown", dismissOnOutsidePress);
    document.addEventListener("keydown", dismissOnEscape);

    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePress);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [isOpen]);

  const closeMenu = () => setOpenOnPathname(null);

  return (
    <div ref={rootRef} className="relative md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setOpenOnPathname(isOpen ? null : pathname)}
        className="inline-flex size-11 min-h-11 min-w-11 items-center justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-blush)] focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        {isOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
      </button>

      <nav
        id={menuId}
        aria-label="Mobile primary navigation"
        hidden={!isOpen}
        className="absolute right-0 top-[calc(100%+0.75rem)] z-50 grid w-[min(18rem,calc(100vw-2rem))] gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm text-[var(--color-ink)] shadow-[0_18px_48px_rgba(46,68,58,0.18)]"
      >
        <NavigationLink
          href={`/${locale}/products`}
          pendingLabel="Opening catalog"
          onClick={closeMenu}
          className="flex min-h-11 items-center gap-3 rounded-lg px-3 font-medium hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
        >
          <BookOpen className="size-4" aria-hidden />
          Catalog
        </NavigationLink>
        <NavigationLink
          href={`/${locale}/about`}
          pendingLabel="Opening about page"
          showPendingBar={false}
          onClick={closeMenu}
          className="flex min-h-11 items-center gap-3 rounded-lg px-3 font-medium hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
        >
          <Info className="size-4" aria-hidden />
          About
        </NavigationLink>
        <NavigationLink
          href={`/${locale}/library`}
          pendingLabel="Opening library"
          onClick={closeMenu}
          className="flex min-h-11 items-center gap-3 rounded-lg px-3 font-medium hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
        >
          <Library className="size-4" aria-hidden />
          My Library
        </NavigationLink>
        <div className="my-1 border-t border-[var(--color-border)] pt-1">
          {children}
        </div>
      </nav>
    </div>
  );
}
