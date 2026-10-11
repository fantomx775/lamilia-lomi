import type { Metadata } from "next";

import type { Locale } from "@/i18n/routing";
import { getAboutPageSettingsForRequest } from "@/lib/content-repository";
import { getPublishedProductViewsForRequest } from "@/lib/products-request";

import { AboutPageContent } from "./about-page-content";

type Props = {
  params: Promise<{ locale: Locale }>;
};

export const metadata: Metadata = {
  title: "About Lamilia Lomi",
  description:
    "Meet Lamilia Lomi and explore our favorite coloring books and picture books.",
};

export default async function AboutPage({ params }: Props) {
  const { locale } = await params;
  const [settings, products] = await Promise.all([
    getAboutPageSettingsForRequest(),
    getPublishedProductViewsForRequest(locale),
  ]);

  return (
    <AboutPageContent locale={locale} settings={settings} products={products} />
  );
}
