import Link from "next/link";

import type { Locale } from "@/i18n/routing";

export function SiteFooter({ locale }: { locale: Locale }) {
  return (
    <footer className="border-t border-[var(--color-border)] bg-white/55">
      <div className="mx-auto max-w-7xl px-4 py-8 text-sm text-[var(--color-muted)] sm:px-6 sm:py-10 lg:px-8">
        <div className="grid gap-6 md:grid-cols-[1.2fr_1fr_1fr] md:gap-8">
        <div>
          <p className="font-serif text-xl font-semibold text-[var(--color-ink)] sm:text-2xl">
            LamiliaLomi
          </p>
          <p className="mt-2 max-w-sm leading-6">
            Calm creative books, gentle premium materials, and a tidy bridge
            from Amazon KDP to a returning reader library.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-6 md:col-span-2 md:gap-8">
          <nav aria-label="Explore" className="grid content-start gap-2">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-soft)]">Explore</p>
            <Link href={`/${locale}/products`} className="hover:text-[var(--color-ink)]">
              Catalog
            </Link>
            <Link href={`/${locale}/about`} className="hover:text-[var(--color-ink)]">
              About
            </Link>
            <Link href={`/${locale}/contact`} className="hover:text-[var(--color-ink)]">
              Contact
            </Link>
            <Link href={`/${locale}/author`} className="hover:text-[var(--color-ink)]">
              Author
            </Link>
          </nav>
          <nav aria-label="For readers" className="grid content-start gap-2">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-soft)]">For readers</p>
            <Link href={`/${locale}/library`} className="hover:text-[var(--color-ink)]">
              My Library
            </Link>
          </nav>
        </div>
        </div>
        <nav aria-label="Legal" className="mt-6 flex gap-5 border-t border-[var(--color-border)] pt-4 md:mt-8">
          <Link href={`/${locale}/privacy`} className="hover:text-[var(--color-ink)]">
            Privacy
          </Link>
          <Link href={`/${locale}/terms`} className="hover:text-[var(--color-ink)]">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
