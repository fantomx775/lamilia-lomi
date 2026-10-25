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
    <article className="bg-[#fffdfa]">
      <header className="relative isolate overflow-hidden border-b border-[var(--color-border)] bg-[radial-gradient(ellipse_at_top,_rgba(200,210,188,0.28),_transparent_68%)] px-4 pb-7 pt-8 text-center sm:px-6 sm:pb-9 sm:pt-10">
        <Leaf
          className="absolute left-[8%] top-1/2 hidden size-10 -translate-y-1/2 -rotate-45 text-[var(--color-sage-deep)]/70 sm:block lg:left-[19%]"
          aria-hidden="true"
        />
        <Leaf
          className="absolute right-[8%] top-1/2 hidden size-10 -translate-y-1/2 rotate-45 scale-x-[-1] text-[var(--color-sage-deep)]/70 sm:block lg:right-[19%]"
          aria-hidden="true"
        />
        <Sparkles
          className="absolute left-[17%] top-4 size-4 text-[var(--color-terracotta)]/50 sm:hidden"
          aria-hidden="true"
        />
        <h1 className="font-serif text-3xl font-semibold leading-tight text-[var(--color-ink)] sm:text-4xl lg:text-[2.65rem]">
          Loved by Our <span className="text-[var(--color-terracotta)]">Readers</span>
        </h1>
        {settings.intro.trim() ? (
          <RichTextContent
            value={settings.intro}
            className="prose-lomi mx-auto mt-2 max-w-2xl text-sm text-[var(--color-muted)] sm:text-base"
          />
        ) : (
          <p className="mt-2 text-sm text-[var(--color-muted)] sm:text-base">
            A selection of customer favorites from the Lamilia Lomi collection.
          </p>
        )}
      </header>

      <div className="mx-auto grid max-w-7xl gap-3 px-4 py-5 sm:gap-4 sm:px-6 sm:py-7 lg:px-8">
        <FavoriteBookSection
          id="favorite-coloring-books"
          title="Favorite Coloring Books"
          description="Beautiful designs for relaxation, creativity, and everyday joy."
          products={coloringBooks}
          locale={locale}
          eagerFirstImage
        />

        <FavoriteBookSection
          id="favorite-picture-books"
          title="Favorite Picture Books"
          description="Magical stories and beautiful illustrations for young dreamers."
          products={pictureBooks}
          locale={locale}
        />
      </div>
    </article>
  );
}

function FavoriteBookSection({
  id,
  title,
  description,
  products,
  locale,
  eagerFirstImage = false,
}: {
  id: string;
  title: string;
  description: string;
  products: LocalizedProductView[];
  locale: Locale;
  eagerFirstImage?: boolean;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="grid min-w-0 gap-3 rounded-2xl border border-[var(--color-border)] bg-[#fcfaf6] p-3 sm:gap-4 sm:p-4 lg:grid-cols-[minmax(190px,0.78fr)_minmax(0,2.22fr)] lg:items-stretch"
    >
      <div className="relative flex min-w-0 items-center gap-3 rounded-xl bg-white/65 p-3 sm:p-4 md:gap-4">
        <Leaf
          className="hidden size-9 shrink-0 -rotate-45 text-[var(--color-sage-deep)]/65 sm:block"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--color-terracotta)]">
            Lamilia Lomi favorites
          </p>
          <h2
            id={`${id}-heading`}
            className="mt-1 font-serif text-xl font-semibold leading-tight text-[var(--color-ink)] sm:text-2xl"
          >
            {title}
          </h2>
          <p className="mt-2 text-sm leading-5 text-[var(--color-muted)]">
            {description}
          </p>
          <span
            aria-hidden="true"
            className="mt-3 block h-px w-8 bg-[var(--color-terracotta)]"
          />
        </div>
      </div>

      {products.length ? (
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
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
        <p className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] bg-white/65 px-4 py-6 text-center text-sm text-[var(--color-muted)]">
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
    <article className="group flex min-w-0 flex-col rounded-xl border border-[var(--color-border)] bg-white p-2 shadow-[0_4px_14px_rgba(62,52,47,0.05)] transition-shadow duration-150 motion-reduce:transition-none hover:shadow-[0_8px_20px_rgba(62,52,47,0.1)]">
      <Link
        href={`/${locale}/products/${product.slug}`}
        aria-label={`View ${product.title}`}
        className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
      >
        <div className="relative h-24 overflow-hidden rounded-md bg-[#f8f5ee] sm:h-32 lg:h-36">
          <Image
            src={product.cover.path}
            alt={product.cover.title ?? product.title}
            fill
            loading={eagerImage ? "eager" : "lazy"}
            unoptimized={isMediaProxyPath(product.cover.path)}
            className="object-contain p-1 transition-transform duration-300 motion-reduce:transition-none group-hover:scale-[1.03] motion-reduce:group-hover:scale-100"
            sizes="(min-width: 1024px) 20vw, (min-width: 640px) 30vw, 42vw"
          />
        </div>
      </Link>

      <h3 className="mt-2 min-h-5 truncate font-serif text-sm font-semibold leading-5 text-[var(--color-ink)] sm:text-base">
        <Link
          href={`/${locale}/products/${product.slug}`}
          className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] hover:text-[var(--color-terracotta)]"
          title={product.title}
        >
          {product.title}
        </Link>
      </h3>
      <p className="mt-0.5 min-h-4 truncate text-[10px] leading-4 text-[var(--color-muted)] sm:text-xs">
        {formatProductType(product.productType)} <span aria-hidden="true">·</span>{" "}
        {product.audienceLabel}
      </p>
      {product.primaryAmazonLink ? (
        <AmazonLink
          href={product.primaryAmazonLink.url}
          productId={product.id}
          market={product.primaryAmazonLink.market}
          className="mt-2 min-h-8 w-full justify-center bg-[var(--color-action)] px-2 py-1.5 text-[11px] text-white hover:bg-[var(--color-action-hover)] focus-visible:outline-[var(--color-terracotta)] sm:text-xs"
        >
          View on Amazon
        </AmazonLink>
      ) : null}
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

    if (!product || product.status !== "published" || product.productType !== expectedProductType) return [];

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
