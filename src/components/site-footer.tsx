import Link from "next/link";

import type { Locale } from "@/i18n/routing";

export function SiteFooter({ locale }: { locale: Locale }) {
  return (
    <footer className="border-t border-[var(--color-border)] bg-white/55">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 text-sm text-[var(--color-muted)] sm:px-6 md:grid-cols-[1.2fr_1fr_1fr] lg:px-8">
        <div>
          <p className="font-serif text-2xl font-semibold text-[var(--color-ink)]">
            LamiliaLomi
          </p>
          <p className="mt-3 max-w-sm leading-6">
            Calm creative books, gentle premium materials, and a tidy bridge
            from Amazon KDP to a returning reader library.
          </p>
        </div>
        <div className="grid gap-2">
          <Link href={`/${locale}/products`} className="hover:text-[var(--color-ink)]">
            Catalog
          </Link>
          <Link href={`/${locale}/contact`} className="hover:text-[var(--color-ink)]">
            Contact
          </Link>
          <Link href={`/${locale}/author`} className="hover:text-[var(--color-ink)]">
            Author
          </Link>
        </div>
        <div className="grid gap-2">
          <Link href={`/${locale}/privacy`} className="hover:text-[var(--color-ink)]">
            Privacy
          </Link>
          <Link href={`/${locale}/terms`} className="hover:text-[var(--color-ink)]">
            Terms
          </Link>
          <span>Instagram / Pinterest placeholders</span>
        </div>
      </div>
    </footer>
  );
}
