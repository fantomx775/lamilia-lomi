"use client";

import { Archive, FileText, ImagePlus, LoaderCircle, MoveDown, MoveUp, Plus, RotateCcw, Save, Star, Trash2, Undo2, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { AdminEditorHeader, AdminEditorSection } from "@/components/admin/admin-editor-foundation";
import { AdminDisclosure } from "@/components/admin/admin-disclosure";
import { LocaleTabs } from "@/components/admin/locale-tabs";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { routing, type Locale } from "@/i18n/routing";
import { MAX_GALLERY_ASSETS, MEDIA_UPLOAD_SPECS, formatBytes, validateMediaFile } from "@/lib/media-upload";
import { uploadMediaWithTus, type SignedMediaUploadTarget } from "@/lib/media-upload-client";
import type { AmazonLink, Category, Product, ProductAsset, Tag } from "@/lib/types";

type TranslationDraft = {
  title: string;
  shortDescription: string;
  longDescription: string;
  seoTitle: string;
  seoDescription: string;
};

type AssetDraft = {
  clientId: string;
  id: string;
  kind: ProductAsset["kind"];
  bucket: string;
  path: string;
  storagePath?: string;
  filename: string;
  contentType: string;
  sizeBytes?: number;
  locale: Locale | "";
  title: string;
  sortOrder: number;
  removed: boolean;
  status: UploadStatus;
  error?: string;
  file?: File;
  uploaded?: boolean;
  upload?: SignedMediaUploadTarget;
  progress?: number;
};

type AmazonDraft = {
  clientId: string;
  id: string;
  market: AmazonLink["market"];
  url: string;
  isPrimary: boolean;
  removed: boolean;
};

const amazonMarketOptions: ReadonlyArray<{ value: AmazonLink["market"]; label: string }> = [
  { value: "amazon.com", label: "Amazon.com" },
  { value: "amazon.de", label: "Amazon.de" },
];

type PremiumDraft = {
  clientId: string;
  id: string;
  code: string;
  active: boolean;
  removed: boolean;
};

const productTypes = ["coloring-book", "picture-book", "audiobook"];

type UploadStatus = "queued" | "uploading" | "uploaded" | "failed";

const statusLabels = {
  draft: "Szkic",
  published: "Opublikowany",
  archived: "Zarchiwizowany",
} as const;

export function ProductEditor({
  title,
  product,
  categories,
  tags,
  feedback,
  saveAction,
  archiveAction,
  deleteAction,
}: {
  title: string;
  product?: Product;
  categories: Category[];
  tags: Tag[];
  feedback?: string;
  saveAction?: (formData: FormData) => void | Promise<void>;
  archiveAction?: (formData: FormData) => void | Promise<void>;
  deleteAction?: (formData: FormData) => void | Promise<void>;
}) {
  const [locale, setLocale] = useState<Locale>("en");
  const [translations, setTranslations] = useState<Record<Locale, TranslationDraft>>(() => buildTranslations(product));
  const [assets, setAssets] = useState<AssetDraft[]>(() => buildAssets(product));
  const [draftProductId] = useState(() => product?.id ?? createClientId());
  const [mediaErrors, setMediaErrors] = useState<Partial<Record<ProductAsset["kind"], string>>>({});
  const [amazonLinks, setAmazonLinks] = useState<AmazonDraft[]>(() => buildAmazonLinks(product));
  const [premiumCodes, setPremiumCodes] = useState<PremiumDraft[]>(() => buildPremiumCodes(product));
  const assetsRef = useRef(assets);
  const uploadVersionsRef = useRef(new Map<ProductAsset["kind"], number>());
  assetsRef.current = assets;
  const missingLocales = routing.locales.filter((code) => !translations[code].title.trim());
  const returnTo = product ? `/admin/products/${product.id}` : "/admin/products/new";
  const visibleAssets = assets.filter((asset) => !asset.removed && asset.status === "uploaded");
  const coverAsset = visibleAssets.find((asset) => asset.kind === "cover");
  const videoAsset = visibleAssets.find((asset) => asset.kind === "video");
  const hasActiveMediaUpload = assets.some((asset) => !asset.removed && (asset.status === "queued" || asset.status === "uploading"));
  const activeAmazonLinks = amazonLinks.filter((link) => !link.removed);
  const usedAmazonMarkets = new Set(activeAmazonLinks.map((link) => link.market));
  const canAddAmazonMarket = amazonMarketOptions.some(({ value }) => !usedAmazonMarkets.has(value));

  const updateTranslation = (field: keyof TranslationDraft, value: string) => {
    setTranslations((current) => ({ ...current, [locale]: { ...current[locale], [field]: value } }));
  };

  const updateAsset = <K extends keyof AssetDraft>(clientId: string, field: K, value: AssetDraft[K]) => {
    setAssets((current) => current.map((asset) => {
      if (asset.clientId !== clientId) {
        return asset;
      }

      const next = { ...asset, [field]: value } as AssetDraft;

      return next;
    }));
  };

  const nextUploadVersion = (kind: ProductAsset["kind"]) => {
    const version = (uploadVersionsRef.current.get(kind) ?? 0) + 1;
    uploadVersionsRef.current.set(kind, version);
    return version;
  };

  const isCurrentUpload = (kind: ProductAsset["kind"], version: number) =>
    MEDIA_UPLOAD_SPECS[kind].multiple || uploadVersionsRef.current.get(kind) === version;

  const uploadFiles = async (kind: ProductAsset["kind"], selectedFiles: FileList | File[]) => {
    const selected = Array.from(selectedFiles);
    const spec = MEDIA_UPLOAD_SPECS[kind];
    const selectionErrors: string[] = [];
    const validatedContentTypes = new Map<File, string>();

    if (!spec.multiple && selected.length > 1) {
      selectionErrors.push("W tej sekcji można dodać tylko jeden plik.");
    }

    const validFiles = selected.filter((file) => {
      const validation = validateMediaFile(kind, file);
      if (!validation.ok) {
        selectionErrors.push(validation.error);
        return false;
      }
      validatedContentTypes.set(file, validation.contentType);
      return true;
    });

    if (!validFiles.length) {
      setMediaErrors((current) => ({ ...current, [kind]: selectionErrors.join(" ") || "Nie wybrano prawidłowego pliku." }));
      return;
    }

    const files = spec.multiple ? validFiles : validFiles.slice(0, 1);
    const activeCount = assets.filter((asset) => !asset.removed && asset.kind === kind && asset.status !== "failed").length;

    if (kind === "gallery" && activeCount + files.length > MAX_GALLERY_ASSETS) {
      selectionErrors.push("Galeria może zawierać maksymalnie 20 obrazów. Usuń plik, aby dodać kolejny.");
    }

    if (!files.length || (kind === "gallery" && activeCount + files.length > MAX_GALLERY_ASSETS)) {
      setMediaErrors((current) => ({ ...current, [kind]: selectionErrors.join(" ") || "Nie wybrano prawidłowego pliku." }));
      return;
    }

    setMediaErrors((current) => ({ ...current, [kind]: selectionErrors.join(" ") || undefined }));
    const newDrafts = files.map((file, index) => ({
      clientId: createClientId(),
      id: "",
      kind,
      bucket: spec.bucket,
      path: "",
      storagePath: undefined,
      filename: file.name,
      contentType: validatedContentTypes.get(file) ?? file.type,
      sizeBytes: file.size,
      locale: "" as const,
      title: file.name,
      sortOrder: activeCount + index + 1,
      removed: false,
      status: "queued" as const,
      file,
      uploaded: false,
      progress: 0,
    }));

    if (!spec.multiple) {
      const version = nextUploadVersion(kind);
      setAssets((current) => [
        ...current.map((asset) => asset.kind === kind && !asset.removed && (asset.status === "queued" || asset.status === "uploading")
          ? { ...asset, removed: true }
          : asset),
        ...newDrafts,
      ]);
      await Promise.all(newDrafts.map((draft) => uploadAsset(draft, version)));
    } else {
      setAssets((current) => [...current, ...newDrafts]);
      await Promise.all(newDrafts.map((draft) => uploadAsset(draft)));
    }
  };

  const uploadAsset = async (draft: AssetDraft, version = uploadVersionsRef.current.get(draft.kind) ?? 0) => {
    const currentDraft = assetsRef.current.find((asset) => asset.clientId === draft.clientId) ?? draft;
    const file = currentDraft.file ?? draft.file;

    if (!file) {
      updateAsset(draft.clientId, "status", "failed");
      updateAsset(draft.clientId, "error", "Nie znaleziono pliku do ponowienia uploadu.");
      return;
    }

    updateAsset(draft.clientId, "status", "uploading");
    updateAsset(draft.clientId, "error", undefined);

    try {
      let uploadTarget = currentDraft.upload;
      let uploadedAsset: Partial<AssetDraft> = currentDraft;

      if (!uploadTarget) {
        let response = await fetch("/api/admin/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: draftProductId,
            kind: draft.kind,
            filename: file.name,
            sizeBytes: file.size,
            contentType: currentDraft.contentType,
            locale: currentDraft.locale || undefined,
          }),
        });
        let payload = await response.json() as { asset?: Partial<AssetDraft>; upload?: SignedMediaUploadTarget; error?: string };

        if (response.status === 415) {
          const formData = new FormData();
          formData.append("productId", draftProductId);
          formData.append("kind", draft.kind);
          formData.append("file", file);
          if (currentDraft.locale) formData.append("locale", currentDraft.locale);
          response = await fetch("/api/admin/assets", { method: "POST", body: formData });
          payload = await response.json() as { asset?: Partial<AssetDraft>; upload?: SignedMediaUploadTarget; error?: string };
        }

        if (!response.ok || !payload.asset) {
          throw new Error(payload.error || "Upload nie powiódł się.");
        }

        uploadedAsset = payload.asset;
        uploadTarget = payload.upload;
        setAssets((current) => current.map((asset) => asset.clientId === draft.clientId
          ? { ...asset, ...payload.asset, upload: payload.upload, status: "uploading", progress: 0, error: undefined }
          : asset));
      }

      if (uploadTarget) {
        await uploadMediaWithTus(file, uploadTarget, currentDraft.contentType, (progress) => {
          updateAsset(draft.clientId, "progress", progress);
        });
      }

      const currentState = assetsRef.current.find((asset) => asset.clientId === draft.clientId);
      const stale = !isCurrentUpload(draft.kind, version) || !currentState || currentState.removed;

      if (stale) {
        const storagePath = uploadedAsset.storagePath ?? uploadTarget?.path;
        if (storagePath) {
          await deleteUploadedStorage(draft.kind, storagePath);
        }
        setAssets((current) => current.filter((asset) => asset.clientId !== draft.clientId));
        return;
      }

      setAssets((current) => current.map((asset) => {
        if (asset.clientId === draft.clientId) {
          return {
            ...asset,
            ...uploadedAsset,
            upload: uploadTarget,
            status: "uploaded",
            uploaded: true,
            file,
            progress: 100,
            removed: false,
            error: undefined,
          } as AssetDraft;
        }

        if (!MEDIA_UPLOAD_SPECS[draft.kind].multiple && asset.kind === draft.kind && !asset.removed) {
          return { ...asset, removed: true };
        }

        return asset;
      }));
    } catch (error) {
      setAssets((current) => current.map((asset) => asset.clientId === draft.clientId ? {
        ...asset,
        status: "failed",
        error: error instanceof Error ? error.message : "Upload nie powiódł się.",
      } : asset));
    }
  };

  const removeAsset = async (asset: AssetDraft) => {
    if (!asset.id || asset.uploaded || asset.upload) {
      try {
        if (asset.storagePath) await deleteUploadedStorage(asset.kind, asset.storagePath);
        setAssets((current) => current.filter((item) => item.clientId !== asset.clientId));
      } catch (error) {
        setMediaErrors((current) => ({
          ...current,
          [asset.kind]: error instanceof Error ? error.message : "Nie udało się usunąć pliku.",
        }));
      }
      return;
    }
    updateAsset(asset.clientId, "removed", true);
  };

  const deleteUploadedStorage = async (kind: ProductAsset["kind"], storagePath: string) => {
    const response = await fetch("/api/admin/assets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: draftProductId, kind, storagePath }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error || "Nie udało się usunąć pliku.");
    }
  };

  const retryUpload = (asset: AssetDraft) => {
    const version = MEDIA_UPLOAD_SPECS[asset.kind].multiple ? 0 : nextUploadVersion(asset.kind);
    return uploadAsset(asset, version);
  };

  const reorderGallery = (clientId: string, direction: -1 | 1) => {
    setAssets((current) => {
      const gallery = current.filter((asset) => !asset.removed && asset.kind === "gallery" && asset.status === "uploaded");
      const index = gallery.findIndex((asset) => asset.clientId === clientId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= gallery.length) return current;

      const reordered = gallery.slice();
      [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
      const sortOrders = new Map(reordered.map((asset, order) => [asset.clientId, order + 1]));
      return current.map((asset) => sortOrders.has(asset.clientId) ? { ...asset, sortOrder: sortOrders.get(asset.clientId)! } : asset);
    });
  };

  const updateAmazon = <K extends keyof AmazonDraft>(clientId: string, field: K, value: AmazonDraft[K]) => {
    setAmazonLinks((current) => current.map((link) => link.clientId === clientId ? { ...link, [field]: value } : link));
  };

  const setPrimaryAmazon = (clientId: string) => {
    setAmazonLinks((current) => current.map((link) => ({ ...link, isPrimary: link.clientId === clientId })));
  };

  const addAmazon = () => {
    setAmazonLinks((current) => {
      const nextMarket = amazonMarketOptions.find(({ value }) =>
        !current.some((link) => !link.removed && link.market === value),
      )?.value;

      if (!nextMarket) {
        return current;
      }

      return [...current, {
        clientId: `amazon-${Date.now()}-${current.length}`,
        id: "",
        market: nextMarket,
        url: "",
        isPrimary: current.every((link) => link.removed),
        removed: false,
      }];
    });
  };

  const removeAmazon = (link: AmazonDraft) => {
    if (!link.id) {
      setAmazonLinks((current) => current.filter((item) => item.clientId !== link.clientId));
      return;
    }
    updateAmazon(link.clientId, "removed", true);
  };

  const updatePremium = <K extends keyof PremiumDraft>(clientId: string, field: K, value: PremiumDraft[K]) => {
    setPremiumCodes((current) => current.map((code) => code.clientId === clientId ? { ...code, [field]: value } : code));
  };

  const addPremium = () => {
    setPremiumCodes((current) => [...current, {
      clientId: `code-${Date.now()}-${current.length}`,
      id: "",
      code: "",
      active: true,
      removed: false,
    }]);
  };

  const removePremium = (code: PremiumDraft) => {
    if (!code.id) {
      setPremiumCodes((current) => current.filter((item) => item.clientId !== code.clientId));
      return;
    }
    updatePremium(code.clientId, "removed", true);
  };

  return (
    <div className="min-w-0">
      <form id="product-editor-form" action={saveAction} className="grid gap-6">
        <input type="hidden" name="id" value={draftProductId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="coverAssetId" value={coverAsset?.id ?? ""} />
        <input type="hidden" name="videoAssetId" value={videoAsset?.id ?? ""} />
        <input type="hidden" name="mediaUploadState" value={hasActiveMediaUpload ? "active" : "idle"} />
        {routing.locales.map((code) => (
          <span key={code}>
            <input type="hidden" name={`title_${code}`} value={translations[code].title} />
            <input type="hidden" name={`shortDescription_${code}`} value={translations[code].shortDescription} />
            <input type="hidden" name={`longDescription_${code}`} value={translations[code].longDescription} />
            <input type="hidden" name={`seoTitle_${code}`} value={translations[code].seoTitle} />
            <input type="hidden" name={`seoDescription_${code}`} value={translations[code].seoDescription} />
          </span>
        ))}

        <AdminEditorHeader
          backHref="/admin/products"
          backLabel="Produkty"
          title={title}
          subtitle={product ? `ID: ${product.id} · URL: /products/${product.slug}` : "Slug zostanie wygenerowany z tytułu EN, jeśli nie wpiszesz go ręcznie."}
          status={product ? <Badge className={statusClass(product.status)}>{statusLabels[product.status]}</Badge> : <Badge>Szkic</Badge>}
          actions={<ProductSubmitButton disabled={hasActiveMediaUpload} />}
        />

        {hasActiveMediaUpload ? <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Zapis produktu będzie dostępny po zakończeniu przesyłania plików.</p> : null}
        {feedback ? <div role="alert" className="rounded-md border border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[var(--color-terracotta)]">{feedback}</div> : null}

        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
          <main className="grid min-w-0 gap-6">
            <AdminEditorSection title="Podstawowe informacje" description="Treść produktu jest przechowywana osobno dla każdego języka.">
              <div className="grid min-w-0 gap-5">
                <LocaleTabs value={locale} onChange={setLocale} missingLocales={missingLocales} id="product-locale-panel" />
                <div id="product-locale-panel" className="grid min-w-0 gap-4" role="tabpanel">
                  <Field label="Tytuł" htmlFor={`product-title-${locale}`}>
                    <Input id={`product-title-${locale}`} name={`title_${locale}`} value={translations[locale].title} onChange={(event) => updateTranslation("title", event.target.value)} />
                  </Field>
                  <Field label="Krótki opis" htmlFor={`product-short-description-${locale}`}>
                    <Input id={`product-short-description-${locale}`} name={`shortDescription_${locale}`} value={translations[locale].shortDescription} onChange={(event) => updateTranslation("shortDescription", event.target.value)} />
                  </Field>
                  <Field label="Długi opis" htmlFor={`product-long-description-${locale}`}>
                    <Textarea id={`product-long-description-${locale}`} name={`longDescription_${locale}`} value={translations[locale].longDescription} onChange={(event) => updateTranslation("longDescription", event.target.value)} className="min-h-48" />
                  </Field>
                  <AdminDisclosure className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4" summary="SEO i wygląd w Google">
                    <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Puste pole użyje fallbacku: tytułu produktu lub krótkiego opisu.</p>
                    <div className="mt-4 grid gap-4">
                      <Field label="SEO title" htmlFor={`product-seo-title-${locale}`}><Input id={`product-seo-title-${locale}`} name={`seoTitle_${locale}`} value={translations[locale].seoTitle} onChange={(event) => updateTranslation("seoTitle", event.target.value)} /></Field>
                      <Field label="SEO description" htmlFor={`product-seo-description-${locale}`}><Textarea id={`product-seo-description-${locale}`} name={`seoDescription_${locale}`} value={translations[locale].seoDescription} onChange={(event) => updateTranslation("seoDescription", event.target.value)} className="min-h-28" /></Field>
                    </div>
                  </AdminDisclosure>
                </div>
              </div>
            </AdminEditorSection>

            <MediaSections assets={assets} errors={mediaErrors} onUpload={uploadFiles} onRemove={removeAsset} onUndo={(asset) => updateAsset(asset.clientId, "removed", false)} onRetry={(asset) => void retryUpload(asset)} onMove={reorderGallery} />

            <AdminEditorSection title="Sprzedaż na Amazon" description="Dodaj maksymalnie jeden link dla każdego rynku i wybierz jeden domyślny.">
              <div className="grid gap-3">
                {amazonLinks.length === 0 ? <p className="text-sm text-[var(--color-muted)]">Nie dodano jeszcze rynku.</p> : null}
                {amazonLinks.map((link, index) => (
                  <AmazonEditor
                    key={link.clientId}
                    link={link}
                    index={index}
                    availableMarkets={amazonMarketOptions.filter(({ value }) => value === link.market || !usedAmazonMarkets.has(value))}
                    onChange={updateAmazon}
                    onPrimary={setPrimaryAmazon}
                    onRemove={removeAmazon}
                    onUndo={() => updateAmazon(link.clientId, "removed", false)}
                  />
                ))}
                <Button type="button" variant="outline" onClick={addAmazon} disabled={!canAddAmazonMarket} className="w-fit"><Plus className="size-4" aria-hidden />Dodaj rynek</Button>
                {!canAddAmazonMarket ? <p className="text-sm text-[var(--color-muted)]">Dodano wszystkie dostępne rynki.</p> : null}
              </div>
            </AdminEditorSection>

            <AdminEditorSection title="Dostęp premium" description="Kody są pokazywane bez technicznych identyfikatorów; ich aktywność pozostaje zapisywana w obecnym modelu.">
              <div className="grid gap-3">
                {premiumCodes.length === 0 ? <p className="text-sm text-[var(--color-muted)]">Nie dodano jeszcze kodów premium.</p> : null}
                {premiumCodes.map((code, index) => (
                  <PremiumEditor key={code.clientId} code={code} index={index} onChange={updatePremium} onRemove={removePremium} onUndo={() => updatePremium(code.clientId, "removed", false)} />
                ))}
                <Button type="button" variant="outline" onClick={addPremium} className="w-fit"><Plus className="size-4" aria-hidden />Dodaj kod</Button>
              </div>
            </AdminEditorSection>
          </main>

          <aside className="grid h-fit min-w-0 gap-6 xl:sticky xl:top-6">
            <AdminEditorSection title="Publikacja">
              <Field label="Status" htmlFor="product-status">
                <select id="product-status" name="status" defaultValue={product?.status ?? "draft"} className="h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm outline-none focus:border-[var(--color-terracotta)] focus:ring-4 focus:ring-[var(--color-terracotta-ring)]">
                  <option value="draft">Szkic</option><option value="published">Opublikowany</option><option value="archived">Zarchiwizowany</option>
                </select>
              </Field>
              <p className="mt-3 text-xs leading-5 text-[var(--color-muted)]">Przy publikacji wymagane są angielski tytuł, krótki opis, okładka i link Amazon.</p>
            </AdminEditorSection>

            <AdminEditorSection title="Organizacja">
              <div className="grid gap-4">
                <Field label="Segment" htmlFor="product-audience"><select id="product-audience" name="audience" defaultValue={product?.audience ?? "kids"} className="h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm"><option value="kids">Dzieci</option><option value="adults">Dorośli</option></select></Field>
                <Field label="Typ produktu" htmlFor="product-type"><select id="product-type" name="productType" defaultValue={product?.productType ?? "coloring-book"} className="h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm">{product?.productType && !productTypes.includes(product.productType) ? <option value={product.productType}>{formatProductType(product.productType)}</option> : null}{productTypes.map((type) => <option key={type} value={type}>{formatProductType(type)}</option>)}</select></Field>
                <CheckboxGroup label="Kategorie" name="categoryIds" values={categories.map((category) => ({ id: category.id, label: taxonomyLabel(category.translations, category.slug) }))} selected={product?.categoryIds ?? []} />
                <CheckboxGroup label="Tagi" name="tagIds" values={tags.map((tag) => ({ id: tag.id, label: taxonomyLabel(tag.translations, tag.slug) }))} selected={product?.tagIds ?? []} />
              </div>
            </AdminEditorSection>

            <AdminEditorSection title="Zaawansowane">
              <div className="grid gap-4">
                <Field label="URL produktu" htmlFor="product-slug"><Input id="product-slug" name="slug" defaultValue={product?.slug ?? ""} placeholder="moon-garden-coloring-book" /><p className="text-xs leading-5 text-[var(--color-muted)]">/products/{product?.slug || "slug-z-tytulu-en"}</p></Field>
                <Field label="Kolejność" htmlFor="product-sort-order"><Input id="product-sort-order" name="sortOrder" type="number" defaultValue={product?.sortOrder ?? 100} /></Field>
                <Field label="Opóźnienie opinii (dni)" htmlFor="product-review-delay"><Input id="product-review-delay" name="reviewDelayDays" type="number" min={1} defaultValue={product?.reviewDelayDays ?? 14} /></Field>
              </div>
            </AdminEditorSection>
          </aside>
        </div>
      </form>

      {product && archiveAction && deleteAction ? (
        <DangerZone product={product} archiveAction={archiveAction} deleteAction={deleteAction} />
      ) : null}
    </div>
  );
}

function ProductSubmitButton({ disabled = false }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending || disabled}><Save className="size-4" aria-hidden />{pending ? "Zapisywanie…" : "Zapisz"}</Button>;
}

