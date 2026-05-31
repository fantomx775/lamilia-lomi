import { Card } from "@/components/ui/card";
import { getTranslation } from "@/lib/products";
import { tags } from "@/lib/seed-data";

export default function AdminTagsPage() {
  return (
    <div>
      <p className="text-sm font-medium text-[var(--color-terracotta)]">Tagi</p>
      <h1 className="mt-2 font-serif text-4xl font-semibold">Tagi</h1>
      <Card className="mt-8 overflow-hidden">
        {tags.map((tag) => (
          <div key={tag.slug} className="grid grid-cols-3 border-b border-[var(--color-border)] p-4 text-sm last:border-b-0">
            <span>{tag.slug}</span>
            <span>{getTranslation(tag.translations, "en").name}</span>
            <span>{getTranslation(tag.translations, "pl").name}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
