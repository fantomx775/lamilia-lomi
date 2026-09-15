export default function LocaleLoading() {
  return (
    <div data-testid="localized-page-loading" aria-busy="true">
      <p className="sr-only" role="status" aria-live="polite">
        Loading page
      </p>
      <section className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-7xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
        <div className="max-w-2xl">
          <div className="h-9 w-64 animate-pulse rounded-md bg-white/70 motion-reduce:animate-none" />
          <div className="mt-6 h-16 w-4/5 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none sm:h-20" />
          <div className="mt-6 space-y-3">
            <div className="h-5 w-full animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
            <div className="h-5 w-5/6 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
            <div className="h-5 w-2/3 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <div className="h-11 w-48 animate-pulse rounded-md bg-[var(--color-ink)]/15 motion-reduce:animate-none" />
            <div className="h-11 w-36 animate-pulse rounded-md bg-white/70 motion-reduce:animate-none" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }, (_, index) => (
            <div
              key={index}
              className="aspect-[3/4] animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-blush)] motion-reduce:animate-none"
            />
          ))}
        </div>
      </section>
    </div>
  );
}
