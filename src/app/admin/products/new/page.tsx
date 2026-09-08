import { ProductEditor } from "../product-editor";
import {
  archiveProductAction,
  deleteProductAction,
  saveProductAction,
} from "@/app/admin/actions";
import { getAdminContentSnapshot } from "@/lib/content-repository";
import { formatAdminErrors } from "@/lib/admin-errors";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewProductPage({ searchParams }: Props) {
  const snapshot = await getAdminContentSnapshot();
  const query = await searchParams;
  const error = query.error ? formatAdminErrors(query.error, "pl") : undefined;

  return (
    <ProductEditor
      title="Nowy produkt"
      categories={snapshot.categories}
      tags={snapshot.tags}
      feedback={error}
      saveAction={saveProductAction}
      archiveAction={archiveProductAction}
      deleteAction={deleteProductAction}
    />
  );
}
