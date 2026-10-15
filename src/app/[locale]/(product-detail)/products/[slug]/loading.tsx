function SkeletonBlock({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none ${className}`}
    />
  );
}

export default function ProductDetailLoading() {
  return (
    <div
      data-testid="product-detail-loading"
      aria-busy="true"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading product details</span>

      <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 lg:px-8">
        <SkeletonBlock className="h-9 w-36 rounded-md" />
      </div>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-12 lg:px-8">
        <div className="w-full max-w-[360px] justify-self-center lg:justify-self-start">
          <SkeletonBlock className="aspect-[8.5/11] w-full rounded-lg" />
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap gap-2">
            <SkeletonBlock className="h-7 w-24 rounded-full" />
            <SkeletonBlock className="h-7 w-28 rounded-full" />
            <SkeletonBlock className="h-7 w-20 rounded-full" />
          </div>
          <SkeletonBlock className="mt-5 h-11 w-4/5 max-w-xl sm:h-14" />
          <div className="mt-4 space-y-2">
            <SkeletonBlock className="h-4 w-full max-w-2xl" />
            <SkeletonBlock className="h-4 w-11/12 max-w-2xl" />
            <SkeletonBlock className="h-4 w-4/5 max-w-2xl" />
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <SkeletonBlock className="h-11 w-full sm:w-44" />
            <SkeletonBlock className="h-11 w-full sm:w-48" />
          </div>
          <div className="mt-7 max-h-[168px] overflow-hidden space-y-3">
            <SkeletonBlock className="h-4 w-full max-w-2xl" />
            <SkeletonBlock className="h-4 w-full max-w-2xl" />
            <SkeletonBlock className="h-4 w-11/12 max-w-2xl" />
            <SkeletonBlock className="h-4 w-full max-w-2xl" />
            <SkeletonBlock className="h-4 w-4/5 max-w-2xl" />
            <SkeletonBlock className="h-4 w-full max-w-2xl" />
            <SkeletonBlock className="h-4 w-3/4 max-w-2xl" />
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--color-border)] bg-white/50">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <SkeletonBlock className="mx-auto h-8 w-56 max-w-full sm:h-9" />
            <div className="mx-auto mt-3 space-y-2">
              <SkeletonBlock className="mx-auto h-4 w-full max-w-xl" />
              <SkeletonBlock className="mx-auto h-4 w-4/5 max-w-xl" />
            </div>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {Array.from({ length: 4 }, (_, index) => (
                <SkeletonBlock
                  key={index}
                  className="aspect-[8.5/11] w-full rounded-lg"
                />
              ))}
            </div>
            <SkeletonBlock className="aspect-video w-full rounded-lg" />
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <SkeletonBlock className="h-4 w-32" />
            <SkeletonBlock className="h-9 w-3/4" />
            <SkeletonBlock className="h-20 w-full" />
          </div>
          <div className="min-h-52 rounded-lg border border-[var(--color-border)] bg-white/75 p-5">
            <SkeletonBlock className="h-6 w-2/3" />
            <SkeletonBlock className="mt-5 h-10 w-full" />
            <SkeletonBlock className="mt-4 h-11 w-40" />
          </div>
        </div>
      </section>
    </div>
  );
}
