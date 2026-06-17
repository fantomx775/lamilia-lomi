import type { Locale } from "@/i18n/routing";

import { getContentSnapshot } from "./content-store";

export function getStaticPage(slug: "privacy" | "terms", locale: Locale) {
  const snapshot = getContentSnapshot();
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