function MediaSections({
  assets,
  errors,
  onUpload,
  onRemove,
  onUndo,
  onRetry,
  onMove,
}: {
  assets: AssetDraft[];
  errors: Partial<Record<ProductAsset["kind"], string>>;
  onUpload: (kind: ProductAsset["kind"], files: FileList | File[]) => void;
  onRemove: (asset: AssetDraft) => void;
  onUndo: (asset: AssetDraft) => void;
  onRetry: (asset: AssetDraft) => void;
  onMove: (clientId: string, direction: -1 | 1) => void;
}) {
  return <div className="grid min-w-0 gap-6">
    <MediaSection kind="cover" title="OKŁADKA" description="Jedna grafika reprezentująca produkt. Możesz ją później zastąpić lub usunąć." assets={assets} error={errors.cover} onUpload={onUpload} onRemove={onRemove} onUndo={onUndo} onRetry={onRetry} onMove={onMove} />
    <MediaSection kind="gallery" title="GALERIA" description="Dodaj do 20 obrazów i ustaw ich kolejność przyciskami góra/dół." assets={assets} error={errors.gallery} onUpload={onUpload} onRemove={onRemove} onUndo={onUndo} onRetry={onRetry} onMove={onMove} />
    <MediaSection kind="video" title="WIDEO FLIPTHROUGH" description="Jedno publiczne wideo pokazujące zawartość produktu." assets={assets} error={errors.video} onUpload={onUpload} onRemove={onRemove} onUndo={onUndo} onRetry={onRetry} onMove={onMove} />
    <MediaSection kind="public_download" title="PUBLICZNE PLIKI DO POBRANIA" description="Pliki dostępne dla każdego odwiedzającego — bez logowania i bez odblokowania." assets={assets} error={errors.public_download} onUpload={onUpload} onRemove={onRemove} onUndo={onUndo} onRetry={onRetry} onMove={onMove} />
    <MediaSection kind="premium_download" title="MATERIAŁY PREMIUM" description="Prywatne materiały dostępne dopiero po weryfikacji e-maila i odblokowaniu produktu." assets={assets} error={errors.premium_download} onUpload={onUpload} onRemove={onRemove} onUndo={onUndo} onRetry={onRetry} onMove={onMove} />
  </div>;
}

