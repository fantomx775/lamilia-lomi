"use client";

import type { Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export function LocaleTabs({
  value,
  onChange,
  missingLocales = [],
  id = "locale-panel",
}: {
  value: Locale;
  onChange: (locale: Locale) => void;
  missingLocales?: Locale[];
  id?: string;
}) {
  const locales: Locale[] = ["en", "pl", "de", "es"];

  return (
    <div className="overflow-x-auto pb-1" role="tablist" aria-label="Język treści">
      <div className="inline-flex min-w-full gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-1 sm:min-w-0">
        {locales.map((locale) => {
          const active = locale === value;
          const missing = missingLocales.includes(locale);

          return (
            <button
              key={locale}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={id}
              onClick={() => onChange(locale)}
              className={cn(
                "min-w-16 rounded-md px-3 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-terracotta)]",
                active
                  ? "bg-white text-[var(--color-ink)] shadow-sm"
                  : "text-[var(--color-muted)] hover:bg-white/70 hover:text-[var(--color-ink)]",
              )}
            >
              <span>{locale.toUpperCase()}</span>
              {missing ? <span className="ml-1 text-xs text-[var(--color-terracotta)]">· brak</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
