import type { Locale } from "@/i18n/routing";
import { getStaticPage } from "@/lib/static-pages";

type Props = {
  params: Promise<{ locale: Locale }>;
};

export default async function TermsPage({ params }: Props) {
  const { locale } = await params;
  const page = getStaticPage("terms", locale);

  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-serif text-4xl font-semibold">{page.title}</h1>
      <p className="prose-lomi mt-6">{page.body}</p>
    </article>
  );
}
