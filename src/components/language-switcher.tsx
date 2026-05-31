"use client";

import { Languages } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function LanguageSwitcher() {
  const pathname = usePathname();
  const withoutLocale = pathname.replace(/^\/(en|pl)/, "") || "";

  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-white/75 p-1 text-sm">
      <Languages className="size-4 text-[var(--color-muted)]" aria-hidden />
      <Link
        className="rounded px-2 py-1 text-[var(--color-ink)] hover:bg-[var(--color-blush)]"
        href={`/en${withoutLocale}`}
      >
        EN
      </Link>
      <Link
        className="rounded px-2 py-1 text-[var(--color-ink)] hover:bg-[var(--color-blush)]"
        href={`/pl${withoutLocale}`}
      >
        PL
      </Link>
    </div>
  );
}
