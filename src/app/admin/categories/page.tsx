import {
  deleteCategoryInlineAction,
  saveCategoryInlineAction,
} from "@/app/admin/actions";
import { getAdminDisplayName, getAdminLanguageCodes } from "@/lib/admin-list";
import { getAdminContentSnapshot } from "@/lib/content-repository";

import { CategoriesResourceList, type AdminCategoryListRow } from "./categories-list";

export default async function AdminCategoriesPage() {
  const { categories, products } = await getAdminContentSnapshot();
  const rows: AdminCategoryListRow[] = categories.map((category) => ({
    id: category.id,
    name: getAdminDisplayName(category.translations, category.slug),
    slug: category.slug,
    sortOrder: category.sortOrder,
    productCount: products.filter((product) => product.categoryIds.includes(category.id)).length,
    languageCodes: getAdminLanguageCodes(category.translations),
  }));

  return (
    <CategoriesResourceList
      rows={rows}
      items={categories}
      saveAction={saveCategoryInlineAction}
      deleteAction={deleteCategoryInlineAction}
    />
  );
}
