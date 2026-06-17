import { ProductEditor } from "../product-editor";
import { getContentSnapshot } from "@/lib/content-store";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewProductPage({ searchParams }: Props) {
  const snapshot = getContentSnapshot();
  const query = await searchParams;
  const error = Array.isArray(query.error) ? query.error[0] : query.error;

  return (
    <ProductEditor
      title="Nowy produkt"
      categories={snapshot.categories}
      tags={snapshot.tags}
      feedback={error}
    />
  );
}
