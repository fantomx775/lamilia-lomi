import { Save, Trash2 } from "lucide-react";

import { deleteTagAction, saveTagAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { routing, type Locale } from "@/i18n/routing";
import { getContentSnapshot } from "@/lib/content-store";
import { getTranslation } from "@/lib/products";
import type { Tag } from "@/lib/types";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminTagsPage({ searchParams }: Props) {
  const { tags } = getContentSnapshot();
  const query = await searchParams;
  const feedback = Array.isArray(query.error) ? query.error[0] : query.error;

  return (
    <div>
      <p className="text-sm font-medium text-[var(--color-terracotta)]">Tagi</p>
      <h1 className="mt-2 font-serif text-4xl font-semibold">Tagi</h1>
      {feedback ? (
        <p className="mt-4 rounded-md border border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[var(--color-terracotta)]">
          {feedback}
        </p>
      ) : null}
      <div className="mt-8 grid gap-5">
        {tags.map((tag) => (
          <TagForm key={tag.id} tag={tag} />
        ))}
        <TagForm />
      </div>
    </div>
  );
}

function TagForm({ tag }: { tag?: Tag }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="font-serif text-2xl font-semibold">
          {tag ? getTranslation(tag.translations, "en").name : "Nowy tag"}
        </h2>
      </CardHeader>
      <CardContent>
        <form action={saveTagAction} className="grid gap-4">
          <input type="hidden" name="id" value={tag?.id ?? ""} />
          <Field label="Slug">
            <Input name="slug" defaultValue={tag?.slug ?? ""} placeholder="printable-bonus" />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            {routing.locales.map((locale) => (
              <TagLocaleFields key={locale} locale={locale} tag={tag} />
            ))}
          </div>
          <Button type="submit" className="w-fit">
            <Save className="size-4" aria-hidden />
            Zapisz
          </Button>
        </form>
        {tag ? (
          <form action={deleteTagAction} className="mt-3">
            <input type="hidden" name="id" value={tag.id} />
            <button className="inline-flex items-center gap-2 text-sm font-medium text-red-700" type="submit">
              <Trash2 className="size-4" aria-hidden />
              Usun tag
            </button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TagLocaleFields({ locale, tag }: { locale: Locale; tag?: Tag }) {
  const translation = tag?.translations.find((entry) => entry.locale === locale);

  return (
    <div className="grid gap-3 rounded-md border border-[var(--color-border)] p-3">
      <h3 className="text-sm font-semibold uppercase text-[var(--color-muted)]">{locale}</h3>
      <Field label="Nazwa">
        <Input name={`name_${locale}`} defaultValue={translation?.name ?? ""} />
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
