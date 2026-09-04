import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { ProductCard } from "@/components/product-card";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import {
  getLocalizedProductViewForRequest,
  getProductByIdForRequest,
} from "@/lib/products-request";
import { getDemoSession } from "@/lib/session.server";

type Props = {
  params: Promise<{ locale: Locale }>;
};

export default async function LibraryPage({ params }: Props) {
  const { locale } = await params;
  const session = await getDemoSession();
  const t = await getTranslations("Library");

  if (!session) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12" data-testid="library-guest-state">
        <Card>
          <CardHeader>
            <h1 className="font-serif text-3xl font-semibold">{t("title")}</h1>
          </CardHeader>
          <CardContent>
            <p className="text-[var(--color-muted)]">{t("guest")}</p>
            <Link
              className="mt-4 inline-flex text-[var(--color-terracotta)]"
              href={`/${locale}/login?returnTo=${encodeURIComponent(`/${locale}/library`)}`}
            >
              {t("login")}
            </Link>
          </CardContent>
        </Card>
      </div>
    );
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
      {unlockedProducts.length ? (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {unlockedProducts.map((product) => (
            <ProductCard key={product.id} product={product} locale={locale} />
          ))}
        </div>
      ) : (
        <Card className="mt-8" data-testid="library-empty-state">
          <CardHeader>
            <h2 className="font-serif text-2xl font-semibold">{t("emptyTitle")}</h2>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--color-muted)]">{t("emptyDescription")}</p>
            <Link className="mt-5 inline-flex text-sm font-medium text-[var(--color-terracotta)]" href={`/${locale}/products`}>
              {t("browse")}
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
