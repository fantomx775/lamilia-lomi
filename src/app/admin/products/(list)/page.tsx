import { getAdminContentSnapshot } from "@/lib/content-repository";

import { ProductsResourceList, type AdminProductListRow } from "../products-list";

export default async function AdminProductsPage() {
  const { products, collections, categories, tags } = await getAdminContentSnapshot();
  const collectionsById = new Map(collections.map((collection) => [collection.id, collection.name]));
  const categoriesById = new Map(categories.map((category) => [
    category.id,
    category.translations.find((translation) => translation.locale === "en")?.name || category.slug,
  ]));
  const tagsById = new Map(tags.map((tag) => [
    tag.id,
    tag.translations.find((translation) => translation.locale === "en")?.name || tag.slug,
  ]));
  const rows: AdminProductListRow[] = products.map((product) => ({
    id: product.id,
    title: product.translations.find((translation) => translation.locale === "en")?.title || product.slug,
    slug: product.slug,
    status: product.status,
    audience: product.audience,
    productType: product.productType,
    coverPath: product.assets.find((asset) => asset.kind === "cover" && asset.isActive !== false)?.path,
    collectionName: product.collectionId ? collectionsById.get(product.collectionId) ?? null : null,
    categoryNames: product.categoryIds.flatMap((id) => categoriesById.get(id) ?? []),
    tagNames: product.tagIds.flatMap((id) => tagsById.get(id) ?? []),
  }));

  return <ProductsResourceList rows={rows} />;
}
