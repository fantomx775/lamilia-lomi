import { Save, Trash2 } from "lucide-react";

import { deleteCategoryAction, saveCategoryAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { routing, type Locale } from "@/i18n/routing";
import { getContentSnapshot } from "@/lib/content-store";
import { getTranslation } from "@/lib/products";
import type { Category } from "@/lib/types";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminCategoriesPage({ searchParams }: Props) {
  const { categories } = getContentSnapshot();
  const query = await searchParams;
  const feedback = Array.isArray(query.error) ? query.error[0] : query.error;

  return (
    <div>
      <p className="text-sm font-medium text-[var(--color-terracotta)]">Kategorie</p>
      <h1 className="mt-2 font-serif text-4xl font-semibold">Kategorie</h1>
      {feedback ? (
        <p className="mt-4 rounded-md border border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[var(--color-terracotta)]">
          {feedback}
        </p>
      ) : null}
      <div className="mt-8 grid gap-5">
        {categories.map((category) => (
          <CategoryForm key={category.id} category={category} />
        ))}
        <CategoryForm />
      </div>
    </div>
  );
}

function CategoryForm({ category }: { category?: Category }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="font-serif text-2xl font-semibold">
          {category ? getTranslation(category.translations, "en").name : "Nowa kategoria"}
        </h2>
      </CardHeader>
      <CardContent>
        <form action={saveCategoryAction} className="grid gap-4">
          <input type="hidden" name="id" value={category?.id ?? ""} />
          <div className="grid gap-4 md:grid-cols-[1fr_0.5fr]">
            <Field label="Slug">
              <Input name="slug" defaultValue={category?.slug ?? ""} placeholder="coloring-books" />
            </Field>
            <Field label="Kolejnosc">
              <Input name="sortOrder" type="number" defaultValue={category?.sortOrder ?? 100} />
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {routing.locales.map((locale) => (
              <TaxonomyLocaleFields key={locale} locale={locale} item={category} />
            ))}
          </div>
          <Button type="submit" className="w-fit">
            <Save className="size-4" aria-hidden />
            Zapisz
          </Button>
        </form>
        {category ? (
          <form action={deleteCategoryAction} className="mt-3">
            <input type="hidden" name="id" value={category.id} />
            <button className="inline-flex items-center gap-2 text-sm font-medium text-red-700" type="submit">
              <Trash2 className="size-4" aria-hidden />
              Usun kategorie
            </button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TaxonomyLocaleFields({
  locale,
  item,
}: {
  locale: Locale;
  item?: Category;
}) {
  const translation = item?.translations.find((entry) => entry.locale === locale);

  return (
    <div className="grid gap-3 rounded-md border border-[var(--color-border)] p-3">
      <h3 className="text-sm font-semibold uppercase text-[var(--color-muted)]">{locale}</h3>
      <Field label="Nazwa">
        <Input name={`name_${locale}`} defaultValue={translation?.name ?? ""} />
      </Field>
      <Field label="Opis">
        <Input name={`description_${locale}`} defaultValue={translation?.description ?? ""} />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
