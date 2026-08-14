import { getContentSnapshot } from "@/lib/content-store";
import { getAdminLanguageCodes } from "@/lib/admin-list";
import { getTranslation } from "@/lib/products";

import { ProductsResourceList, type AdminProductListRow } from "./products-list";

export default function AdminProductsPage() {
  const { products } = getContentSnapshot();
  const rows: AdminProductListRow[] = products.map((product) => ({
    id: product.id,
    title: getTranslation(product.translations, "en").title,
    slug: product.slug,
    status: product.status,
    audience: product.audience,
    productType: product.productType,
    languageCodes: getAdminLanguageCodes(product.translations),
  }));

  return <ProductsResourceList rows={rows} />;
}
