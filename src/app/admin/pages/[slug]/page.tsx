import { notFound } from "next/navigation";

import { saveStaticPagesAction } from "@/app/admin/actions";
import { getAdminContentSnapshot } from "@/lib/content-repository";
import { formatAdminErrors } from "@/lib/admin-errors";
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
  const error = query.error ? formatAdminErrors(query.error, "pl") : undefined;
  const feedback = error ?? (query.saved ? "Zapisano wszystkie wersje językowe." : undefined);
  const records = (await getAdminContentSnapshot()).staticPages.filter(
    (page) => page.slug === slug,
  );

  const saveAction = saveStaticPagesAction.bind(null, slug);

  return <PageEditor slug={slug} title={records.find((record) => record.locale === "en")?.title ?? slug} records={records} feedback={feedback} saveAction={saveAction} />;
}
