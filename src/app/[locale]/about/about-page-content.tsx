import { Leaf, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { AmazonLink } from "@/components/amazon-link";
import { RichTextContent } from "@/components/rich-text-content";
import type { Locale } from "@/i18n/routing";
import { isMediaProxyPath } from "@/lib/media-upload";
import type { AboutPageSettings, LocalizedProductView } from "@/lib/types";

export function AboutPageContent({
  locale,
  settings,
  products,
}: {
  locale: Locale;
  settings: AboutPageSettings;
  products: LocalizedProductView[];
}) {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const selectedIds = new Set<string>();
  const coloringBooks = resolveConfiguredProducts(
    settings.favoriteColoringBookIds,
    "coloring-book",
    productsById,
    selectedIds,
  );
  const pictureBooks = resolveConfiguredProducts(
    settings.favoritePictureBookIds,
    "picture-book",
    productsById,
    selectedIds,
  );

  return (
    <article>
      <section className="relative isolate overflow-hidden border-b border-[var(--color-border)] bg-[radial-gradient(ellipse_at_top,_rgba(200,210,188,0.42),_transparent_68%)]">
        <Sparkles
          className="absolute left-[9%] top-12 size-6 rotate-12 text-[var(--color-terracotta)]/70 sm:left-[16%] sm:top-16 sm:size-8"
          aria-hidden
        />
        <Leaf
          className="absolute bottom-10 right-[10%] size-8 -rotate-12 text-[var(--color-sage-deep)] sm:right-[17%] sm:size-10"
          aria-hidden
        />
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-20 lg:px-8 lg:py-24">
          <p className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-terracotta)]">
            <Sparkles className="size-4" aria-hidden />
            Loved by Our Readers
          </p>
          <h1 className="mt-6 font-serif text-4xl font-semibold leading-tight text-[var(--color-ink)] sm:text-5xl lg:text-6xl">
            About Lamilia Lomi
          </h1>
          {settings.intro.trim() ? (
            <RichTextContent
              value={settings.intro}
              className="prose-lomi mx-auto mt-6 max-w-2xl space-y-4 text-base sm:text-lg"
            />
          ) : null}
          <div
            aria-hidden="true"
            className="mx-auto mt-8 h-px w-24 bg-[var(--color-terracotta)]/50"
          />
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <FavoriteBookSection
          id="favorite-coloring-books"
          eyebrow="For creative pauses"
          title="Favorite Coloring Books"
          description="Make room for a quiet, creative pause with coloring books made to spark imagination."
          products={coloringBooks}
          locale={locale}
          eagerFirstImage
        />

        <FavoriteBookSection
          id="favorite-picture-books"
          eyebrow="For story time"
          title="Favorite Picture Books"
          description="Warm, thoughtful picture books for shared reading and everyday adventures."
          products={pictureBooks}
          locale={locale}
        />
      </div>

      <section className="relative overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-sage)]/35 px-4 py-10 text-center sm:px-6 sm:py-12">
        <Sparkles
          className="absolute left-8 top-1/2 size-5 -translate-y-1/2 text-[var(--color-terracotta)]/70 sm:left-[18%] sm:size-6"
          aria-hidden
        />
        <Sparkles
          className="absolute right-8 top-1/2 size-5 -translate-y-1/2 text-[var(--color-terracotta)]/70 sm:right-[18%] sm:size-6"
          aria-hidden
        />
        <p className="font-serif text-2xl font-semibold text-[var(--color-ink)] sm:text-3xl">
          A little wonder on every page.
        </p>
      </section>
    </article>
  );
}

function FavoriteBookSection({
  id,
  eyebrow,
  title,
  description,
  products,
  locale,
  eagerFirstImage = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  products: LocalizedProductView[];
  locale: Locale;
  eagerFirstImage?: boolean;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="py-8 sm:py-10">
      <div className="mb-7 grid gap-3 sm:mb-9 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:items-end md:gap-8">
        <div>
          <p className="text-sm font-medium text-[var(--color-terracotta)]">
            {eyebrow}
          </p>
          <h2
            id={`${id}-heading`}
            className="mt-2 font-serif text-3xl font-semibold leading-tight text-[var(--color-ink)] sm:text-4xl"
          >
            {title}
          </h2>
        </div>
        <p className="max-w-2xl leading-7 text-[var(--color-muted)] md:justify-self-end">
          {description}
        </p>
      </div>

      {products.length ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product, index) => (
            <FavoriteBookCard
              key={product.id}
              product={product}
              locale={locale}
              eagerImage={eagerFirstImage && index === 0}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-[var(--color-border)] bg-white/45 px-5 py-8 text-center text-sm text-[var(--color-muted)]">
          New favorites are on the way.
        </p>
      )}
    </section>
  );
}

function FavoriteBookCard({
  product,
  locale,
  eagerImage,
}: {
  product: LocalizedProductView;
  locale: Locale;
  eagerImage: boolean;
}) {
  return (
    <article className="group flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-white/80 shadow-[0_12px_36px_rgba(62,52,47,0.07)] transition-[transform,box-shadow] duration-150 motion-reduce:transition-none hover:-translate-y-0.5 hover:shadow-[0_18px_46px_rgba(62,52,47,0.12)] motion-reduce:hover:translate-y-0">
      <Link
        href={`/${locale}/products/${product.slug}`}
        aria-label={`View ${product.title}`}
        className="focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--color-terracotta)]"
      >
        <div className="relative aspect-[3/4] overflow-hidden bg-[var(--color-blush)]">
          <Image
            src={product.cover.path}
            alt={product.cover.title ?? product.title}
            fill
            loading={eagerImage ? "eager" : "lazy"}
            unoptimized={isMediaProxyPath(product.cover.path)}
            className="object-cover transition-transform duration-500 motion-reduce:transition-none group-hover:scale-[1.02] motion-reduce:group-hover:scale-100"
            sizes="(min-width: 1024px) 30vw, (min-width: 640px) 46vw, 100vw"
          />
        </div>
      </Link>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--color-terracotta)]">
          {product.audienceLabel} <span aria-hidden="true">·</span>{" "}
          {formatProductType(product.productType)}
        </p>
        <h3 className="mt-2 font-serif text-xl font-semibold leading-snug text-[var(--color-ink)] sm:text-2xl">
          <Link
            href={`/${locale}/products/${product.slug}`}
            className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] hover:text-[var(--color-terracotta)]"
          >
            {product.title}
          </Link>
        </h3>
        <p className="mt-3 line-clamp-4 text-sm leading-6 text-[var(--color-muted)]">
          {product.shortDescription}
        </p>
        {product.primaryAmazonLink ? (
          <AmazonLink
            href={product.primaryAmazonLink.url}
            productId={product.id}
            market={product.primaryAmazonLink.market}
            className="mt-5 w-full bg-[var(--color-terracotta)] text-white hover:bg-[var(--color-ink-soft)] focus-visible:outline-[var(--color-terracotta)]"
          >
            View on Amazon
          </AmazonLink>
        ) : null}
      </div>
    </article>
  );
}

function resolveConfiguredProducts(
  ids: readonly string[],
  expectedProductType: string,
  productsById: ReadonlyMap<string, LocalizedProductView>,
  selectedIds: Set<string>,
) {
  return ids.slice(0, 3).flatMap((id) => {
    if (!id || selectedIds.has(id)) return [];

    const product = productsById.get(id);

    if (!product || product.productType !== expectedProductType) return [];

    selectedIds.add(id);
    return [product];
  });
}

function formatProductType(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
