export default function AdminLoading() {
  return (
    <div data-testid="admin-route-loading" aria-busy="true">
      <p className="sr-only" role="status" aria-live="polite">
        Ładowanie strony panelu administracyjnego
      </p>
      <div className="h-8 w-2/3 max-w-sm animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
      <div className="mt-3 h-5 w-full max-w-xl animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="min-h-40 animate-pulse rounded-xl border border-[var(--color-border)] bg-white/80 motion-reduce:animate-none"
          />
        ))}
      </div>
    </div>
  );
}
