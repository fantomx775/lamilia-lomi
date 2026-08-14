import type { TaxonomyTranslation } from "@/lib/types";

export function getAdminDisplayName(
  translations: TaxonomyTranslation[],
  fallback: string,
) {
  const english = translations.find((translation) => translation.locale === "en")?.name;
  const firstAvailable = translations.find((translation) => translation.name.trim())?.name;

  return english?.trim() || firstAvailable?.trim() || fallback;
}

export function getAdminLanguageCodes(translations: Array<{ locale: string }>) {
  return Array.from(new Set(translations.map((translation) => translation.locale)));
}
