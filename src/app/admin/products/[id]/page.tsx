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
import { AdminRouteToast } from "@/components/admin/admin-toast";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditProductPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const error = query.error ? formatAdminErrors(query.error, "pl") : undefined;
  const toastId = typeof query.toast === "string" && /^[0-9a-f-]{36}$/i.test(query.toast) ? query.toast : undefined;
  const product = await getProductByIdForRequest(id, { includeDrafts: true });
  const snapshot = await getAdminContentSnapshot();

  if (!product) {
    notFound();
  }

  return (
    <>
    <ProductEditor
      title={`Edycja: ${product.translations.find((translation) => translation.locale === "en")?.title || product.slug}`}
      product={product}
      collections={snapshot.collections}
      categories={snapshot.categories}
      tags={snapshot.tags}
      feedback={error}
      saveAction={saveProductAction}
      saveFormAction={saveExistingProductFormAction}
      archiveAction={archiveProductAction}
      deleteAction={deleteProductAction}
    />
    {toastId && !error ? <noscript><p role="status" className="mb-4 rounded-lg border border-[var(--color-sage-deep)] bg-[var(--color-sage)]/70 px-4 py-3 text-sm">Zmiany produktu zostały zapisane.</p></noscript> : null}
    <AdminRouteToast eventId={toastId} kind={error ? "error" : "success"} message={error ?? "Zmiany produktu zostały zapisane."} cleanPath={`/admin/products/${id}`} />
    </>
  );
}
