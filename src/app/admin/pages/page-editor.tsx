"use client";

import { Save } from "lucide-react";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { AdminEditorHeader, AdminEditorSection } from "@/components/admin/admin-editor-foundation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [value, setValue] = useState<PageValue>(() => buildValue(records));

  const updateValue = (field: keyof PageValue, value: string) => {
    setValue((current) => ({ ...current, [field]: value }));
  };

  return (
    <form id="page-editor-form" action={saveAction} className="grid gap-6">
      <input type="hidden" name="slug" value={slug} />
      <AdminEditorHeader
        backHref="/admin/pages"
        backLabel="Strony"
        title={title}
        subtitle={`Klucz strony: ${slug}`}
        actions={<PageSubmitButton />}
      />

      {feedback ? <div role="alert" className="rounded-md border border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[var(--color-terracotta)]">{feedback}</div> : null}

      <AdminEditorSection title="Ustawienia strony" description="Klucz strony jest stały i wspólny dla wszystkich adresów.">
        <div className="grid gap-2">
          <span className="text-sm font-medium">Klucz strony</span>
          <code className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm">{slug}</code>
        </div>
      </AdminEditorSection>

      <AdminEditorSection title="Treść strony" description="Edytujesz wersję angielską; pozostałe istniejące treści i publiczne adresy pozostają bez zmian.">
        <div className="grid gap-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="page-title">Tytuł</Label>
              <Input id="page-title" name="title" value={value.title} onChange={(event) => updateValue("title", event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="page-body">Treść</Label>
              <textarea id="page-body" name="body" value={value.body} onChange={(event) => updateValue("body", event.target.value)} className="min-h-[28rem] w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-3 text-sm leading-6 outline-none transition focus:border-[var(--color-terracotta)] focus:ring-4 focus:ring-[var(--color-terracotta-ring)]" />
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

function buildValue(records: StaticPageRecord[]): PageValue {
  const english = records.find((record) => record.locale === "en");
  return { title: english?.title ?? "", body: english?.body ?? "" };
}
