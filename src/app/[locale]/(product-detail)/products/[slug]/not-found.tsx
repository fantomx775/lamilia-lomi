import Link from "next/link";
import { getLocale } from "next-intl/server";

import type { Locale } from "@/i18n/routing";

const copy: Record<Locale, { title: string; description: string; catalog: string }> = {
  en: {
    title: "Product not found",
    description: "This product page is no longer available.",
    catalog: "Browse catalog",
  },
  pl: {
    title: "Nie znaleziono produktu",
    description: "Ta strona produktu nie jest już dostępna.",
    catalog: "Przeglądaj katalog",
  },
  de: {
    title: "Produkt nicht gefunden",
    description: "Diese Produktseite ist nicht mehr verfügbar.",
    catalog: "Katalog ansehen",
  },
  es: {
    title: "Producto no encontrado",
    description: "Esta página de producto ya no está disponible.",
    catalog: "Ver el catálogo",
  },
};

export default async function ProductDetailNotFound() {
  const locale = (await getLocale()) as Locale;
  const content = copy[locale] ?? copy.en;

  return (
    <main className="grid min-h-[calc(100svh-8rem)] place-items-center px-6 py-16">
      <div className="w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-white/80 p-8 text-center shadow-[0_18px_46px_rgba(62,52,47,0.1)] sm:p-10">
        <h1 className="font-serif text-4xl font-semibold leading-tight sm:text-5xl">
          {content.title}
        </h1>
        <p className="mt-4 leading-7 text-[var(--color-muted)]">
          {content.description}
        </p>
        <Link
          href={`/${locale}/products`}
          className="mt-7 inline-flex rounded-md bg-[var(--color-ink)] px-5 py-3 text-sm font-medium text-white focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-terracotta)]"
        >
          {content.catalog}
        </Link>
      </div>
    </main>
  );
}
