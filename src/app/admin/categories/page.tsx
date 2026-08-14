import {
  deleteCategoryInlineAction,
  saveCategoryInlineAction,
} from "@/app/admin/actions";
import { getAdminDisplayName, getAdminLanguageCodes } from "@/lib/admin-list";
import { getContentSnapshot } from "@/lib/content-store";

import { CategoriesResourceList, type AdminCategoryListRow } from "./categories-list";

export default function AdminCategoriesPage() {
  const { categories, products } = getContentSnapshot();
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
