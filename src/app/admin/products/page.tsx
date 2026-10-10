import { getAdminContentSnapshot } from "@/lib/content-repository";

import { ProductsResourceList, type AdminProductListRow } from "./products-list";

export default async function AdminProductsPage() {
  const { products } = await getAdminContentSnapshot();
  const rows: AdminProductListRow[] = products.map((product) => ({
    id: product.id,
    title: product.translations.find((translation) => translation.locale === "en")?.title || product.slug,
    slug: product.slug,
    status: product.status,
    audience: product.audience,
    productType: product.productType,
  }));

  return <ProductsResourceList rows={rows} />;
}
