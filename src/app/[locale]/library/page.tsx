import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { NavigationLink } from "@/components/navigation-link";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { publicImageAlt } from "@/lib/product-display";
import { buttonClassName } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import { getCommunityFlags } from "@/lib/community-flags";
import { getMyCommunityProfile } from "@/lib/community/repository";
import {
  getLocalizedProductViewForRequest,
  getProductByIdForRequest,
} from "@/lib/products-request";
import { getDemoSession } from "@/lib/session.server";

export const metadata: Metadata = { title: "My Library", description: "Open the bonus files for the LamiliaLomi books you have unlocked.", robots: { index: false, follow: false } };

type Props = {
  params: Promise<{ locale: Locale }>;
};

export default async function LibraryPage({ params }: Props) {
  const { locale } = await params;
  const session = await getDemoSession();
  const t = await getTranslations("Library");
  const communityFlags = getCommunityFlags();
  const hasPrivateCommunityProfile = Boolean(
    session?.emailVerified
      && !communityFlags.uploadsEnabled
      && await getMyCommunityProfile(),
  );
  const showMyCreationsLink = communityFlags.uploadsEnabled || hasPrivateCommunityProfile;

  if (!session) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12" data-testid="library-guest-state">
        <Card>
          <CardHeader>
            <h1 className="font-serif text-3xl font-semibold">{t("title")}</h1>
          </CardHeader>
          <CardContent>
            <p className="text-[var(--color-muted)]">{t("guest")}</p>
            <NavigationLink
              className="mt-4 inline-flex rounded-sm text-[var(--color-terracotta)] transition-colors duration-100 motion-reduce:transition-none hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-terracotta)] active:opacity-70"
              href={`/${locale}/login?returnTo=${encodeURIComponent(`/${locale}/library`)}`}
              pendingLabel="Opening login"
            >
              {t("login")}
            </NavigationLink>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!session.emailVerified) {
    return <section className="mx-auto max-w-3xl px-4 py-12" data-testid="library-unverified-state">
      <h1 className="font-serif text-3xl font-semibold">{t("title")}</h1>
      <p role="status" className="mt-4 rounded-lg bg-[var(--color-sage)] p-4">Verify your email to open your files. Your book access will be checked after verification.</p>
      <NavigationLink href={`/${locale}/account`} pendingLabel="Opening account" className={buttonClassName({ className: "mt-5" })}>Open account</NavigationLink>
    </section>;
  }

  const unlockedProducts = (await Promise.all(
    session.unlockedProductIds.map(async (productId) => {
      const product = await getProductByIdForRequest(productId);

      return product
        ? getLocalizedProductViewForRequest(product.slug, locale)
        : null;
    }),
  ))
    .filter((product): product is NonNullable<typeof product> => Boolean(product));

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8" data-testid="library-page">
      <h1 className="font-serif text-4xl font-semibold">{t("title")}</h1>
      <p className="mt-3 text-[var(--color-muted)]">{t("description")}</p>
      {showMyCreationsLink ? (
        <Card className="mt-6" data-testid="library-community-link">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h2 className="font-serif text-xl font-semibold text-[var(--color-ink)]">My Creations</h2>
              <p className="mt-1 text-sm text-[var(--color-muted)]">Manage your private community submissions and review status.</p>
            </div>
            <NavigationLink
              className="inline-flex min-h-10 items-center rounded-md border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
              href={`/${locale}/library/creations`}
              pendingLabel="Opening My Creations"
            >
              Open My Creations
            </NavigationLink>
          </CardContent>
        </Card>
      ) : null}
      {unlockedProducts.length ? (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {unlockedProducts.map((product, index) => (
            <article key={product.id} className="flex min-w-0 flex-col rounded-xl border border-[var(--color-border)] bg-white/80 p-5" data-testid="library-book-card">
              <div className="relative mx-auto aspect-[8.5/11] w-40 max-w-full overflow-hidden rounded-lg bg-[var(--color-blush)]"><ImageWithFallback src={product.cover.path} alt={publicImageAlt(product.cover.title, `${product.title} cover`)} loading={index === 0 ? "eager" : "lazy"} sizes="160px" className="object-contain" /></div>
              <h2 className="mt-4 break-words font-serif text-2xl font-semibold [overflow-wrap:anywhere]">{product.title}</h2>
              <p className="mt-2 text-sm text-[var(--color-muted)]">{product.premiumAssets.length} bonus {product.premiumAssets.length === 1 ? "file" : "files"}{product.premiumAssets.length ? ` · ${[...new Set(product.premiumAssets.map((asset) => asset.contentType === "application/pdf" ? "PDF" : asset.contentType === "application/zip" ? "ZIP" : asset.contentType.startsWith("image/") ? "Images" : "Downloads"))].join(", ")}` : ""}</p>
              <NavigationLink href={`/${locale}/library/books/${encodeURIComponent(product.slug)}`} pendingLabel="Opening your files" className={buttonClassName({ variant: "secondary", className: "mt-5 whitespace-normal text-center" })}>Open my files</NavigationLink>
              <NavigationLink href={`/${locale}/products/${encodeURIComponent(product.slug)}`} pendingLabel="Opening book details" className="mt-3 inline-flex min-h-11 items-center justify-center rounded text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">View book details</NavigationLink>
            </article>
          ))}
        </div>
      ) : (
        <Card className="mt-8" data-testid="library-empty-state">
          <CardHeader>
            <h2 className="font-serif text-2xl font-semibold">{t("emptyTitle")}</h2>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--color-muted)]">{t("emptyDescription")}</p>
            <NavigationLink pendingLabel="Opening catalog" className="mt-5 inline-flex rounded-sm text-sm font-medium text-[var(--color-terracotta)] transition-colors duration-100 motion-reduce:transition-none hover:text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-terracotta)] active:opacity-70" href={`/${locale}/unlock`}>
              Unlock my book bonus
            </NavigationLink>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
