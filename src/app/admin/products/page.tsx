import Link from "next/link";

import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getTranslation } from "@/lib/products";
import { products } from "@/lib/seed-data";

export default function AdminProductsPage() {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[var(--color-terracotta)]">Produkty</p>
          <h1 className="mt-2 font-serif text-4xl font-semibold">Lista produktów</h1>
        </div>
        <Link className={buttonClassName()} href="/admin/products/new">
          Nowy produkt
        </Link>
      </div>
      <Card className="mt-8 overflow-hidden">
        <div className="grid grid-cols-[1.3fr_0.7fr_0.7fr_0.7fr] border-b border-[var(--color-border)] bg-white/80 p-4 text-sm font-medium">
          <span>Tytuł</span>
          <span>Status</span>
          <span>Segment</span>
          <span>Akcje</span>
        </div>
        {products.map((product) => (
          <div key={product.id} className="grid grid-cols-[1.3fr_0.7fr_0.7fr_0.7fr] border-b border-[var(--color-border)] p-4 text-sm last:border-b-0">
            <span>{getTranslation(product.translations, "en").title}</span>
            <span>{product.status}</span>
            <span>{product.audience}</span>
            <Link className="text-[var(--color-terracotta)]" href={`/admin/products/${product.id}`}>
              Edytuj
            </Link>
          </div>
        ))}
      </Card>
    </div>
  );
}
