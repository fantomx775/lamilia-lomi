import type { Locale } from "@/i18n/routing";
import { getStaticPageForRequest } from "@/lib/static-pages";

type Props = {
  params: Promise<{ locale: Locale }>;
};

export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;
  const page = await getStaticPageForRequest("privacy", locale);

  return <StaticPage title={page.title} body={page.body} />;
}

function StaticPage({ title, body }: { title: string; body: string }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-serif text-4xl font-semibold">{title}</h1>
      <p className="prose-lomi mt-6">{body}</p>
    </article>
  );
}
