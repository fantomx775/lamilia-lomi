import { publicImageAlt } from "@/lib/product-display";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NavigationLink } from "@/components/navigation-link";
import { buttonClassName } from "@/components/ui/button";
import { getLocalizedProductDetailViewForRequest } from "@/lib/products-request";
import { getProductDetailAccessForRequest } from "@/lib/session.server";
import { getBackendMode } from "@/lib/config";
import { createSignedDownloadUrl } from "@/lib/premium-core";
import type { Locale } from "@/i18n/routing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My files", robots: { index: false, follow: false } };

export default async function LibraryBookFilesPage({ params }: { params: Promise<{ locale: Locale; slug: string }> }) {
  const { locale, slug } = await params;
  const product = await getLocalizedProductDetailViewForRequest(slug, locale);
  if (!product) notFound();
  const access = await getProductDetailAccessForRequest(product.id);
  const returnTo = `/${locale}/library/books/${encodeURIComponent(product.slug)}`;
  if (!access.session || !access.session.emailVerified || !access.isUnlocked) {
    const href = !access.session ? `/${locale}/login?returnTo=${encodeURIComponent(returnTo)}` : !access.session.emailVerified ? `/${locale}/account` : `/${locale}/products/${encodeURIComponent(product.slug)}#premium`;
    return <section className="mx-auto max-w-3xl px-4 py-12" data-testid="library-files-denied"><h1 className="font-serif text-3xl font-semibold">Open your book files</h1><p className="mt-4">{!access.session ? "Log in to see the files for your books." : !access.session.emailVerified ? "Verify your email before opening protected files." : "Unlock this book with the code in your copy before opening its files."}</p><NavigationLink href={href} pendingLabel="Opening the next step" className={buttonClassName({ className: "mt-5" })}>{!access.session ? "Log in" : !access.session.emailVerified ? "Open account" : "Unlock this book"}</NavigationLink></section>;
  }
  const links = product.premiumAssets.flatMap((asset) => {
    const local = getBackendMode() === "local";
    const signed = local && access.localSession ? createSignedDownloadUrl({ asset, product: { id: product.id, status: product.status }, session: access.localSession }) : null;
    const href = local ? signed?.ok ? signed.url : null : `/api/downloads/${asset.id}?locale=${locale}&returnTo=${encodeURIComponent(returnTo)}`;
    return href ? [{ asset, href }] : [];
  });
  return <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6" data-testid="library-files-page">
    <NavigationLink href={`/${locale}/library`} pendingLabel="Opening My Library" className="inline-flex min-h-11 items-center underline underline-offset-4">Back to My Library</NavigationLink>
    <p className="mt-6 text-sm text-[var(--color-terracotta)]">Your bonus files</p><h1 className="mt-2 break-words font-serif text-3xl font-semibold">{product.title}</h1>
    {links.length ? <ul className="mt-6 grid gap-3">{links.map(({ asset, href }) => <li key={asset.id}><a href={href} className={buttonClassName({ variant: "secondary", className: "h-auto min-h-14 w-full justify-between whitespace-normal text-left" })}><span className="break-words">{publicImageAlt(asset.title, "Bonus file")}</span>{" "}<span className="ml-4 text-sm">Download{asset.contentType === "application/pdf" ? " PDF" : ""}</span></a></li>)}</ul> : <p className="mt-6 rounded-lg border border-[var(--color-border)] p-5">There are no bonus files available for this book yet.</p>}
    <NavigationLink href={`/${locale}/products/${encodeURIComponent(product.slug)}`} pendingLabel="Opening book details" className="mt-6 inline-flex min-h-11 items-center underline underline-offset-4">View book details</NavigationLink>
  </section>;
}
