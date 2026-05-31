import type { Locale } from "@/i18n/routing";

export function getStaticPage(slug: "privacy" | "terms", locale: Locale) {
  const isPolish = locale === "pl";

  if (slug === "privacy") {
    return {
      title: isPolish ? "Polityka prywatności" : "Privacy Policy",
      body: isPolish
        ? "LamiliaLomi przechowuje dane konta, zgody, odblokowania produktów i zdarzenia pobrań wyłącznie w celu obsługi konta oraz materiałów premium. Treść zostanie zastąpiona finalną polityką właścicielki przed produkcją."
        : "LamiliaLomi stores account data, consents, product unlocks, and download events only to operate accounts and premium materials. This placeholder must be replaced with the owner's final policy before production.",
    };
  }

  return {
    title: isPolish ? "Regulamin" : "Terms",
    body: isPolish
      ? "Konto wymaga akceptacji regulaminu i polityki prywatności. Zgoda marketingowa jest osobna i dobrowolna. Ten tekst jest placeholderem do podmiany przed startem produkcyjnym."
      : "An account requires acceptance of terms and privacy. Marketing consent is separate and optional. This text is a launch placeholder and must be replaced before production.",
  };
}
