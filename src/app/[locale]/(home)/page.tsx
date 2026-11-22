import { ArrowRight, Sparkles } from "lucide-react";

import { ProductCard } from "@/components/product-card";
import { NavigationLink } from "@/components/navigation-link";
import { HomeCampaignBanner } from "@/components/home-campaign-banner";
import { buttonClassName } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { getAudiencePath } from "@/lib/products";
import { getFeaturedProductsForRequest } from "@/lib/products-request";
import { publicImageAlt } from "@/lib/product-display";

type Props = {
  params: Promise<{ locale: Locale }>;
};

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  const [kidsProducts, adultsProducts, featured] = await Promise.all([
    getFeaturedProductsForRequest(locale, "kids"),
    getFeaturedProductsForRequest(locale, "adults"),
    getFeaturedProductsForRequest(locale),
  ]);
  const kids = kidsProducts[0];
  const adults = adultsProducts[0];

  return (
    <div>
      <HomeCampaignBanner />

      <section className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-10 lg:px-8 lg:py-14">
        <div className="max-w-2xl">
          <p className="inline-flex items-center gap-2 rounded-md bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-terracotta)]">
            <Sparkles className="size-4 text-[var(--color-terracotta)]" aria-hidden />
            Premium creative books and bonuses
          </p>
          <h1 className="mt-5 font-serif text-4xl font-semibold leading-none text-[var(--color-ink)] sm:text-5xl lg:text-6xl">
            LamiliaLomi
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-[var(--color-muted)] sm:text-lg sm:leading-8">
            A calm home for coloring books, picture stories, and premium
            printable bonuses unlocked from the physical book.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <NavigationLink className={buttonClassName()} href={`/${locale}/products`} pendingLabel="Opening catalog">
              Browse catalog
              <ArrowRight className="size-4" aria-hidden />
            </NavigationLink>
            {(
              <NavigationLink
                className={buttonClassName({
                  variant: "outline",
                  className: "border-[#B8AEA0]",
                })}
                href={`/${locale}/unlock`}
                pendingLabel="Opening bonus unlock"
              >
                Unlock my book bonus
              </NavigationLink>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {[kids, adults].filter(Boolean).map((product) => (
            <NavigationLink
              href={getAudiencePath(product!.audience, locale)}
              key={product!.id}
              className="group overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[0_18px_46px_rgba(46,68,58,0.1)] transition-[transform,box-shadow] duration-150 motion-reduce:transition-none hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 active:scale-[0.99] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-terracotta)]"
              pendingLabel="Opening catalog"
            >
              <div className="relative aspect-[8.5/11] overflow-hidden rounded-md bg-[var(--color-blush)]">
                <ImageWithFallback
                  src={product!.cover.path}
                  alt={publicImageAlt(product!.cover.title, `${product!.title} cover`)}
                  loading="lazy"
                  className="object-contain"
                  sizes="(min-width: 1280px) 300px, (min-width: 1024px) 25vw, (min-width: 640px) calc(50vw - 48px), calc(100vw - 56px)"
                />
              </div>
              <div className="flex items-center justify-between py-4">
                <p className="font-serif text-2xl font-semibold text-[var(--color-ink)]">
                  {product!.audience === "kids" ? "Kids" : "Adults"}
                </p>
                <ArrowRight className="size-5 text-[var(--color-terracotta)]" aria-hidden />
              </div>
            </NavigationLink>
          ))}
        </div>
      </section>

      <section className="border-y border-[var(--color-border)] bg-white/50">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-12 sm:px-6 md:grid-cols-3 lg:px-8">
          <Card>
            <CardHeader>
              <h2 className="font-serif text-2xl font-semibold">More to create</h2>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Find the code inside your printed book to unlock its printable
                bonuses. Return to My Library whenever you want to create again.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <h2 className="font-serif text-2xl font-semibold">Find your next book</h2>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Browse covers and sample pages here, then follow View on Amazon
                to choose and buy your printed book.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <h2 className="font-serif text-2xl font-semibold">A moment of imagination</h2>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-[var(--color-muted)]">
                Discover coloring pages and illustrated stories for children
                and adults, with something new to explore at your own pace.
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
              Explore the collection
            </h2>
          </div>
          <NavigationLink
            className="hidden rounded-sm text-sm font-medium text-[var(--color-ink)] transition-colors duration-100 motion-reduce:transition-none hover:text-[var(--color-terracotta)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-terracotta)] active:opacity-70 sm:inline"
            href={`/${locale}/products`}
            pendingLabel="Opening catalog"
          >
            View all
          </NavigationLink>
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
