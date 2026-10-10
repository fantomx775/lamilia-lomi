"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { AdminDrawer } from "@/components/admin/admin-drawer";
import { AdminEditorSection } from "@/components/admin/admin-editor-foundation";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { Button, buttonClassName } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN_ERROR_CODES, getAdminErrorMessage, type AdminMutationResult, type AdminErrorCode } from "@/lib/admin-errors";
import { imageRatioRequirement, readImageDimensions, validateImageDimensions } from "@/lib/image-ratios";
import { validateMediaFile } from "@/lib/media-upload";
import type { Category, CategoryImage, Tag } from "@/lib/types";

type TaxonomyItem = Category | Tag;
type TaxonomyKind = "category" | "tag";
type TaxonomyContent = { name: string; description: string };
type SuccessfulAdminMutation = Extract<AdminMutationResult, { ok: true }>;
export type SaveAction = (formData: FormData) => Promise<AdminMutationResult>;
export type DeleteAction = (formData: FormData) => Promise<AdminMutationResult>;

type TaxonomyEditorProps = {
  kind: TaxonomyKind;
  item?: TaxonomyItem;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: (result: SuccessfulAdminMutation) => void;
  saveAction?: SaveAction;
  deleteAction?: DeleteAction;
};

export function TaxonomyEditorDrawer({
  kind,
  item,
  open,
  onClose,
  onSaved,
  onDeleted,
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
      description="Edytuj angielską nazwę i opis używane w katalogu."
    >
      <TaxonomyEditorForm
        key={`${open ? "open" : "closed"}-${item?.id ?? "new"}`}
        kind={kind}
        item={item}
        onClose={onClose}
        onSaved={onSaved}
        onDeleted={onDeleted}
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
  onDeleted,
  saveAction,
  deleteAction,
}: TaxonomyEditorProps) {
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<AdminErrorCode[]>([]);
  const [values, setValues] = useState<TaxonomyContent>(() => buildContent(item));
  const isCategory = kind === "category";
  const itemId = item?.id ?? "";
  const router = useRouter();
  const [categoryImage, setCategoryImage] = useState<CategoryImage | undefined>(
    isCategory ? (item as Category | undefined)?.image : undefined,
  );
  const [imagePending, setImagePending] = useState(false);
  const [imageError, setImageError] = useState("");
  const [imageMessage, setImageMessage] = useState("");

  const updateValue = (field: keyof TaxonomyContent, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors([]);
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      if (!saveAction) {
        setErrors([ADMIN_ERROR_CODES.INTERNAL]);
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
        setErrors([ADMIN_ERROR_CODES.INTERNAL]);
        return;
      }

      const result = await deleteAction(formData);

      if (!result.ok) {
        setErrors(result.errors);
        return;
      }

      if (onDeleted) onDeleted(result);
      else onSaved();
    });
  };

  const uploadCategoryImage = async (file?: File) => {
    if (!file || !itemId) return;
    setImageError("");
    setImageMessage("");

    const fileValidation = validateMediaFile("cover", file);
    if (!fileValidation.ok) {
      setImageError(fileValidation.error);
      return;
    }

    try {
      const dimensions = await readImageDimensions(file);
      const validation = validateImageDimensions("category", dimensions);
      if (!validation.ok) {
        setImageError(validation.error);
        return;
      }
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Nie udało się odczytać obrazu.");
      return;
    }

    setImagePending(true);
    try {
      const formData = new FormData();
      formData.set("categoryId", itemId);
      formData.set("file", file);
      const response = await fetch("/api/admin/category-image", { method: "POST", body: formData });
      const result = await response.json().catch(() => null) as { image?: CategoryImage; cleanupDeferred?: boolean; error?: string } | null;
      if (!response.ok || !result?.image) {
        setImageError(result?.error ?? "Nie udało się zapisać obrazu kategorii.");
        return;
      }
      setCategoryImage(result.image);
      setImageMessage(result.cleanupDeferred ? "Obraz został podmieniony. Poprzedni plik wymaga sprzątnięcia." : "Obraz kategorii został zapisany.");
      router.refresh();
    } catch {
      setImageError("Nie udało się zapisać obrazu kategorii. Spróbuj ponownie.");
    } finally {
      setImagePending(false);
    }
  };

  const removeCategoryImage = async () => {
    if (!itemId || !categoryImage || !window.confirm("Czy na pewno usunąć obraz kategorii?")) return;
    setImagePending(true);
    setImageError("");
    setImageMessage("");
    try {
      const response = await fetch("/api/admin/category-image", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: itemId }),
      });
      const result = await response.json().catch(() => null) as { cleanupDeferred?: boolean; error?: string } | null;
      if (!response.ok) {
        setImageError(result?.error ?? "Nie udało się usunąć obrazu kategorii.");
        return;
      }
      setCategoryImage(undefined);
      setImageMessage(result?.cleanupDeferred ? "Obraz został odłączony. Plik wymaga sprzątnięcia." : "Obraz kategorii został usunięty.");
      router.refresh();
    } catch {
      setImageError("Nie udało się usunąć obrazu kategorii. Spróbuj ponownie.");
    } finally {
      setImagePending(false);
    }
  };

  return (
    <form className="flex h-full min-h-0 flex-col" onSubmit={submit}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
        <input type="hidden" name="id" value={itemId} />

        <div className="grid gap-5 pb-5">
          {errors.length ? (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              <p className="font-medium">Nie udało się zapisać zmian.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {errors.map((error) => <li key={error}>{getAdminErrorMessage(error, "pl")}</li>)}
              </ul>
            </div>
          ) : null}

          <AdminEditorSection title="Treść">
            <div className="grid gap-4">
              <Field label="Nazwa" htmlFor="taxonomy-name">
                <Input
                  id="taxonomy-name"
                  name="name"
                  value={values.name}
                  onChange={(event) => updateValue("name", event.target.value)}
                  autoFocus={!item}
                />
              </Field>
              <Field label="Opis" htmlFor="taxonomy-description">
                <textarea
                  id="taxonomy-description"
                  name="description"
                  value={values.description}
                  onChange={(event) => updateValue("description", event.target.value)}
                  className="min-h-28 w-full resize-y rounded-md border border-[var(--color-border)] bg-white px-3 py-3 text-sm leading-6 outline-none transition placeholder:text-[var(--color-muted)] focus:border-[var(--color-terracotta)] focus:ring-4 focus:ring-[var(--color-terracotta-ring)]"
                />
              </Field>
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

          {isCategory ? (
            <AdminEditorSection title="Obraz kategorii" description={imageRatioRequirement("category")}>
              {itemId ? (
                <div className="grid gap-3">
                  <div className="relative aspect-square w-full max-w-56 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
                    <ImageWithFallback src={categoryImage?.path} alt={categoryImage ? `Obraz kategorii ${categoryImage.filename}` : "Podgląd obrazu kategorii"} className="object-contain p-2" sizes="224px" />
                  </div>
                  <label className="grid gap-2 text-sm font-medium" htmlFor="category-image-file">
                    {categoryImage ? "Zastąp obraz" : "Dodaj obraz"}
                    <input
                      id="category-image-file"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={imagePending}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        void uploadCategoryImage(file);
                      }}
                      className="block w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-[var(--color-blush)] file:px-3 file:py-1.5"
                    />
                  </label>
                  {categoryImage ? <Button type="button" variant="outline" className="justify-self-start text-red-800" disabled={imagePending} onClick={() => void removeCategoryImage()}>Usuń obraz</Button> : null}
                  <p className="text-xs leading-5 text-[var(--color-muted)]">PNG, JPG lub WEBP · maks. 20 MB. Kwadrat 1:1, co najmniej 480 × 480 px. Obraz zachowuje oryginalne proporcje.</p>
                  {imagePending ? <p role="status" className="text-sm text-[var(--color-muted)]">Zapisywanie obrazu…</p> : null}
                  {imageError ? <p role="alert" className="text-sm text-red-800">{imageError}</p> : null}
                  {imageMessage ? <p role="status" className="text-sm text-emerald-800">{imageMessage}</p> : null}
                </div>
              ) : (
                <p className="text-sm leading-6 text-[var(--color-muted)]">Najpierw zapisz kategorię, a potem otwórz ją ponownie, aby dodać obraz.</p>
              )}
            </AdminEditorSection>
          ) : null}

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
        <Button type="submit" disabled={isPending || imagePending}>{isPending ? "Zapisywanie…" : "Zapisz"}</Button>
      </div>
    </form>
  );
}

function buildContent(item?: TaxonomyItem): TaxonomyContent {
  const english = item?.translations.find((translation) => translation.locale === "en");
  return { name: english?.name ?? "", description: english?.description ?? "" };
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return <div className="grid gap-2"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>;
}
