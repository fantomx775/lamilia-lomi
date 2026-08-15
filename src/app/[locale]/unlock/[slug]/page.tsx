import { notFound, redirect } from "next/navigation";

import type { Locale } from "@/i18n/routing";
import { getLocalizedProductView } from "@/lib/products";

type Props = {
  params: Promise<{ locale: Locale; slug: string }>;
};

export default async function QrUnlockEntry({ params }: Props) {
  const { locale, slug } = await params;

  if (!getLocalizedProductView(slug, locale)) {
    notFound();
  }

  redirect(`/${locale}/products/${slug}#premium`);
}
