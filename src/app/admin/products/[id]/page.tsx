import { notFound } from "next/navigation";

import {
  archiveProductAction,
  deleteProductAction,
  saveProductAction,
} from "@/app/admin/actions";
import { getAdminContentSnapshot } from "@/lib/content-repository";
import { getTranslation } from "@/lib/products";
import { getProductByIdForRequest } from "@/lib/products-request";
import { ProductEditor } from "../product-editor";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditProductPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const error = Array.isArray(query.error) ? query.error[0] : query.error;
  const saved = query.saved ? "Zapisano zmiany." : undefined;
  const product = await getProductByIdForRequest(id, { includeDrafts: true });
  const snapshot = await getAdminContentSnapshot();

  if (!product) {
    notFound();
  }

  return (
    <ProductEditor
      title={`Edycja: ${getTranslation(product.translations, "en").title}`}
      product={product}
      categories={snapshot.categories}
      tags={snapshot.tags}
      feedback={error ?? saved}
      saveAction={saveProductAction}
      archiveAction={archiveProductAction}
      deleteAction={deleteProductAction}
    />
  );
}
