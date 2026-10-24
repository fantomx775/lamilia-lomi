import {
  deleteTagInlineAction,
  saveTagInlineAction,
} from "@/app/admin/actions";
import { getAdminDisplayName } from "@/lib/admin-list";
import { getAdminContentSnapshot } from "@/lib/content-repository";

import { TagsResourceList, type AdminTagListRow } from "./tags-list";
import { AdminRouteToast } from "@/components/admin/admin-toast";

export default async function AdminTagsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const { products, tags } = await getAdminContentSnapshot();
  const rows: AdminTagListRow[] = tags.map((tag) => ({
    id: tag.id,
    name: getAdminDisplayName(tag.translations, tag.slug),
    slug: tag.slug,
    productCount: products.filter((product) => product.tagIds.includes(tag.id)).length,
  }));

  const toastId = typeof query.toast === "string" && /^[0-9a-f-]{36}$/i.test(query.toast) ? query.toast : undefined;
  return (
    <>
    <TagsResourceList
      rows={rows}
      items={tags}
      saveAction={saveTagInlineAction}
      deleteAction={deleteTagInlineAction}
    />
    <AdminRouteToast eventId={toastId} kind={query.error ? "error" : "success"} message={query.error ? "Nie udało się zapisać zmian tagu." : "Zmiany tagu zostały zapisane."} cleanPath="/admin/tags" />
    </>
  );
}
