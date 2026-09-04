"use client";

import { useState, useTransition } from "react";

import { AdminDrawer } from "@/components/admin/admin-drawer";
import { AdminEditorSection } from "@/components/admin/admin-editor-foundation";
import { LocaleTabs } from "@/components/admin/locale-tabs";
import { Button, buttonClassName } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { routing, type Locale } from "@/i18n/routing";
import type { Category, Tag } from "@/lib/types";

type TaxonomyItem = Category | Tag;
type TaxonomyKind = "category" | "tag";
type LocaleValue = { name: string; description: string };
type MutationResult = { ok: true; id: string } | { ok: false; errors: string[] };
export type SaveAction = (formData: FormData) => Promise<MutationResult>;
export type DeleteAction = (formData: FormData) => Promise<MutationResult>;

type TaxonomyEditorProps = {
  kind: TaxonomyKind;
  item?: TaxonomyItem;
  onClose: () => void;
  onSaved: () => void;
  saveAction?: SaveAction;
  deleteAction?: DeleteAction;
};

export function TaxonomyEditorDrawer({
  kind,
  item,
  open,
  onClose,
  onSaved,
  saveAction,
  deleteAction,
  restoreFocusElement,
}: TaxonomyEditorProps & {
  open: boolean;
  restoreFocusElement?: HTMLElement | null;
}) {
  const isCategory = kind === "category";

  return (
    <AdminDrawer
      open={open}
      onClose={onClose}
      restoreFocusElement={restoreFocusElement}
      bodyClassName="!overflow-hidden !p-0"
      title={item ? `Edytuj ${isCategory ? "kategorię" : "tag"}` : isCategory ? "Nowa kategoria" : "Nowy tag"}
      description="Uzupełnij nazwy i opisy w wybranych językach."
    >
      <TaxonomyEditorForm
        key={`${open ? "open" : "closed"}-${item?.id ?? "new"}`}
        kind={kind}
        item={item}
        onClose={onClose}
        onSaved={onSaved}
        saveAction={saveAction}
        deleteAction={deleteAction}
      />
    </AdminDrawer>
  );
}

function TaxonomyEditorForm({
  kind,
  item,
  onClose,
  onSaved,
  saveAction,
  deleteAction,
}: TaxonomyEditorProps) {
  const [locale, setLocale] = useState<Locale>("en");
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const [values, setValues] = useState<Record<Locale, LocaleValue>>(() =>
    buildLocaleValues(item),
  );
  const isCategory = kind === "category";
  const itemId = item?.id ?? "";
  const missingLocales = routing.locales.filter((code) => !values[code].name.trim());

  const updateValue = (field: keyof LocaleValue, value: string) => {
    setValues((current) => ({
      ...current,
      [locale]: { ...current[locale], [field]: value },
    }));
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors([]);
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      if (!saveAction) {
        setErrors(["Ta akcja edytora nie jest dostępna."]);
        return;
      }

      const result = await saveAction(formData);

      if (!result.ok) {
        setErrors(result.errors);
        return;
      }

      onSaved();
    });
  };

  const remove = () => {
    if (!itemId || !window.confirm(`Czy na pewno usunąć ${isCategory ? "kategorię" : "tag"}?`)) {
      return;
    }

    const formData = new FormData();
    formData.set("id", itemId);
    startTransition(async () => {
      if (!deleteAction) {
        setErrors(["Ta akcja edytora nie jest dostępna."]);
        return;
      }

      const result = await deleteAction(formData);

      if (!result.ok) {
        setErrors(result.errors);
        return;
      }

      onSaved();
    });
  };

  return (
    <form className="flex h-full min-h-0 flex-col" onSubmit={submit}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
        <input type="hidden" name="id" value={itemId} />
        {routing.locales.map((code) => (
          <span key={code}>
            <input type="hidden" name={`name_${code}`} value={values[code].name} />
            <input type="hidden" name={`description_${code}`} value={values[code].description} />
          </span>
        ))}

        <div className="grid gap-5 pb-5">
          {errors.length ? (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              <p className="font-medium">Nie udało się zapisać zmian.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {errors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            </div>
          ) : null}

          <AdminEditorSection title="Treść" description="W formularzu widoczny jest jeden język naraz.">
            <div className="grid gap-4">
              <LocaleTabs value={locale} onChange={setLocale} missingLocales={missingLocales} id="taxonomy-locale-panel" />
              <div id="taxonomy-locale-panel" className="grid gap-4" role="tabpanel">
                <Field label="Nazwa" htmlFor={`taxonomy-name-${locale}`}>
                  <Input
                    id={`taxonomy-name-${locale}`}
                    name={`name_${locale}`}
                    value={values[locale].name}
                    onChange={(event) => updateValue("name", event.target.value)}
                    autoFocus={locale === "en" && !item}
                  />
                </Field>
                <Field label="Opis" htmlFor={`taxonomy-description-${locale}`}>
                  <textarea
                    id={`taxonomy-description-${locale}`}
                    name={`description_${locale}`}
                    value={values[locale].description}
                    onChange={(event) => updateValue("description", event.target.value)}
                    className="min-h-28 w-full resize-y rounded-md border border-[var(--color-border)] bg-white px-3 py-3 text-sm leading-6 outline-none transition placeholder:text-[var(--color-muted)] focus:border-[var(--color-terracotta)] focus:ring-4 focus:ring-[var(--color-terracotta-ring)]"
                  />
                </Field>
              </div>
            </div>
          </AdminEditorSection>

          <AdminEditorSection title="Ustawienia" description="Slug jest używany w adresach i publicznym katalogu.">
            <div className="grid gap-4">
              <Field label="Slug">
                <Input name="slug" defaultValue={item?.slug ?? ""} placeholder={isCategory ? "coloring-books" : "calm-evening"} />
              </Field>
              {isCategory ? (
                <Field label="Kolejność">
                  <Input name="sortOrder" type="number" defaultValue={(item as Category | undefined)?.sortOrder ?? 100} />
                </Field>
              ) : null}
            </div>
          </AdminEditorSection>

          {item ? (
            <div className="rounded-lg border border-red-200 bg-red-50/50 p-4">
              <p className="text-sm font-semibold text-red-900">Strefa niebezpieczna</p>
              <p className="mt-1 text-sm leading-6 text-red-900/70">Usunięcie odłączy ten element od przypisanych produktów.</p>
              <button type="button" className={buttonClassName({ variant: "outline", className: "mt-3 border-red-200 bg-white text-red-800 hover:bg-red-50" })} onClick={remove} disabled={isPending}>
                Usuń {isCategory ? "kategorię" : "tag"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 flex shrink-0 flex-wrap justify-end gap-2 border-t border-[var(--color-border)] bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(62,52,47,0.06)] backdrop-blur sm:px-6">
        <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Anuluj</Button>
        <Button type="submit" disabled={isPending}>{isPending ? "Zapisywanie…" : "Zapisz"}</Button>
      </div>
    </form>
  );
}

function buildLocaleValues(item?: TaxonomyItem): Record<Locale, LocaleValue> {
  return Object.fromEntries(
    routing.locales.map((locale) => {
      const translation = item?.translations.find((value) => value.locale === locale);
      return [locale, { name: translation?.name ?? "", description: translation?.description ?? "" }];
    }),
  ) as Record<Locale, LocaleValue>;
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return <div className="grid gap-2"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>;
}
