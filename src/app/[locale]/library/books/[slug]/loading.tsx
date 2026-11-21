export default function Loading() {
  return <section role="status" aria-busy="true" className="mx-auto max-w-4xl px-4 py-10 sm:px-6"><span className="sr-only">Loading your book files</span><div className="h-11 w-40 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" /><div className="mt-6 h-12 max-w-md animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" /><div className="mt-6 grid gap-3">{[0, 1, 2].map((id) => <div key={id} className="h-14 animate-pulse rounded bg-[var(--color-blush)] motion-reduce:animate-none" />)}</div></section>;
}
