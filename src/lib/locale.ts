import { routing, type Locale } from "@/i18n/routing";

export const supportedLocales = routing.locales;
export const defaultLocale = routing.defaultLocale;

export function isSupportedLocale(value: string | undefined): value is Locale {
  return supportedLocales.includes(value as Locale);
}

export function normalizeLocale(value: string | undefined): Locale {
  return isSupportedLocale(value) ? value : defaultLocale;
}

export function getLocaleConfig() {
  return {
    locales: supportedLocales,
    defaultLocale,
  };
}
