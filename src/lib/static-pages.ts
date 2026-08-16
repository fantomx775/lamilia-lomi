import type { Locale } from "@/i18n/routing";

import { getPublicContentSnapshot } from "./content-repository";
import { getContentSnapshot } from "./content-store";

export function getStaticPage(slug: "privacy" | "terms", locale: Locale) {
  return getStaticPageFromSnapshot(getContentSnapshot(), slug, locale);
}

export function getStaticPageFromSnapshot(
  snapshot: ReturnType<typeof getContentSnapshot>,
  slug: "privacy" | "terms",
  locale: Locale,
) {
  const page =
    snapshot.staticPages.find((item) => item.slug === slug && item.locale === locale) ??
    snapshot.staticPages.find((item) => item.slug === slug && item.locale === "en");

  if (page) {
    return {
      title: page.title,
      body: page.body,
    };
  }

  return {
    title: slug === "privacy" ? "Privacy Policy" : "Terms",
    body: "Replace this placeholder before production.",
  };
}

export async function getStaticPageForRequest(
  slug: "privacy" | "terms",
  locale: Locale,
) {
  return getStaticPageFromSnapshot(await getPublicContentSnapshot(), slug, locale);
}
