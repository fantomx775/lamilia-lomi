import Image from "next/image";
import Link from "next/link";

import { LinkPendingIndicator } from "@/components/link-pending-indicator";
import type { Locale } from "@/i18n/routing";
import { isMediaProxyPath } from "@/lib/media-upload";
import type { LocalizedProductView } from "@/lib/types";

import { Badge } from "./ui/badge";

export function ProductCard({
  product,
  locale,
  imageLoading = "lazy",
}: {
  product: LocalizedProductView;
  locale: Locale;
  imageLoading?: "eager" | "lazy";
}) {
  return (
    <Link
      href={`/${locale}/products/${product.slug}`}
      className="group relative grid h-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-white/80 shadow-[0_12px_36px_rgba(62,52,47,0.07)] transition-[transform,box-shadow,border-color] duration-150 motion-reduce:transition-none hover:-translate-y-0.5 hover:shadow-[0_18px_46px_rgba(62,52,47,0.12)] motion-reduce:hover:translate-y-0 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-terracotta)] active:translate-y-0 active:scale-[0.99] motion-reduce:active:scale-100 active:shadow-none"
    >
      <LinkPendingIndicator
        label={
          locale === "pl"
            ? "Otwieranie strony produktu"
            : locale === "de"
              ? "Produktseite wird geöffnet"
              : locale === "es"
                ? "Abriendo la página del producto"
                : "Opening product details"
        }
      />
      <div className="relative aspect-[3/4] bg-[var(--color-blush)]">
        <Image
          src={product.cover.path}
          alt={product.cover.title ?? product.title}
          fill
          loading={imageLoading}
          unoptimized={isMediaProxyPath(product.cover.path)}
          className="object-cover"
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
        />
      </div>
      <div className="grid gap-3 p-4">
        <div className="flex flex-wrap gap-2">
          <Badge>{product.audienceLabel}</Badge>
          <Badge className="bg-[var(--color-sage)]">{product.productType}</Badge>
        </div>
        <div>
          <h3 className="font-serif text-xl font-semibold leading-tight text-[var(--color-ink)]">
            {product.title}
          </h3>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--color-muted)]">
            {product.shortDescription}
          </p>
        </div>
      </div>
    </Link>
  );
}
