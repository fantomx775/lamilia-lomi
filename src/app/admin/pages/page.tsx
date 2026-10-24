import { getAdminContentSnapshot } from "@/lib/content-repository";

import { PagesResourceList, type AdminPageListRow } from "./pages-list";
import { AdminRouteToast } from "@/components/admin/admin-toast";

export default async function AdminPagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const { staticPages } = await getAdminContentSnapshot();
  const slugs = Array.from(new Set(staticPages.map((page) => page.slug)));
  const rows: AdminPageListRow[] = slugs.map((slug) => {
    const records = staticPages.filter((page) => page.slug === slug);
    const titleRecord = records.find((page) => page.locale === "en");
    const updatedAt = records
      .map((page) => Date.parse(page.updatedAt))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => b - a)[0];

    return {
      id: slug,
      title: titleRecord?.title.trim() || slug,
      slug,
      updatedAt: Number.isFinite(updatedAt)
        ? new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium" }).format(updatedAt)
        : "—",
    };
  });

  rows.unshift({
    id: "about",
    title: "About Lamilia Lomi",
    slug: "about",
    updatedAt: "—",
  });

  const toastId = typeof query.toast === "string" && /^[0-9a-f-]{36}$/i.test(query.toast) ? query.toast : undefined;
  return <><PagesResourceList rows={rows} /><AdminRouteToast eventId={toastId} kind={query.error ? "error" : "success"} message={query.error ? "Nie udało się zapisać zmian strony." : "Zmiany strony zostały zapisane."} cleanPath="/admin/pages" /></>;
}
