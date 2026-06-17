"use client";

import { Languages } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { routing } from "@/i18n/routing";

const localeLabels = {
  en: "EN",
  pl: "PL",
  de: "DE",
  es: "ES",
} as const;

export function LanguageSwitcher() {
  const pathname = usePathname();
  const localePattern = new RegExp(`^/(${routing.locales.join("|")})(?=/|$)`);
  const withoutLocale = pathname.replace(localePattern, "") || "";

  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-white/75 p-1 text-sm">
      <Languages className="size-4 text-[var(--color-muted)]" aria-hidden />
      {routing.locales.map((locale) => (
        <Link
          key={locale}
          className="rounded px-2 py-1 text-[var(--color-ink)] hover:bg-[var(--color-blush)]"
          href={`/${locale}${withoutLocale}`}
        >
          {localeLabels[locale]}
        </Link>
      ))}
    </div>
  );
}
