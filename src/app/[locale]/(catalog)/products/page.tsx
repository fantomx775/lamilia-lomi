import type { Metadata } from "next";
import { NavigationLink } from "@/components/navigation-link";
import { CatalogResults } from "@/components/catalog-form";
import { ProductCatalogShell, getCatalogHref } from "@/components/product-catalog-shell";
import { ProductCard } from "@/components/product-card";
import type { Locale } from "@/i18n/routing";
import type { ContentSnapshot } from "@/lib/types";
import { catalogGridClass } from "@/lib/catalog-navigation";
import { getPublicCatalogSnapshotForRequest } from "@/lib/content-repository";
import { getCatalogProductsFromSnapshot, parseCatalogFilters } from "@/lib/products";

type Props = {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export const metadata: Metadata = {
  title: "Books & Coloring Books",
  description: "Find your next LamiliaLomi coloring or activity book. Explore pages, choose a book on Amazon, and discover extras for your copy.",
  alternates: { canonical: "/en/products" },
};
export default async function ProductsPage({ params, searchParams }: Props) {
  const [{ locale }, rawSearchParams] = await Promise.all([params, searchParams]);
  const snapshot = await getPublicCatalogSnapshotForRequest(locale);
  // This document is a native GET entry point too. Streamed Suspense segments
  // need inline scripts to replace their fallback, so resolve its content first.
  await delayCatalogForE2E();
  return <ProductCatalogShell snapshot={snapshot} locale={locale} rawSearchParams={rawSearchParams}>
    <CatalogResults>
      <CatalogProductGrid snapshot={snapshot} locale={locale} rawSearchParams={rawSearchParams} />
    </CatalogResults>
  </ProductCatalogShell>;
}
function CatalogProductGrid({ snapshot, locale, rawSearchParams }: {
  snapshot: ContentSnapshot; locale: Locale; rawSearchParams: Record<string, string | string[] | undefined>;
}) {
  const products = getCatalogProductsFromSnapshot(snapshot, locale, parseCatalogFilters(rawSearchParams));
  const imageSizes = `(min-width: 1280px) ${Math.round(100 / snapshot.catalogSettings.desktopColumns)}vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw`;
  return products.length ? (
        <div
          data-testid="product-catalog-grid"
          className={catalogGridClass(snapshot.catalogSettings.desktopColumns)}
        >
          {products.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              locale={locale}
              imageLoading={index === 0 ? "eager" : "lazy"}
              imageSizes={imageSizes}
              catalogHref={getCatalogHref(locale, rawSearchParams)}
            />
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-[var(--color-border)] bg-white/70 p-8 text-center md:mt-8">
          <p className="font-serif text-2xl font-semibold">No products found</p>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Try clearing search or choosing a broader audience.
          </p>
          <NavigationLink pendingLabel="Opening catalog" className="mt-5 inline-flex text-sm font-medium text-[var(--color-terracotta)]" href={`/${locale}/products`}>
            Reset catalog
          </NavigationLink>
        </div>
  );
}

async function delayCatalogForE2E() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.LAMILIA_BACKEND?.trim().toLowerCase() !== "local"
  ) {
    return;
  }

  const delayMs = Number(process.env.LAMILIA_TEST_CATALOG_LOADING_DELAY_MS);

  if (!Number.isSafeInteger(delayMs) || delayMs < 1 || delayMs > 5_000) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
