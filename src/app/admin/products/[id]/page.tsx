import { notFound } from "next/navigation";

import { getContentSnapshot } from "@/lib/content-store";
import { getProductById, getTranslation } from "@/lib/products";
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
  const product = getProductById(id);
  const snapshot = getContentSnapshot();

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
    />
  );
}
