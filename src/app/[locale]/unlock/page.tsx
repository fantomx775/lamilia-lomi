import type { Metadata } from "next";
import { NavigationLink } from "@/components/navigation-link";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { buttonClassName } from "@/components/ui/button";
import type { Locale } from "@/i18n/routing";
import { getPublishedProductViewsForRequest } from "@/lib/products-request";
import { publicImageAlt } from "@/lib/product-display";

export const metadata: Metadata = {
  title: "Unlock my book bonus",
  description: "Choose your LamiliaLomi book to find its bonus files and code instructions.",
  robots: { index: false, follow: true },
};

export default async function UnlockBookPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  const products = await getPublishedProductViewsForRequest(locale);
  return <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
    <h1 className="font-serif text-3xl font-semibold">Unlock my book bonus</h1>
    <p className="mt-4 max-w-2xl leading-7 text-[var(--color-muted)]">Choose the book you own. You can find its bonus code or QR inside your printed book. On the next page, enter the code in Premium materials and log in when asked. Your book and code will stay with you through sign-in.</p>
    {products.length ? <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => <li key={product.id} className="min-w-0 rounded-xl border border-[var(--color-border)] bg-white p-4">
        <div className="relative mx-auto aspect-[8.5/11] w-full max-w-40"><ImageWithFallback src={product.cover.path} alt={publicImageAlt(product.cover.title, `${product.title} cover`)} sizes="160px" className="object-contain" /></div>
        <h2 className="mt-4 break-words font-serif text-xl [overflow-wrap:anywhere]">{product.title}</h2>
        <NavigationLink className={buttonClassName({ className: "mt-4" })} href={`/${locale}/products/${product.slug}#premium`} pendingLabel="Opening book bonuses">Choose this book</NavigationLink>
      </li>)}
    </ul> : <p className="mt-8">There are no books available here right now. Please try again later or contact us for help with your book.</p>}
    <NavigationLink className="mt-8 inline-flex min-h-11 items-center text-[var(--color-terracotta)] underline" href={`/${locale}/contact`} pendingLabel="Opening contact">Need help with your code?</NavigationLink>
  </section>;
}
