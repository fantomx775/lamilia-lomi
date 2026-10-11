import Link from "next/link";

export default function ProductDetailNotFound() {
  return (
    <main className="grid min-h-[calc(100svh-8rem)] place-items-center px-6 py-16">
      <div className="w-full max-w-xl rounded-2xl border border-[var(--color-border)] bg-white/80 p-8 text-center shadow-[0_18px_46px_rgba(62,52,47,0.1)] sm:p-10">
        <h1 className="font-serif text-4xl font-semibold leading-tight sm:text-5xl">
          Product not found
        </h1>
        <p className="mt-4 leading-7 text-[var(--color-muted)]">
          This product page is no longer available.
        </p>
        <Link
          href="/en/products"
          className="mt-7 inline-flex rounded-md bg-[var(--color-ink)] px-5 py-3 text-sm font-medium text-white focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-terracotta)]"
        >
          Browse catalog
        </Link>
      </div>
    </main>
  );
}
