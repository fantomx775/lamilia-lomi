import { ArrowRight, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { ProductCard } from "@/components/product-card";
import { buttonClassName } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import {
  getAudienceLabel,
  getAudiencePath,
  getFeaturedProducts,
} from "@/lib/products";

type Props = {
  params: Promise<{ locale: Locale }>;
};

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  const kids = getFeaturedProducts(locale, "kids")[0];
  const adults = getFeaturedProducts(locale, "adults")[0];
  const featured = getFeaturedProducts(locale);

  return (
    <div>
      <section className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-7xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
        <div className="max-w-2xl">
          <p className="inline-flex items-center gap-2 rounded-md bg-white/70 px-3 py-2 text-sm font-medium text-[var(--color-muted)]">
            <Sparkles className="size-4 text-[var(--color-terracotta)]" aria-hidden />
            Premium creative books and bonuses
          </p>
          <h1 className="mt-6 font-serif text-5xl font-semibold leading-none text-[var(--color-ink)] sm:text-6xl lg:text-7xl">
            LamiliaLomi
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-[var(--color-muted)]">
            A calm home for coloring books, picture stories, and premium
            printable bonuses unlocked from the physical book.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link className={buttonClassName()} href={`/${locale}/products`}>
              Browse catalog
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              className={buttonClassName({ variant: "outline" })}
              href={`/${locale}/products/moon-garden-coloring-book?code=LOMI-BOOK-2026`}
            >
              Try QR unlock
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {[kids, adults].filter(Boolean).map((product) => (
            <Link
              href={getAudiencePath(product!.audience, locale)}
              key={product!.id}
              className="group overflow-hidden rounded-lg border border-[var(--color-border)] bg-white/80 p-3 shadow-[0_18px_46px_rgba(62,52,47,0.1)]"
            >
              <div className="relative aspect-[3/4] overflow-hidden rounded-md bg-[var(--color-blush)]">
                <Image
                  src={product!.cover.path}
                  alt={product!.cover.title ?? product!.title}
                  fill
                  priority
                  className="object-cover transition duration-500 group-hover:scale-[1.02]"
                  sizes="(min-width: 1024px) 28vw, 48vw"
                />
              </div>
              <div className="flex items-center justify-between py-4">
                <div>
                  <p className="text-sm text-[var(--color-muted)]">
                    {getAudienceLabel(product!.audience, locale)}
                  </p>
                  <p className="font-serif text-2xl font-semibold">
                    {product!.audience === "kids" ? "Kids" : "Adults"}
                  </p>
                </div>
                <ArrowRight className="size-5 text-[var(--color-terracotta)]" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-y border-[var(--color-border)] bg-white/50">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-12 sm:px-6 md:grid-cols-3 lg:px-8">
          <Card>
            <CardHeader>
              <h2 className="font-serif text-2xl font-semibold">QR to bonus</h2>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Printed book codes unlock product-specific premium files and
                return access through the reader library.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <h2 className="font-serif text-2xl font-semibold">Amazon bridge</h2>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Product pages keep Amazon links visible while preserving a
                premium branded experience.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <h2 className="font-serif text-2xl font-semibold">Owner control</h2>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                The Polish admin area is ready for product, user, export, and
                content management flows.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--color-terracotta)]">
              Featured catalog
            </p>
            <h2 className="mt-2 font-serif text-3xl font-semibold">
              Real product paths from the first screen
            </h2>
          </div>
          <Link
            className="hidden text-sm font-medium text-[var(--color-ink)] hover:text-[var(--color-terracotta)] sm:inline"
            href={`/${locale}/products`}
          >
            View all
          </Link>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {featured.slice(0, 3).map((product) => (
            <ProductCard key={product.id} product={product} locale={locale} />
          ))}
        </div>
      </section>
    </div>
  );
}
