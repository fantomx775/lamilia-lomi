import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";

import { CookieConsentBanner } from "@/components/cookie-consent";
import { SiteFooter } from "@/components/site-footer";
import { ToastProvider } from "@/components/ui/toast";
import { CommunityRouteNavigationProvider, CommunityRoutePendingRegion } from "@/components/community/community-route-transition";
import { SiteHeader } from "@/components/site-header";
import { routing, type Locale } from "@/i18n/routing";

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <ToastProvider>
        <CommunityRouteNavigationProvider><div data-public-storefront className="flex min-h-dvh flex-1 flex-col">
          <SiteHeader locale={locale as Locale} />
          <main className="flex-1"><CommunityRoutePendingRegion>{children}</CommunityRoutePendingRegion></main>
          <SiteFooter locale={locale as Locale} />
          <CookieConsentBanner />
        </div></CommunityRouteNavigationProvider>
      </ToastProvider>
    </NextIntlClientProvider>
  );
}
