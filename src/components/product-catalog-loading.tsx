import { catalogGridClass } from "@/lib/catalog-navigation";

export function ProductCatalogHeading() {
  return <div data-testid="catalog-heading" className="max-w-3xl">
    <p className="text-sm font-medium text-[var(--color-terracotta)]">Catalog</p>
    <h1 className="mt-1 font-serif text-3xl font-semibold sm:mt-2 sm:text-4xl">Browse LamiliaLomi books</h1>
    <p className="mt-2 text-[var(--color-muted)] sm:mt-4">Find a coloring or activity book for your next quiet moment. Explore the pages, choose your copy on Amazon, and discover extras for the books you own.</p>
  </div>;
}

/** Before taxonomy is known, show a truthful opening state, never guessed tiles.
 * Once the snapshot is ready the actual shell remains around this results-only fallback. */
export function ProductCatalogLoading({ desktopColumns = 4, resultsOnly = false }: { desktopColumns?: 3 | 4 | 5; resultsOnly?: boolean }) {
  if (!resultsOnly) return <div data-testid="product-catalog-opening" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8"><ProductCatalogHeading /><p role="status" className="mt-6 text-sm text-[var(--color-muted)]">Opening catalog…</p></div>;
  const pulse = "animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none";
  return <div data-testid="product-catalog-loading" aria-busy="true" role="status" aria-live="polite">
    <span className="sr-only">Loading catalog results</span>
    <div className={catalogGridClass(desktopColumns)}>
      {Array.from({ length: desktopColumns * 2 }, (_, index) => <div key={index} data-testid="catalog-result-skeleton-card" className="min-w-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-white/80">
        <div data-testid="catalog-result-skeleton-cover" className={`${pulse} aspect-[8.5/11]`} /><div className="grid gap-3 p-3 sm:p-4"><div className={`${pulse} h-5 w-3/4`} /><div className={`${pulse} h-16`} /><div className={`${pulse} h-16`} /></div>
      </div>)}
    </div>
  </div>;
}
