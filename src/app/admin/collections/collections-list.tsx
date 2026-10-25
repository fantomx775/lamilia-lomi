"use client";

import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { AdminDrawer } from "@/components/admin/admin-drawer";
import { AdminResourceList } from "@/components/admin/admin-resource-list";
import { Button, buttonClassName } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN_ERROR_CODES, getAdminErrorMessage, type AdminErrorCode, type AdminMutationResult } from "@/lib/admin-errors";
import type { Collection, CollectionImageStorageProvider } from "@/lib/types";
import { useAdminToast } from "@/components/admin/admin-toast";

export type AdminCollectionListRow = Collection & {
  productCount: number;
  imageUrl?: string;
};

type ImageDraft = {
  path: string;
  provider: CollectionImageStorageProvider;
  filename: string;
  contentType: string;
  sizeBytes: number;
  url: string;
};

type SaveAction = (formData: FormData) => Promise<AdminMutationResult>;
type DeleteAction = (formData: FormData) => Promise<AdminMutationResult>;
type SuccessfulMutation = Extract<AdminMutationResult, { ok: true }>;

type CleanupWarning = {
  collectionId: string;
  imagePaths: string[];
};

export function CollectionsResourceList({
  rows,
  saveAction,
  deleteAction,
}: {
  rows: AdminCollectionListRow[];
  saveAction: SaveAction;
  deleteAction: DeleteAction;
}) {
  const router = useRouter();
  const publishToast = useAdminToast();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState("");
  const [restoreFocusElement, setRestoreFocusElement] = useState<HTMLElement | null>(null);
  const [cleanupWarning, setCleanupWarning] = useState<CleanupWarning | null>(null);
  const pendingImagesRef = useRef<ImageDraft[]>([]);
  const uploadInFlightRef = useRef(false);
  const mutationInFlightRef = useRef(false);
  const editingItem = rows.find((row) => row.id === editingId);

  const openCreate = (trigger: HTMLElement) => {
    setRestoreFocusElement(trigger);
    setEditingId(null);
    setDraftId(crypto.randomUUID());
    pendingImagesRef.current = [];
    setOpen(true);
  };

  const openEdit = (id: string, trigger: HTMLElement | null) => {
    setRestoreFocusElement(trigger);
    setEditingId(id);
    setDraftId(id);
    pendingImagesRef.current = [];
    setOpen(true);
  };

  const deletePendingImage = async (image: ImageDraft, collectionId: string) => {
    try {
      const response = await fetch("/api/admin/collection-image", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId, path: image.path, provider: image.provider }),
        keepalive: true,
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  const cleanupPendingImages = async (collectionId: string, pending: ImageDraft[]) => {
    const results = await Promise.all(pending.map((image) => deletePendingImage(image, collectionId)));
    return pending.filter((_, index) => !results[index]);
  };

  const showCleanupWarning = (collectionId: string, paths: Array<string | undefined>) => {
    const imagePaths = Array.from(new Set(paths.filter((path): path is string => Boolean(path))));
    setCleanupWarning(imagePaths.length ? { collectionId, imagePaths } : null);
  };

  const discardPendingImage = async (image: ImageDraft, collectionId: string) => {
    const deleted = await deletePendingImage(image, collectionId);
    if (deleted) {
      pendingImagesRef.current = pendingImagesRef.current.filter((pending) => pending.path !== image.path);
      return;
    }
    showCleanupWarning(collectionId, [image.path]);
  };

  const close = () => {
    if (uploadInFlightRef.current || mutationInFlightRef.current) return;
    const pending = [...pendingImagesRef.current];
    const collectionId = draftId;
    pendingImagesRef.current = [];
    setOpen(false);
    void cleanupPendingImages(collectionId, pending).then((failed) => {
      showCleanupWarning(collectionId, failed.map((image) => image.path));
    });
  };

  const saved = (result: SuccessfulMutation, savedImagePath: string) => {
    publishToast("success", "Kolekcja została zapisana.");
    const collectionId = result.id;
    const pending = pendingImagesRef.current.filter((image) => image.path !== savedImagePath);
    pendingImagesRef.current = [];
    setOpen(false);
    router.refresh();
    void cleanupPendingImages(collectionId, pending).then((failed) => {
      showCleanupWarning(collectionId, [
        result.cleanupDeferred ? result.cleanupImagePath : undefined,
        ...failed.map((image) => image.path),
      ]);
    });
  };

  const deleted = async (result: SuccessfulMutation, collectionId: string) => {
    const pending = [...pendingImagesRef.current];
    const failed = await cleanupPendingImages(collectionId, pending);
    pendingImagesRef.current = [];
    setOpen(false);
    publishToast("success", "Kolekcja została usunięta.");
    router.refresh();
    showCleanupWarning(result.id, [
      result.cleanupDeferred ? result.cleanupImagePath : undefined,
      ...failed.map((image) => image.path),
    ]);
  };

  const columns = [
    {
      id: "collection",
      header: "Kolekcja",
      cell: (row: AdminCollectionListRow) => (
        <button
          type="button"
          onClick={(event) => openEdit(row.id, event.currentTarget)}
          aria-label={`Edytuj kolekcję ${row.name}`}
          className="group flex min-w-0 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
        >
          {row.imageUrl ? (
            // The image route checks the admin session and signs private storage URLs.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.imageUrl} alt="" aria-hidden="true" className="size-12 shrink-0 rounded-md border border-[var(--color-border)] object-cover" />
          ) : (
            <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-md border border-dashed border-[var(--color-border)] text-[var(--color-muted)]"><ImagePlus className="size-4" /></span>
          )}
          <span className="min-w-0">
            <span className="block truncate font-medium text-[var(--color-ink)] group-hover:text-[var(--color-terracotta)]">{row.name}</span>
            <span className="mt-1 block truncate font-mono text-xs text-[var(--color-muted)]">{row.slug}</span>
          </span>
        </button>
      ),
    },
    { id: "slug", header: "Slug", cell: (row: AdminCollectionListRow) => <span className="font-mono text-xs">{row.slug}</span> },
    { id: "products", header: "Produkty", cell: (row: AdminCollectionListRow) => row.productCount },
  ];

  return (
    <>
      {cleanupWarning ? (
        <div role="alert" className="mb-4 flex items-start justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p>
            Nie udało się usunąć prywatnego obrazu. Sprzątnięcie wymaga interwencji administratora. ID kolekcji: <code className="font-mono">{cleanupWarning.collectionId}</code>. Ścieżka obrazu: {cleanupWarning.imagePaths.map((path) => <code key={path} className="ml-1 font-mono">{path}</code>)}
          </p>
          <button type="button" className="shrink-0 font-medium underline" onClick={() => setCleanupWarning(null)}>
            Zamknij komunikat
          </button>
        </div>
      ) : null}
      <AdminResourceList
        title="Kolekcje"
        description="Twórz kolekcje i przypisuj do nich produkty w edytorze produktu."
        searchPlaceholder="Szukaj kolekcji…"
        searchAriaLabel="Szukaj kolekcji"
        caption="Lista kolekcji"
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        getSearchText={(row) => [row.name, row.slug].join(" ")}
        onRowActivate={(row, trigger) => openEdit(row.id, trigger)}
        toolbarActions={<Button type="button" size="sm" onClick={(event) => openCreate(event.currentTarget)}><Plus className="size-4" aria-hidden />Dodaj kolekcję</Button>}
        renderMobileCard={(row) => (
          <button
            type="button"
            onClick={(event) => openEdit(row.id, event.currentTarget)}
            className="group flex w-full min-w-0 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
            aria-label={`Edytuj kolekcję ${row.name}`}
          >
            {row.imageUrl ? (
              // The image route checks the admin session and signs private storage URLs.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.imageUrl} alt="" aria-hidden="true" className="size-14 shrink-0 rounded-md border border-[var(--color-border)] object-cover" />
            ) : (
              <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-md border border-dashed border-[var(--color-border)] text-[var(--color-muted)]"><ImagePlus className="size-4" /></span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-[var(--color-ink)] group-hover:text-[var(--color-terracotta)]">{row.name}</span>
              <span className="mt-1 block truncate font-mono text-xs text-[var(--color-muted)]">{row.slug}</span>
              <span className="mt-2 block text-sm text-[var(--color-muted)]">{formatProductCount(row.productCount)}</span>
            </span>
          </button>
        )}
        emptyState={<p className="p-8 text-center text-sm text-[var(--color-muted)]">Brak kolekcji.</p>}
      />
      <AdminDrawer
        open={open}
        onClose={close}
        restoreFocusElement={restoreFocusElement}
        bodyClassName="!p-0"
        title={editingItem ? "Edytuj kolekcję" : "Nowa kolekcja"}
        description="Ustaw nazwę, slug i opcjonalny prywatny obraz kolekcji."
      >
        <CollectionEditorForm
          key={`${open ? "open" : "closed"}-${draftId}`}
          id={draftId}
          item={editingItem}
          saveAction={saveAction}
          deleteAction={deleteAction}
          onClose={close}
          onSaved={saved}
          onDeleted={deleted}
          onImageUploaded={(image) => pendingImagesRef.current.push(image)}
          onImageDiscarded={discardPendingImage}
          onImageUploadStateChange={(inFlight) => { uploadInFlightRef.current = inFlight; }}
          onMutationStateChange={(inFlight) => { mutationInFlightRef.current = inFlight; }}
        />
      </AdminDrawer>
    </>
  );
}

function CollectionEditorForm({
  id,
  item,
  saveAction,
  deleteAction,
  onClose,
  onSaved,
  onDeleted,
  onImageUploaded,
  onImageDiscarded,
  onImageUploadStateChange,
  onMutationStateChange,
}: {
  id: string;
  item?: AdminCollectionListRow;
  saveAction: SaveAction;
  deleteAction: DeleteAction;
  onClose: () => void;
  onSaved: (result: SuccessfulMutation, savedImagePath: string) => void;
  onDeleted: (result: SuccessfulMutation, collectionId: string) => Promise<void>;
  onImageUploaded: (image: ImageDraft) => void;
  onImageDiscarded: (image: ImageDraft, collectionId: string) => Promise<void>;
  onImageUploadStateChange: (inFlight: boolean) => void;
  onMutationStateChange: (inFlight: boolean) => void;
}) {
  const publishToast = useAdminToast();
  const [name, setName] = useState(item?.name ?? "");
  const [slug, setSlug] = useState(item?.slug ?? "");
  const [image, setImage] = useState<ImageDraft | null>(() => item?.imagePath && item.imageStorageProvider && item.imageContentType
    ? {
        path: item.imagePath,
        provider: item.imageStorageProvider,
        filename: item.imageFilename ?? "",
        contentType: item.imageContentType,
        sizeBytes: item.imageSizeBytes ?? 0,
        url: item.imageUrl ?? "",
      }
    : null);
  const [errors, setErrors] = useState<AdminErrorCode[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalImagePath = item?.imagePath;

  const uploadImage = async (file: File) => {
    setUploadError(null);
    setIsUploading(true);
    onImageUploadStateChange(true);
    const formData = new FormData();
    formData.set("collectionId", id);
    formData.set("file", file);
    try {
      const response = await fetch("/api/admin/collection-image", { method: "POST", body: formData });
      const body = await response.json() as { image?: ImageDraft; error?: string };
      if (!response.ok || !body.image) {
        setUploadError(body.error ? getAdminErrorMessage(body.error as AdminErrorCode, "pl") : "Nie udało się przesłać obrazu.");
        return;
      }
      if (image && image.path !== originalImagePath) await onImageDiscarded(image, id);
      setImage(body.image);
      onImageUploaded(body.image);
    } catch {
      setUploadError("Nie udało się przesłać obrazu. Sprawdź połączenie i spróbuj ponownie.");
    } finally {
      setIsUploading(false);
      onImageUploadStateChange(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const clearImage = () => {
    if (image && image.path !== originalImagePath) void onImageDiscarded(image, id);
    setImage(null);
    setUploadError(null);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors([]);
    const formData = new FormData(event.currentTarget);
    onMutationStateChange(true);
    startTransition(async () => {
      try {
        const result = await saveAction(formData);
        if (!result.ok) {
          setErrors(result.errors);
          publishToast("error", result.errors.map((code) => getAdminErrorMessage(code, "pl")).join(" "));
          return;
        }
        onSaved(result, String(formData.get("imagePath") ?? ""));
      } catch {
        const errors = [ADMIN_ERROR_CODES.INTERNAL];
        setErrors(errors);
        publishToast("error", getAdminErrorMessage(errors[0], "pl"));
      } finally {
        onMutationStateChange(false);
      }
    });
  };

  const removeCollection = () => {
    if (!item || !window.confirm(`Usunąć kolekcję „${item.name}”? Produkty pozostaną i zostaną odłączone.`)) return;
    const formData = new FormData();
    formData.set("id", item.id);
    formData.set("expectedUpdatedAt", item.updatedAt);
    onMutationStateChange(true);
    startTransition(async () => {
      try {
        const result = await deleteAction(formData);
        if (!result.ok) {
          setErrors(result.errors);
          publishToast("error", result.errors.map((code) => getAdminErrorMessage(code, "pl")).join(" "));
          return;
        }
        await onDeleted(result, item.id);
      } catch {
        const errors = [ADMIN_ERROR_CODES.INTERNAL];
        setErrors(errors);
        publishToast("error", getAdminErrorMessage(errors[0], "pl"));
      } finally {
        onMutationStateChange(false);
      }
    });
  };

  return (
    <form className="flex h-full min-h-0 flex-col" onSubmit={submit}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="expectedUpdatedAt" value={item?.updatedAt ?? ""} />
        <input type="hidden" name="imagePath" value={image?.path ?? ""} />
        <input type="hidden" name="imageStorageProvider" value={image?.provider ?? ""} />
        <input type="hidden" name="imageFilename" value={image?.filename ?? ""} />
        <input type="hidden" name="imageContentType" value={image?.contentType ?? ""} />
        <input type="hidden" name="imageSizeBytes" value={image?.sizeBytes ?? ""} />

        {errors.length ? (
          <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            <p className="font-medium">Nie udało się zapisać zmian.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">{errors.map((error) => <li key={error}>{getAdminErrorMessage(error, "pl")}</li>)}</ul>
          </div>
        ) : null}

        <div className="grid gap-5 pb-5">
          <section className="grid gap-4 rounded-xl border border-[var(--color-border)] bg-white/70 p-4">
            <h3 className="font-medium">Podstawowe informacje</h3>
            <div className="grid gap-2">
              <Label htmlFor="collection-name">Nazwa</Label>
              <Input id="collection-name" name="name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} autoFocus={!item} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="collection-slug">Slug</Label>
              <Input id="collection-slug" name="slug" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="wygenerujemy-z-nazwy" />
              <p className="text-xs leading-5 text-[var(--color-muted)]">Slug musi być unikalny. Pozostaw puste, aby utworzyć go z nazwy.</p>
            </div>
          </section>

          <section className="grid gap-3 rounded-xl border border-[var(--color-border)] bg-white/70 p-4">
            <div>
              <h3 className="font-medium">Obraz kolekcji</h3>
              <p className="mt-1 text-sm text-[var(--color-muted)]">PNG, JPG lub WebP, maksymalnie 20 MB. Obraz jest widoczny tylko dla administratorów.</p>
            </div>
            {image ? (
              <div className="flex items-center gap-3">
                {/* The preview is an authenticated admin route backed by private object storage. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt={`Podgląd obrazu kolekcji ${name || "nowej kolekcji"}`} className="size-20 rounded-lg border border-[var(--color-border)] object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{image.filename}</p>
                  <p className="text-xs text-[var(--color-muted)]">{Math.ceil(image.sizeBytes / 1024)} KB</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={clearImage} disabled={isUploading || isPending} aria-label="Usuń obraz kolekcji"><Trash2 className="size-4" aria-hidden />Usuń</Button>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-muted)]">Nie dodano obrazu.</p>
            )}
            <input
              ref={fileInputRef}
              id="collection-image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label="Wybierz obraz kolekcji"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void uploadImage(file);
              }}
            />
            <Button type="button" variant="outline" className="w-fit" onClick={() => fileInputRef.current?.click()} disabled={isUploading || isPending}>
              <ImagePlus className="size-4" aria-hidden />{isUploading ? "Przesyłanie…" : image ? "Zmień obraz" : "Dodaj obraz"}
            </Button>
            {uploadError ? <p role="alert" className="text-sm text-red-800">{uploadError}</p> : null}
            {isUploading ? <p aria-live="polite" className="text-sm text-[var(--color-muted)]">Poczekaj na zakończenie przesyłania, zanim zamkniesz panel.</p> : null}
          </section>

          {item ? (
            <section className="rounded-lg border border-red-200 bg-red-50/50 p-4">
              <p className="text-sm font-semibold text-red-900">Strefa niebezpieczna</p>
              <p className="mt-1 text-sm leading-6 text-red-900/70">Usunięcie odłączy kolekcję od produktów. Produkty i ich pozostałe dane pozostaną.</p>
              <button type="button" className={buttonClassName({ variant: "outline", className: "mt-3 border-red-200 bg-white text-red-800 hover:bg-red-50" })} onClick={removeCollection} disabled={isPending || isUploading}>
                Usuń kolekcję
              </button>
            </section>
          ) : null}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 flex shrink-0 flex-wrap justify-end gap-2 border-t border-[var(--color-border)] bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(62,52,47,0.06)] backdrop-blur sm:px-6">
        <Button type="button" variant="outline" onClick={onClose} disabled={isPending || isUploading}>Anuluj</Button>
        <Button type="submit" disabled={isPending || isUploading}>{isPending ? "Zapisywanie…" : "Zapisz"}</Button>
      </div>
      <input type="hidden" name="sortOrder" value={item?.sortOrder ?? 100} />
    </form>
  );
}

function formatProductCount(count: number) {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  if (count === 1) return "1 produkt";
  if (lastTwoDigits < 12 || lastTwoDigits > 14) {
    if (lastDigit >= 2 && lastDigit <= 4) return `${count} produkty`;
  }
  return `${count} produktów`;
}
