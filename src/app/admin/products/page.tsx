import { Archive, Trash2 } from "lucide-react";
import Link from "next/link";

import { archiveProductAction, deleteProductAction } from "@/app/admin/actions";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getContentSnapshot } from "@/lib/content-store";
import { getTranslation } from "@/lib/products";

export default function AdminProductsPage() {
  const { products } = getContentSnapshot();

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[var(--color-terracotta)]">Produkty</p>
          <h1 className="mt-2 font-serif text-4xl font-semibold">Lista produktow</h1>
        </div>
        <Link className={buttonClassName()} href="/admin/products/new">
          Nowy produkt
        </Link>
      </div>
      <Card className="mt-8 overflow-hidden">
        <div className="grid grid-cols-[1.3fr_0.7fr_0.7fr_1fr] border-b border-[var(--color-border)] bg-white/80 p-4 text-sm font-medium">
          <span>Tytul</span>
          <span>Status</span>
          <span>Segment</span>
          <span>Akcje</span>
        </div>
        {products.map((product) => (
          <div
            key={product.id}
            className="grid grid-cols-[1.3fr_0.7fr_0.7fr_1fr] items-center border-b border-[var(--color-border)] p-4 text-sm last:border-b-0"
          >
            <span>{getTranslation(product.translations, "en").title}</span>
            <span>{product.status}</span>
            <span>{product.audience}</span>
            <div className="flex flex-wrap items-center gap-2">
              <Link className="text-[var(--color-terracotta)]" href={`/admin/products/${product.id}`}>
                Edytuj
              </Link>
              <form action={archiveProductAction}>
                <input type="hidden" name="id" value={product.id} />
                <button className="inline-flex items-center gap-1 text-[var(--color-muted)]" type="submit">
                  <Archive className="size-3" aria-hidden />
                  Archiwizuj
                </button>
              </form>
              <form action={deleteProductAction}>
                <input type="hidden" name="id" value={product.id} />
                <button className="inline-flex items-center gap-1 text-red-700" type="submit">
                  <Trash2 className="size-3" aria-hidden />
                  Usun
                </button>
              </form>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
