import { notFound, redirect } from "next/navigation";

import type { Locale } from "@/i18n/routing";
import { getLocalizedProductViewForRequest } from "@/lib/products-request";

type Props = {
  params: Promise<{ locale: Locale; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function QrUnlockEntry({ params, searchParams }: Props) {
  const { locale, slug } = await params;
  const query = await searchParams;
  const product = await getLocalizedProductViewForRequest(slug, locale);

  if (!product) {
    notFound();
  }

  const code = stringParam(query.code) ?? stringParam(query.premiumCode);
  const redirectQuery = code?.trim() ? `?code=${encodeURIComponent(code)}` : "";

  redirect(`/api/unlock/${locale}/${product.slug}${redirectQuery}`);
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