function MediaSection({
  kind,
  title,
  description,
  assets,
  error,
  onUpload,
  onRemove,
  onUndo,
  onRetry,
  onMove,
}: {
  kind: ProductAsset["kind"];
  title: string;
  description: string;
  assets: AssetDraft[];
  error?: string;
  onUpload: (kind: ProductAsset["kind"], files: FileList | File[]) => void;
  onRemove: (asset: AssetDraft) => void;
  onUndo: (asset: AssetDraft) => void;
  onRetry: (asset: AssetDraft) => void;
  onMove: (clientId: string, direction: -1 | 1) => void;
}) {
  const sectionAssets = assets.filter((asset) => asset.kind === kind);
  const visibleAssets = sectionAssets.filter((asset) => !asset.removed);
  const spec = MEDIA_UPLOAD_SPECS[kind];

  return <AdminEditorSection title={title} description={description}>
    <div className="grid min-w-0 gap-4">
      <UploadDropzone kind={kind} accept={spec.accept} multiple={spec.multiple} onFiles={(files) => onUpload(kind, files)} />
      <p className="text-xs leading-5 text-[var(--color-muted)]">{uploadHint(kind)}</p>
      {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p> : null}
      {visibleAssets.length ? <div className="grid min-w-0 gap-3" aria-live="polite">{visibleAssets.map((asset, index) => <MediaAssetRow key={asset.clientId} asset={asset} kind={kind} index={index} total={visibleAssets.length} onRemove={onRemove} onRetry={onRetry} onMove={onMove} />)}</div> : <p className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-5 text-sm text-[var(--color-muted)]">Nie dodano jeszcze plików.</p>}
      {sectionAssets.filter((asset) => asset.removed).map((asset) => <RemovedAssetRow key={asset.clientId} asset={asset} onUndo={onUndo} />)}
    </div>
  </AdminEditorSection>;
}

function UploadDropzone({
  kind,
  accept,
  multiple,
  onFiles,
}: {
  kind: ProductAsset["kind"];
  accept: string;
  multiple: boolean;
  onFiles: (files: FileList) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const inputId = `media-upload-${kind}`;
  const openPicker = () => inputRef.current?.click();

  return <div
    role="button"
    tabIndex={0}
    aria-controls={inputId}
    aria-label={`Wybierz pliki do sekcji ${mediaTitle(kind)}`}
    onClick={openPicker}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPicker(); } }}
    onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
    onDragLeave={() => setDragging(false)}
    onDrop={(event) => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) onFiles(event.dataTransfer.files); }}
    className={`grid min-h-36 cursor-pointer place-items-center rounded-xl border-2 border-dashed px-5 py-6 text-center transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] ${dragging ? "border-[var(--color-terracotta)] bg-[var(--color-blush)]" : "border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-terracotta)] hover:bg-[var(--color-blush)]"}`}
  >
    <input ref={inputRef} id={inputId} type="file" accept={accept} multiple={multiple} className="sr-only" aria-label={`Wybierz pliki do sekcji ${mediaTitle(kind)}`} onClick={(event) => event.stopPropagation()} onChange={(event) => { if (event.target.files?.length) onFiles(event.target.files); event.currentTarget.value = ""; }} />
    <span className="grid justify-items-center gap-2">
      <span className="grid size-11 place-items-center rounded-full bg-white text-[var(--color-terracotta)] shadow-sm"><ImagePlus className="size-5" aria-hidden /></span>
      <span className="font-medium">Przeciągnij pliki tutaj lub kliknij, aby wybrać</span>
      <span className="text-xs text-[var(--color-muted)]">Wybór z klawiatury: Enter lub Spacja</span>
    </span>
  </div>;
}

