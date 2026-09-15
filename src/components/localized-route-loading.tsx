type LocalizedRouteLoadingProps = {
  label: string;
  variant?: "content" | "cards" | "form";
};

export function LocalizedRouteLoading({
  label,
  variant = "content",
}: LocalizedRouteLoadingProps) {
  return (
    <div
      className="mx-auto min-h-[calc(100svh-8rem)] max-w-7xl px-4 py-12 sm:px-6 lg:px-8"
      data-testid="localized-route-loading"
      aria-busy="true"
    >
      <p className="sr-only" role="status" aria-live="polite">{label}</p>
      {variant === "form" ? (
        <div className="mx-auto max-w-md rounded-xl border border-[var(--color-border)] bg-white/80 p-6">
          <div className="h-9 w-2/3 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="mt-4 h-5 w-full animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="mt-8 h-4 w-24 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="mt-2 h-11 w-full animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="mt-5 h-4 w-24 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="mt-2 h-11 w-full animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="mt-6 h-11 w-full animate-pulse rounded bg-[var(--color-sage)] motion-reduce:animate-none" />
        </div>
      ) : variant === "cards" ? (
        <>
          <div className="h-10 w-1/2 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white/80">
                <div className="aspect-[3/4] animate-pulse bg-[var(--color-blush)] motion-reduce:animate-none" />
                <div className="space-y-3 p-5">
                  <div className="h-6 w-3/4 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
                  <div className="h-4 w-full animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="mx-auto max-w-4xl">
          <div className="h-10 w-2/3 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="mt-5 h-5 w-full animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="mt-2 h-5 w-5/6 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <div className="h-40 animate-pulse rounded-xl border border-[var(--color-border)] bg-white/80 motion-reduce:animate-none" />
            <div className="h-40 animate-pulse rounded-xl border border-[var(--color-border)] bg-white/80 motion-reduce:animate-none" />
          </div>
        </div>
      )}
    </div>
  );
}
