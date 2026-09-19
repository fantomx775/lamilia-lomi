export default function ProductDetailLoading() {
  return (
    <div data-testid="product-detail-loading" aria-busy="true" role="status" aria-live="polite">
      <span className="sr-only">Loading product details</span>
      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
        <div className="aspect-[3/4] animate-pulse rounded-lg bg-[var(--color-blush)] motion-reduce:animate-none" />
        <div className="flex flex-col justify-center space-y-5">
          <div className="h-6 w-48 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="h-12 w-4/5 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="h-28 w-full animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="h-11 w-56 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
        </div>
      </section>
      <section className="border-y border-[var(--color-border)] bg-white/50 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto h-9 max-w-sm animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="mt-10 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="aspect-[4/3] animate-pulse rounded-lg bg-[var(--color-blush)] motion-reduce:animate-none" />
            <div className="aspect-video animate-pulse rounded-lg bg-[var(--color-blush)] motion-reduce:animate-none" />
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="min-h-64 animate-pulse rounded-2xl bg-white/80 motion-reduce:animate-none" />
      </section>
    </div>
  );
}
