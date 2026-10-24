import {
  deleteCategoryInlineAction,
  saveCategoryInlineAction,
} from "@/app/admin/actions";
import { getAdminDisplayName } from "@/lib/admin-list";
import { getAdminContentSnapshot } from "@/lib/content-repository";

import { CategoriesResourceList, type AdminCategoryListRow } from "./categories-list";
import { AdminRouteToast } from "@/components/admin/admin-toast";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminCategoriesPage({ searchParams }: Props) {
  const query = await searchParams;
  const categoryId = query.categoryId;
  const toastId = typeof query.toast === "string" && /^[0-9a-f-]{36}$/i.test(query.toast) ? query.toast : undefined;
  const cleanupDeferredCategoryId = query.cleanupDeferred === "1" && typeof categoryId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(categoryId)
    ? categoryId
    : undefined;
  const { categories, products } = await getAdminContentSnapshot();
  const rows: AdminCategoryListRow[] = categories.map((category) => ({
    id: category.id,
    name: getAdminDisplayName(category.translations, category.slug),
    slug: category.slug,
    sortOrder: category.sortOrder,
    productCount: products.filter((product) => product.categoryIds.includes(category.id)).length,
  }));

  return (
    <>
    <CategoriesResourceList
      rows={rows}
      items={categories}
      saveAction={saveCategoryInlineAction}
      deleteAction={deleteCategoryInlineAction}
      initialCleanupDeferredCategoryId={cleanupDeferredCategoryId}
    />
    <AdminRouteToast eventId={toastId} kind={query.error ? "error" : "success"} message={query.error ? "Nie udało się zapisać zmian kategorii." : "Zmiany kategorii zostały zapisane."} cleanPath="/admin/categories" />
    </>
  );
}
