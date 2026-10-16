import Link from "next/link";

import { ImageWithFallback } from "@/components/image-with-fallback";
import { LinkPendingIndicator } from "@/components/link-pending-indicator";
import type { Locale } from "@/i18n/routing";
import type { LocalizedProductView } from "@/lib/types";

import { Badge } from "./ui/badge";
import { ProductCardTitleDisclosure } from "./product-card-title-disclosure";

export function ProductCard({
  product,
  locale,
  imageLoading = "lazy",
  imageSizes,
}: {
  product: LocalizedProductView;
  locale: Locale;
  imageLoading?: "eager" | "lazy";
  imageSizes?: string;
}) {
  return (
    <article className="group relative flex h-full min-w-0 flex-col rounded-lg border border-[var(--color-border)] bg-white/80 shadow-[0_12px_36px_rgba(62,52,47,0.07)] transition-[transform,box-shadow,border-color] duration-150 motion-reduce:transition-none hover:-translate-y-0.5 hover:shadow-[0_18px_46px_rgba(62,52,47,0.12)] motion-reduce:hover:translate-y-0 active:translate-y-0 active:scale-[0.99] motion-reduce:active:scale-100 active:shadow-none">
      <Link
        href={`/${locale}/products/${product.slug}`}
        className="flex min-w-0 flex-1 flex-col rounded-t-lg focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-terracotta)]"
      >
        <LinkPendingIndicator label="Opening product details" />
        <div className="relative aspect-[8.5/11] shrink-0 overflow-hidden rounded-t-lg bg-[var(--color-blush)]">
          <ImageWithFallback
            src={product.cover.path}
            alt={product.cover.title ?? product.title}
            loading={imageLoading}
            className="object-contain"
            sizes={imageSizes ?? "(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"}
          />
        </div>
        <div className="grid min-w-0 flex-1 content-start gap-3 p-3 sm:p-4">
          <div className="flex flex-wrap gap-2">
            <Badge>{product.audienceLabel}</Badge>
            <Badge className="bg-[var(--color-sage)]">{product.productType}</Badge>
          </div>
          <div className="min-w-0">
            <h3 aria-label={product.title} data-product-card-title className="line-clamp-3 min-h-[3lh] [overflow-wrap:anywhere] font-serif text-xl font-semibold leading-tight text-[var(--color-ink)]">
              {product.title}
            </h3>
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--color-muted)]">
              {product.shortDescription}
            </p>
          </div>
        </div>
      </Link>
      <ProductCardTitleDisclosure title={product.title} />
    </article>
  );
}
