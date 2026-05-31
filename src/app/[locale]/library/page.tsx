import Link from "next/link";

import { ProductCard } from "@/components/product-card";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import { getLocalizedProductView } from "@/lib/products";
import { getDemoSession } from "@/lib/session.server";

type Props = {
  params: Promise<{ locale: Locale }>;
};

export default async function LibraryPage({ params }: Props) {
  const { locale } = await params;
  const session = await getDemoSession();

  if (!session) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Card>
          <CardHeader>
            <h1 className="font-serif text-3xl font-semibold">My Library</h1>
          </CardHeader>
          <CardContent>
            <p className="text-[var(--color-muted)]">Log in to see unlocked products.</p>
            <Link className="mt-4 inline-flex text-[var(--color-terracotta)]" href={`/${locale}/login`}>
              Log in
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const unlockedProducts = session.unlockedProductIds
    .map((productId) => {
      const slug =
        productId === "11111111-1111-4111-8111-111111111111"
          ? "moon-garden-coloring-book"
          : productId === "22222222-2222-4222-8222-222222222222"
            ? "mindful-mandalas-for-adults"
            : "bedtime-forest-picture-book";

      return getLocalizedProductView(slug, locale);
    })
    .filter((product): product is NonNullable<typeof product> => Boolean(product));

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="font-serif text-4xl font-semibold">My Library</h1>
      <p className="mt-3 text-[var(--color-muted)]">
        Permanent product unlocks for {session.email}.
      </p>
      {unlockedProducts.length ? (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {unlockedProducts.map((product) => (
            <ProductCard key={product.id} product={product} locale={locale} />
          ))}
        </div>
      ) : (
        <Card className="mt-8">
          <CardHeader>
            <h2 className="font-serif text-2xl font-semibold">No unlocked products yet</h2>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--color-muted)]">
              Open a product page and enter the code printed in your physical
              book.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