function MediaAssetRow({ asset, kind, index, total, onRemove, onRetry, onMove }: { asset: AssetDraft; kind: ProductAsset["kind"]; index: number; total: number; onRemove: (asset: AssetDraft) => void; onRetry: (asset: AssetDraft) => void; onMove: (clientId: string, direction: -1 | 1) => void }) {
  const isUploading = asset.status === "uploading" || asset.status === "queued";
  const isFailed = asset.status === "failed";
  const isImage = asset.contentType.startsWith("image/") || /\.(png|jpe?g|gif|svg|webp)$/i.test(asset.filename);
  const isVideo = kind === "video" && asset.contentType.startsWith("video/");

  return <div className="grid min-w-0 gap-3 rounded-xl border border-[var(--color-border)] bg-white p-3 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center">
    {asset.status === "uploaded" && isImage ? <AssetPreview asset={asset} /> : asset.status === "uploaded" && isVideo ? <AssetVideoPreview asset={asset} /> : <div className="grid size-20 shrink-0 place-items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-terracotta)]">{kind === "video" ? <Video className="size-6" aria-hidden /> : kind.includes("download") ? <FileText className="size-6" aria-hidden /> : <ImagePlus className="size-6" aria-hidden />}</div>}
    <div className="min-w-0">
      <p className="break-words font-medium">{asset.filename || "Nowy plik"}</p>
      <p className="mt-1 text-xs text-[var(--color-muted)]">{formatBytes(asset.sizeBytes)}{asset.locale ? ` · ${asset.locale.toUpperCase()}` : ""}</p>
      <p className={`mt-2 inline-flex items-center gap-1 text-xs ${isFailed ? "text-red-800" : "text-[var(--color-muted)]"}`} role={isUploading || isFailed ? "status" : undefined} aria-live="polite">
        {isUploading ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : isFailed ? <X className="size-3.5" aria-hidden /> : asset.status === "queued" ? <LoaderCircle className="size-3.5" aria-hidden /> : <span className="size-1.5 rounded-full bg-emerald-600" aria-hidden />}
        {asset.status === "uploading" ? "Przesyłanie…" : isFailed ? asset.error || "Upload nie powiódł się." : asset.status === "queued" ? "Oczekuje" : "Przesłano"}
      </p>
      {isUploading ? <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg)]" role="progressbar" aria-label="Postęp przesyłania" aria-valuemin={0} aria-valuemax={100} aria-valuenow={asset.progress ?? 0}><div className="h-full rounded-full bg-[var(--color-terracotta)] transition-[width]" style={{ width: `${asset.progress ?? 0}%` }} /></div> : null}
    </div>
    <div className="flex flex-wrap items-center justify-end gap-1 sm:max-w-32">
      {kind === "gallery" && asset.status === "uploaded" ? <><Button type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => onMove(asset.clientId, -1)} aria-label={`Przenieś ${asset.filename} wyżej`}><MoveUp className="size-4" aria-hidden /></Button><Button type="button" variant="ghost" size="icon" disabled={index === total - 1} onClick={() => onMove(asset.clientId, 1)} aria-label={`Przenieś ${asset.filename} niżej`}><MoveDown className="size-4" aria-hidden /></Button></> : null}
      <Button type="button" variant="ghost" size="sm" disabled={asset.status === "uploading"} onClick={() => onRemove(asset)} className="text-red-800"><Trash2 className="size-4" aria-hidden />Usuń</Button>
    </div>
    {asset.status === "failed" ? <div className="sm:col-span-2"><Button type="button" variant="outline" size="sm" onClick={() => onRetry(asset)}><RotateCcw className="size-4" aria-hidden />Ponów</Button></div> : null}
    {asset.status === "uploaded" ? hiddenAssetFields(asset) : null}
  </div>;

}

