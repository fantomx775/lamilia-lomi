import { Card } from "@/components/ui/card";
import { getTranslation } from "@/lib/products";
import { categories } from "@/lib/seed-data";

export default function AdminCategoriesPage() {
  return (
    <AdminTaxonomy title="Kategorie" rows={categories.map((category) => ({
      slug: category.slug,
      en: getTranslation(category.translations, "en").name,
      pl: getTranslation(category.translations, "pl").name,
    }))} />
  );
}

function AdminTaxonomy({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ slug: string; en: string; pl: string }>;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-[var(--color-terracotta)]">{title}</p>
      <h1 className="mt-2 font-serif text-4xl font-semibold">{title}</h1>
      <Card className="mt-8 overflow-hidden">
        {rows.map((row) => (
          <div key={row.slug} className="grid grid-cols-3 border-b border-[var(--color-border)] p-4 text-sm last:border-b-0">
            <span>{row.slug}</span>
            <span>{row.en}</span>
            <span>{row.pl}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
