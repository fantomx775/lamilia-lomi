import type { TaxonomyTranslation } from "@/lib/types";

export function getAdminDisplayName(
  translations: TaxonomyTranslation[],
  fallback: string,
) {
  const english = translations.find((translation) => translation.locale === "en")?.name;
  return english?.trim() || fallback;
}
