import { permanentRedirect } from "next/navigation";
import type { Locale } from "@/i18n/routing";

/** Existing Author links keep working; the brand has one truthful introduction. */
export default async function AuthorPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/about`);
}
