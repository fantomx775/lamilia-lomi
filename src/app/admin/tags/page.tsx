import {
  deleteTagInlineAction,
  saveTagInlineAction,
} from "@/app/admin/actions";
import { getAdminDisplayName, getAdminLanguageCodes } from "@/lib/admin-list";
import { getContentSnapshot } from "@/lib/content-store";

import { TagsResourceList, type AdminTagListRow } from "./tags-list";

export default function AdminTagsPage() {
  const { products, tags } = getContentSnapshot();
  const rows: AdminTagListRow[] = tags.map((tag) => ({
    id: tag.id,
    name: getAdminDisplayName(tag.translations, tag.slug),
    slug: tag.slug,
    productCount: products.filter((product) => product.tagIds.includes(tag.id)).length,
    languageCodes: getAdminLanguageCodes(tag.translations),
  }));

  return (
    <TagsResourceList
      rows={rows}
      items={tags}
      saveAction={saveTagInlineAction}
      deleteAction={deleteTagInlineAction}
    />
  );
}
