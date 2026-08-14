"use client";

import { Save } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { AdminEditorHeader, AdminEditorSection } from "@/components/admin/admin-editor-foundation";
import { LocaleTabs } from "@/components/admin/locale-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { routing, type Locale } from "@/i18n/routing";
import type { StaticPageRecord } from "@/lib/types";

type PageValue = { title: string; body: string };

export function PageEditor({
  slug,
  title,
  records,
  feedback,
  saveAction,
}: {
  slug: StaticPageRecord["slug"];
  title: string;
  records: StaticPageRecord[];
  feedback?: string;
  saveAction?: (formData: FormData) => void | Promise<void>;
}) {
  const [locale, setLocale] = useState<Locale>("en");
  const [values, setValues] = useState<Record<Locale, PageValue>>(() => buildValues(records));
  const missingLocales = routing.locales.filter((code) => !values[code].title.trim() && !values[code].body.trim());

  const updateValue = (field: keyof PageValue, value: string) => {
    setValues((current) => ({ ...current, [locale]: { ...current[locale], [field]: value } }));
  };

  return (
    <form id="page-editor-form" action={saveAction} className="grid gap-6">
      <input type="hidden" name="slug" value={slug} />
      {routing.locales.map((code) => (
        <span key={code}>
          <input type="hidden" name={`title_${code}`} value={values[code].title} />
          <input type="hidden" name={`body_${code}`} value={values[code].body} />
        </span>
      ))}
      <AdminEditorHeader
        backHref="/admin/pages"
        backLabel="Strony"
        title={title}
        subtitle={`Klucz strony: ${slug}`}
        actions={<PageSubmitButton />}
      />

      {feedback ? <div role="alert" className="rounded-md border border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[var(--color-terracotta)]">{feedback}</div> : null}

      <AdminEditorSection title="Ustawienia strony" description="Klucz strony jest stały i wspólny dla wszystkich wersji językowych.">
        <div className="grid gap-2">
          <span className="text-sm font-medium">Klucz strony</span>
          <code className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm">{slug}</code>
        </div>
      </AdminEditorSection>

      <AdminEditorSection title="Treść strony" description="Plain textarea zachowuje obecny model static pages bez dokładania rich-text dependency.">
        <div className="grid gap-4">
          <LocaleTabs value={locale} onChange={setLocale} missingLocales={missingLocales} id="page-locale-panel" />
          <div id="page-locale-panel" className="grid gap-4" role="tabpanel">
            <div className="grid gap-2">
              <Label htmlFor={`page-title-${locale}`}>Tytuł</Label>
              <Input id={`page-title-${locale}`} name={`title_${locale}`} value={values[locale].title} onChange={(event) => updateValue("title", event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`page-body-${locale}`}>Treść</Label>
              <textarea id={`page-body-${locale}`} name={`body_${locale}`} value={values[locale].body} onChange={(event) => updateValue("body", event.target.value)} className="min-h-[28rem] w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-3 text-sm leading-6 outline-none transition focus:border-[var(--color-terracotta)] focus:ring-4 focus:ring-[var(--color-terracotta-ring)]" />
            </div>
          </div>
        </div>
      </AdminEditorSection>

      <div className="flex justify-end"><PageSubmitButton /></div>
    </form>
  );
}

function PageSubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}><Save className="size-4" aria-hidden />{pending ? "Zapisywanie…" : "Zapisz"}</Button>;
}

function buildValues(records: StaticPageRecord[]): Record<Locale, PageValue> {
  return Object.fromEntries(
    routing.locales.map((locale) => {
      const record = records.find((item) => item.locale === locale);
      return [locale, { title: record?.title ?? "", body: record?.body ?? "" }];
    }),
  ) as Record<Locale, PageValue>;
}
