import { getAdminLanguageCodes } from "@/lib/admin-list";
import { getAdminContentSnapshot } from "@/lib/content-repository";

import { PagesResourceList, type AdminPageListRow } from "./pages-list";

export default async function AdminPagesPage() {
  const { staticPages } = await getAdminContentSnapshot();
  const slugs = Array.from(new Set(staticPages.map((page) => page.slug)));
  const rows: AdminPageListRow[] = slugs.map((slug) => {
    const records = staticPages.filter((page) => page.slug === slug);
    const titleRecord = records.find((page) => page.locale === "en") ?? records[0];
    const updatedAt = records
      .map((page) => Date.parse(page.updatedAt))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => b - a)[0];

    return {
      id: slug,
      title: titleRecord?.title.trim() || slug,
      slug,
      languageCodes: getAdminLanguageCodes(records),
      updatedAt: Number.isFinite(updatedAt)
        ? new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium" }).format(updatedAt)
        : "—",
    };
  });

  return <PagesResourceList rows={rows} />;
}
