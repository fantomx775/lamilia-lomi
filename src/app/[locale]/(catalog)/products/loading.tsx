export default function ProductCatalogLoading() {
  return (
    <div data-testid="product-catalog-loading" aria-busy="true" role="status" aria-live="polite">
      <span className="sr-only">Loading catalog</span>
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto h-12 max-w-md animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="mx-auto mt-5 h-16 max-w-2xl animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white/80">
              <div className="aspect-[3/4] animate-pulse bg-[var(--color-blush)] motion-reduce:animate-none" />
              <div className="space-y-3 p-5">
                <div className="h-6 w-3/4 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
                <div className="h-4 w-full animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
