import { notFound } from "next/navigation";

import {
  archiveProductAction,
  deleteProductAction,
  saveExistingProductFormAction,
  saveProductAction,
} from "@/app/admin/actions";
import { getAdminContentSnapshot } from "@/lib/content-repository";
import { formatAdminErrors } from "@/lib/admin-errors";
import { getProductByIdForRequest } from "@/lib/products-request";
import { ProductEditor } from "../product-editor";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditProductPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const error = query.error ? formatAdminErrors(query.error, "pl") : undefined;
  const saved = query.saved ? "Zapisano zmiany." : undefined;
  const product = await getProductByIdForRequest(id, { includeDrafts: true });
  const snapshot = await getAdminContentSnapshot();

  if (!product) {
    notFound();
  }

  return (
    <ProductEditor
      title={`Edycja: ${product.translations.find((translation) => translation.locale === "en")?.title || product.slug}`}
      product={product}
      categories={snapshot.categories}
      tags={snapshot.tags}
      feedback={error ?? saved}
      saveAction={saveProductAction}
      saveFormAction={saveExistingProductFormAction}
      archiveAction={archiveProductAction}
      deleteAction={deleteProductAction}
    />
  );
}