function AssetPreview({ asset }: { asset: AssetDraft }) {
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;

    const preview = asset.file ? URL.createObjectURL(asset.file) : asset.path;
    if (preview) element.style.backgroundImage = `url("${preview}")`;

    return () => {
      if (asset.file) URL.revokeObjectURL(preview);
      element.style.backgroundImage = "";
    };
  }, [asset.file, asset.path]);

  return <div ref={previewRef} role="img" aria-label={`Podgląd ${asset.filename}`} className="size-20 shrink-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] bg-cover bg-center" />;
}

function AssetVideoPreview({ asset }: { asset: AssetDraft }) {
  const previewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;

    const preview = asset.file ? URL.createObjectURL(asset.file) : asset.path;
    if (preview) {
      element.src = preview;
      element.load();
    }

    return () => {
      if (asset.file) URL.revokeObjectURL(preview);
      element.removeAttribute("src");
      element.load();
    };
  }, [asset.file, asset.path]);

  return <video ref={previewRef} className="size-20 shrink-0 rounded-lg border border-[var(--color-border)] bg-black object-cover" controls preload="metadata" aria-label={`Podgląd ${asset.filename}`} />;
}

function RemovedAssetRow({ asset, onUndo }: { asset: AssetDraft; onUndo: (asset: AssetDraft) => void }) {
  return <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"><span className="min-w-0 break-words">„{asset.filename || asset.title}” zostanie usunięty po zapisaniu.</span><Button type="button" variant="ghost" size="sm" onClick={() => onUndo(asset)}><Undo2 className="size-4" aria-hidden />Cofnij</Button>{hiddenAssetFields(asset, true)}</div>;
}

