import { ProductEditor } from "../product-editor";
import {
  archiveProductAction,
  deleteProductAction,
  saveProductAction,
} from "@/app/admin/actions";
import { getAdminContentSnapshot } from "@/lib/content-repository";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewProductPage({ searchParams }: Props) {
  const snapshot = await getAdminContentSnapshot();
  const query = await searchParams;
  const error = Array.isArray(query.error) ? query.error[0] : query.error;

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
