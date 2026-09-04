"use client";

import { Languages } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";

import { switchLocaleAction } from "@/app/actions";
import { routing, type Locale } from "@/i18n/routing";

const localeLabels = {
  en: "EN",
  pl: "PL",
  de: "DE",
  es: "ES",
} as const;

const localeNames = {
  en: "English",
  pl: "Polski",
  de: "Deutsch",
  es: "Español",
} as const;

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  return (
    <div className="inline-flex min-w-0 shrink-0 items-center gap-1 rounded-md border border-[var(--color-border)] bg-white/75 p-1 text-sm">
      <Languages className="size-4 shrink-0 text-[var(--color-muted)]" aria-hidden />
      <div className="hidden items-center gap-1 sm:flex">
        {routing.locales.map((targetLocale) => (
          <LocaleForm
            key={targetLocale}
            currentLocale={locale}
            pathname={pathname}
            search={search}
            targetLocale={targetLocale}
          />
        ))}
      </div>
      <details className="relative sm:hidden">
        <summary
          className="flex min-h-9 cursor-pointer list-none items-center rounded px-2 py-1 font-medium text-[var(--color-ink)] hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
          aria-label={`Language: ${localeLabels[locale]}`}
          role="button"
        >
          {localeLabels[locale]}
        </summary>
        <div className="absolute right-0 top-full z-50 mt-2 grid min-w-32 gap-1 rounded-md border border-[var(--color-border)] bg-white p-2 shadow-lg">
          {routing.locales.map((targetLocale) => (
            <LocaleForm
              key={targetLocale}
              currentLocale={locale}
              pathname={pathname}
              search={search}
              targetLocale={targetLocale}
              mobile
            />
          ))}
        </div>
      </details>
    </div>
  );
}

function LocaleForm({
  currentLocale,
  pathname,
  search,
  targetLocale,
  mobile = false,
}: {
  currentLocale: Locale;
  pathname: string;
  search: string;
  targetLocale: Locale;
  mobile?: boolean;
}) {
  const isActive = targetLocale === currentLocale;

  return (
    <form action={switchLocaleAction}>
      <input type="hidden" name="sourceLocale" value={currentLocale} />
      <input type="hidden" name="targetLocale" value={targetLocale} />
      <input type="hidden" name="pathname" value={pathname} />
      <input type="hidden" name="search" value={search} />
      <button
        type="submit"
        className={`rounded px-2 py-1 text-[var(--color-ink)] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] ${isActive ? "bg-[var(--color-sage)] font-semibold shadow-sm" : "font-medium hover:bg-[var(--color-blush)]"} ${mobile ? "flex w-full items-center justify-between gap-3" : "inline-flex"}`}
        aria-current={isActive ? "page" : undefined}
        data-active={isActive ? "true" : "false"}
        aria-label={`${localeNames[targetLocale]} (${localeLabels[targetLocale]})`}
      >
        <span>{localeLabels[targetLocale]}</span>
        {mobile ? (
          <span className="text-xs text-[var(--color-muted)]">
            {localeNames[targetLocale]}
          </span>
        ) : null}
      </button>
    </form>
  );
}
