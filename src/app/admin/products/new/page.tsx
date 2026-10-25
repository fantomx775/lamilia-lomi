import { ProductEditor } from "../product-editor";
import {
  archiveProductAction,
  deleteProductAction,
  saveNewProductFormAction,
  saveProductAction,
} from "@/app/admin/actions";
import { getAdminContentSnapshot } from "@/lib/content-repository";
import { formatAdminErrors } from "@/lib/admin-errors";
import { AdminRouteToast } from "@/components/admin/admin-toast";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewProductPage({ searchParams }: Props) {
  const snapshot = await getAdminContentSnapshot();
  const query = await searchParams;
  const error = query.error ? formatAdminErrors(query.error, "pl") : undefined;
  const toastId = typeof query.toast === "string" && /^[0-9a-f-]{36}$/i.test(query.toast) ? query.toast : undefined;

  return (
    <>
    <ProductEditor
      title="Nowy produkt"
      collections={snapshot.collections}
      categories={snapshot.categories}
      tags={snapshot.tags}
      feedback={error}
      saveAction={saveProductAction}
      saveFormAction={saveNewProductFormAction}
      archiveAction={archiveProductAction}
      deleteAction={deleteProductAction}
    />
    {toastId && !error ? <noscript><p role="status" className="mb-4 rounded-lg border border-[var(--color-sage-deep)] bg-[var(--color-sage)]/70 px-4 py-3 text-sm">Produkt został zapisany.</p></noscript> : null}
    <AdminRouteToast eventId={toastId} kind={error ? "error" : "success"} message={error ?? "Zmiany produktu zostały zapisane."} cleanPath="/admin/products/new" />
    </>
  );
}
