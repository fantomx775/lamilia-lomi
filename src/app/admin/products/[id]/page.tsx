import { notFound } from "next/navigation";

import { getProductById, getTranslation } from "@/lib/products";
import { ProductEditor } from "../product-editor";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function EditProductPage({ params }: Props) {
  const { id } = await params;
  const product = getProductById(id);

  if (!product) {
    notFound();
  }

  return <ProductEditor title={`Edycja: ${getTranslation(product.translations, "en").title}`} product={product} />;
}
