import { deleteCollectionInlineAction, saveCollectionInlineAction } from "@/app/admin/actions";
import { getAdminContentSnapshot } from "@/lib/content-repository";
import { CollectionsResourceList, type AdminCollectionListRow } from "./collections-list";

export default async function AdminCollectionsPage() {
  const { collections, products } = await getAdminContentSnapshot();
  const productCounts = new Map<string, number>();
  for (const product of products) {
    if (product.collectionId) productCounts.set(product.collectionId, (productCounts.get(product.collectionId) ?? 0) + 1);
  }

  const rows: AdminCollectionListRow[] = collections.map((collection) => ({
    ...collection,
    productCount: productCounts.get(collection.id) ?? 0,
    imageUrl: collection.imagePath
      ? `/api/admin/collection-image?${new URLSearchParams({
          collectionId: collection.id,
          path: collection.imagePath,
          provider: collection.imageStorageProvider ?? "",
          contentType: collection.imageContentType ?? "",
        }).toString()}`
      : undefined,
  }));

  return (
    <CollectionsResourceList
      rows={rows}
      saveAction={saveCollectionInlineAction}
      deleteAction={deleteCollectionInlineAction}
    />
  );
}