function hiddenAssetFields(asset: AssetDraft, removed = false) {
  const path = asset.storagePath || asset.path;
  if (!asset.id || !path) return null;
  return <span className="hidden" aria-hidden>
    <input type="hidden" name="assetId" value={asset.id} />
    <input type="hidden" name="assetKind" value={asset.kind} />
    <input type="hidden" name="assetBucket" value={asset.bucket} />
    <input type="hidden" name="assetPath" value={path} />
    <input type="hidden" name="assetFilename" value={asset.filename} />
    <input type="hidden" name="assetContentType" value={asset.contentType} />
    <input type="hidden" name="assetSizeBytes" value={asset.sizeBytes ?? ""} />
    <input type="hidden" name="assetLocale" value={asset.locale} />
    <input type="hidden" name="assetTitle" value={asset.title || asset.filename} />
    <input type="hidden" name="assetSortOrder" value={asset.sortOrder} />
    <input type="hidden" name="assetUploaded" value={asset.uploaded ? "1" : "0"} />
    {removed ? <input type="hidden" name="assetRemove" value={asset.id} /> : null}
  </span>;
}

function mediaTitle(kind: ProductAsset["kind"]) {
  return { cover: "okładki", gallery: "galerii", video: "wideo flipthrough", public_download: "publicznych plików", premium_download: "materiałów premium" }[kind];
}

