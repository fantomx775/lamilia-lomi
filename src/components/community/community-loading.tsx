export function CommunityLoading({ variant = "gallery" }: { variant?: "gallery" | "artwork" | "creator" }) {
  const pulse = "animate-pulse rounded-lg bg-[var(--color-blush)] motion-reduce:animate-none";
  return <div role="status" aria-busy="true" data-testid={`community-${variant}-loading`} className={`mx-auto min-h-[60vh] px-4 py-8 sm:px-6 sm:py-12 lg:px-8 ${variant === "creator" ? "max-w-5xl" : "max-w-7xl"}`}>
    <span className="sr-only">Loading {variant === "artwork" ? "artwork" : variant === "creator" ? "creator profile" : "Coloring Club"}</span>
    {variant === "artwork" ? <><div className={`${pulse} h-11 w-48`} /><div className="mt-5 grid gap-7 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)] lg:gap-10"><div className={`${pulse} min-h-96 aspect-[4/5] sm:aspect-[5/4] lg:aspect-[4/5]`} /><div className={`${pulse} h-96`} /></div></> : <>
      <div className={variant === "creator" ? "mb-6 flex items-center gap-4" : "mb-7 rounded-2xl border border-[var(--color-border)] p-6 sm:p-9"}>
        {variant === "creator" ? <div className={`${pulse} size-16 shrink-0 rounded-full sm:size-20`} /> : null}
        <div className="w-full"><div className={`${pulse} h-5 w-32`} /><div className={`${pulse} mt-2 h-12 w-96 max-w-full`} />{variant === "gallery" ? <div className={`${pulse} mt-3 h-14 max-w-2xl`} /> : null}</div>
      </div>
      {variant === "gallery" ? <div className="mb-7 grid gap-3 rounded-xl border border-[var(--color-border)] p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">{[0, 1, 2].map((index) => <div key={index}><div className={`${pulse} mb-1.5 h-5 w-20`} /><div className={`${pulse} h-11`} /></div>)}</div> : null}
      <div className={variant === "creator" ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3" : "grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4"}>{Array.from({ length: variant === "creator" ? 3 : 8 }, (_, index) => <div key={index} className="overflow-hidden rounded-xl border border-[var(--color-border)]"><div className={`${pulse} aspect-[4/5]`} /><div className="space-y-3 p-3 sm:p-4"><div className={`${pulse} h-10`} /><div className={`${pulse} h-8 w-3/4`} /><div className={`${pulse} h-5 w-1/2`} /></div></div>)}</div>
    </>}
  </div>;
}
