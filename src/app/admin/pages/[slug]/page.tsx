import { notFound } from "next/navigation";

import { saveStaticPagesAction } from "@/app/admin/actions";
import { getAdminContentSnapshot } from "@/lib/content-repository";
import { PageEditor } from "../page-editor";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditPage({ params, searchParams }: Props) {
  const { slug } = await params;
  if (slug !== "privacy" && slug !== "terms") {
    notFound();
  }

  const query = await searchParams;
  const error = Array.isArray(query.error) ? query.error[0] : query.error;
  const feedback = error ?? (query.saved ? "Zapisano wszystkie wersje językowe." : undefined);
  const records = (await getAdminContentSnapshot()).staticPages.filter(
    (page) => page.slug === slug,
  );

  const saveAction = saveStaticPagesAction.bind(null, slug);

  return <PageEditor slug={slug} title={records.find((record) => record.locale === "en")?.title ?? slug} records={records} feedback={feedback} saveAction={saveAction} />;
}