function uploadHint(kind: ProductAsset["kind"]) {
  return { cover: "1 obraz · PNG, JPG lub WEBP · maks. 20 MB", gallery: "Maks. 20 obrazów · PNG, JPG lub WEBP · maks. 20 MB każdy", video: "1 plik · MP4 lub WebM · maks. 50 MB", public_download: "Wiele plików · PDF, PNG, JPG lub WEBP · maks. 20 MB każdy", premium_download: "Wiele plików · PDF, PNG, JPG lub WEBP · maks. 50 MB każdy" }[kind];
}

function AmazonEditor({
  link,
  index,
  availableMarkets,
  onChange,
  onPrimary,
  onRemove,
  onUndo,
}: {
  link: AmazonDraft;
  index: number;
  availableMarkets: ReadonlyArray<{ value: AmazonLink["market"]; label: string }>;
  onChange: <K extends keyof AmazonDraft>(clientId: string, field: K, value: AmazonDraft[K]) => void;
  onPrimary: (clientId: string) => void;
  onRemove: (link: AmazonDraft) => void;
  onUndo: () => void;
}) {
  if (link.removed) {
    return <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><span>Rynek {link.market} zostanie usunięty.</span><><input type="hidden" name="amazonId" value={link.id} /><input type="hidden" name="amazonMarket" value={link.market} /><input type="hidden" name="amazonUrl" value={link.url} /><input type="hidden" name="amazonRemove" value={link.id} /><Button type="button" variant="ghost" size="sm" onClick={onUndo}><Undo2 className="size-4" aria-hidden />Cofnij</Button></></div>;
  }
  const primaryValue = link.id || `new-${index}`;
  return <div className="grid min-w-0 gap-3 rounded-lg border border-[var(--color-border)] bg-white p-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto_auto]"><input type="hidden" name="amazonId" value={link.id} /><Field label="Rynek" htmlFor={`amazon-market-${link.clientId}`}><select id={`amazon-market-${link.clientId}`} name="amazonMarket" value={link.market} onChange={(event) => onChange(link.clientId, "market", event.target.value as AmazonDraft["market"])} className="h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm">{availableMarkets.map((market) => <option key={market.value} value={market.value}>{market.label}</option>)}</select></Field><Field label="Link" htmlFor={`amazon-url-${link.clientId}`}><Input id={`amazon-url-${link.clientId}`} name="amazonUrl" value={link.url} onChange={(event) => onChange(link.clientId, "url", event.target.value)} placeholder="https://www.amazon.com/..." /></Field><label className="flex items-end gap-2 pb-3 text-sm"><input type="radio" name="amazonPrimary" value={primaryValue} checked={link.isPrimary} onChange={() => onPrimary(link.clientId)} /><Star className="size-4" aria-hidden />Domyślny</label><Button type="button" variant="ghost" size="sm" onClick={() => onRemove(link)} className="self-end text-red-800">Usuń</Button></div>;
}

function PremiumEditor({
  code,
  index,
  onChange,
  onRemove,
  onUndo,
}: {
  code: PremiumDraft;
  index: number;
  onChange: <K extends keyof PremiumDraft>(clientId: string, field: K, value: PremiumDraft[K]) => void;
  onRemove: (code: PremiumDraft) => void;
  onUndo: () => void;
}) {
  if (code.removed) {
    return <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><span>Kod {code.code || "(pusty)"} zostanie usunięty.</span><><input type="hidden" name="premiumCodeId" value={code.id} /><input type="hidden" name="premiumCode" value={code.code} /><input type="hidden" name="premiumCodeRemove" value={code.id} /><Button type="button" variant="ghost" size="sm" onClick={onUndo}><Undo2 className="size-4" aria-hidden />Cofnij</Button></></div>;
  }
  const activeValue = code.id || `new-${index}`;
  return <div className="grid min-w-0 gap-3 rounded-lg border border-[var(--color-border)] bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]"><input type="hidden" name="premiumCodeId" value={code.id} /><Field label="Kod" htmlFor={`premium-code-${code.clientId}`}><Input id={`premium-code-${code.clientId}`} name="premiumCode" value={code.code} onChange={(event) => onChange(code.clientId, "code", event.target.value.toUpperCase())} placeholder="LOMI-BOOK-2026" /></Field><label className="flex items-end gap-2 pb-3 text-sm"><input type="checkbox" name="premiumCodeActive" value={activeValue} checked={code.active} onChange={(event) => onChange(code.clientId, "active", event.target.checked)} />Aktywny</label><Button type="button" variant="ghost" size="sm" onClick={() => onRemove(code)} className="self-end text-red-800">Usuń</Button></div>;
}

function CheckboxGroup({ label, name, values, selected }: { label: string; name: string; values: Array<{ id: string; label: string }>; selected: string[] }) {
  return <fieldset className="grid gap-2"><legend className="text-sm font-medium">{label}</legend>{values.length ? values.map((value) => <label key={value.id} className="flex min-w-0 items-start gap-2 text-sm"><input type="checkbox" name={name} value={value.id} defaultChecked={selected.includes(value.id)} className="mt-0.5 shrink-0" /><span className="break-words">{value.label}</span></label>) : <p className="text-sm text-[var(--color-muted)]">Brak dostępnych elementów.</p>}</fieldset>;
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return <div className="grid min-w-0 gap-2"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>;
}

function DangerZone({
  product,
  archiveAction,
  deleteAction,
}: {
  product: Product;
  archiveAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
}) {
  return <section className="grid gap-4 rounded-lg border border-red-200 bg-red-50/60 p-5"><div><h2 className="font-serif text-2xl font-semibold text-red-950">Strefa niebezpieczna</h2><p className="mt-1 text-sm leading-6 text-red-900/80">Archiwizowanie i usuwanie nie są główną akcją edytora.</p></div><div className="flex flex-wrap gap-2"><form action={archiveAction}><input type="hidden" name="id" value={product.id} /><Button type="submit" variant="outline" className="border-red-200 text-red-900 hover:bg-red-100"><Archive className="size-4" aria-hidden />Archiwizuj</Button></form><form action={deleteAction} onSubmit={(event) => { if (!window.confirm("Czy na pewno usunąć ten produkt?")) event.preventDefault(); }}><input type="hidden" name="id" value={product.id} /><button type="submit" className={buttonClassName({ variant: "outline", className: "border-red-200 text-red-900 hover:bg-red-100" })}><Trash2 className="size-4" aria-hidden />Usuń produkt</button></form></div></section>;
}

function buildTranslations(product?: Product): Record<Locale, TranslationDraft> {
  return Object.fromEntries(routing.locales.map((locale) => {
    const translation = product?.translations.find((item) => item.locale === locale);
    return [locale, { title: translation?.title ?? "", shortDescription: translation?.shortDescription ?? "", longDescription: translation?.longDescription ?? "", seoTitle: translation?.seoTitle ?? "", seoDescription: translation?.seoDescription ?? "" }];
  })) as Record<Locale, TranslationDraft>;
}

function buildAssets(product?: Product): AssetDraft[] {
  return (product?.assets ?? [])
    .filter((asset) => asset.isActive !== false)
    .map((asset, index) => ({ clientId: `existing-asset-${asset.id}`, id: asset.id, kind: asset.kind, bucket: asset.bucket, path: asset.path, storagePath: asset.storagePath, filename: asset.filename, contentType: asset.contentType, sizeBytes: asset.sizeBytes, locale: asset.locale ?? "", title: asset.title ?? "", sortOrder: asset.sortOrder || index + 1, removed: false, status: "uploaded" as const, uploaded: false }));
}

function buildAmazonLinks(product?: Product): AmazonDraft[] {
  return (product?.amazonLinks ?? []).map((link) => ({ clientId: `existing-amazon-${link.id}`, id: link.id, market: link.market, url: link.url, isPrimary: link.isPrimary, removed: false }));
}

function buildPremiumCodes(product?: Product): PremiumDraft[] {
  return (product?.premiumCodes ?? []).map((code) => ({ clientId: `existing-code-${code.id}`, id: code.id, code: code.code, active: code.active, removed: false }));
}

function createClientId() {
  return globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatProductType(value: string) {
  return value.split("-").map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

function statusClass(status: Product["status"]) {
  return { draft: "border-amber-200 bg-amber-50 text-amber-900", published: "border-emerald-200 bg-emerald-50 text-emerald-900", archived: "border-slate-200 bg-slate-100 text-slate-700" }[status];
}

function taxonomyLabel(translations: Array<{ locale: Locale; name: string }>, fallback: string) {
  return translations.find((translation) => translation.locale === "en")?.name || translations[0]?.name || fallback;
}
