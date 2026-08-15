"use client";

import { Archive, Plus, Save, Star, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
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
  filename: string;
  contentType: string;
  locale: Locale | "";
  title: string;
  sortOrder: number;
  removed: boolean;
};

type AmazonDraft = {
  clientId: string;
  id: string;
  market: AmazonLink["market"];
  url: string;
  isPrimary: boolean;
  removed: boolean;
};

type PremiumDraft = {
  clientId: string;
  id: string;
  code: string;
  active: boolean;
  removed: boolean;
};

const assetKinds: Array<ProductAsset["kind"]> = ["cover", "gallery", "video", "public_download", "premium_download"];
const productTypes = ["coloring-book", "picture-book", "audiobook"];

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
  const [amazonLinks, setAmazonLinks] = useState<AmazonDraft[]>(() => buildAmazonLinks(product));
  const [premiumCodes, setPremiumCodes] = useState<PremiumDraft[]>(() => buildPremiumCodes(product));
  const missingLocales = routing.locales.filter((code) => !translations[code].title.trim());
  const returnTo = product ? `/admin/products/${product.id}` : "/admin/products/new";
  const visibleAssets = assets.filter((asset) => !asset.removed);
  const coverOptions = visibleAssets.filter((asset) => asset.kind === "cover" && asset.id);
  const videoOptions = visibleAssets.filter((asset) => asset.kind === "video" && asset.id);

  const updateTranslation = (field: keyof TranslationDraft, value: string) => {
    setTranslations((current) => ({ ...current, [locale]: { ...current[locale], [field]: value } }));
  };

  const updateAsset = <K extends keyof AssetDraft>(clientId: string, field: K, value: AssetDraft[K]) => {
    setAssets((current) => current.map((asset) => asset.clientId === clientId ? { ...asset, [field]: value } : asset));
  };

  const addAsset = () => {
    const clientId = `asset-${Date.now()}-${assets.length}`;
    setAssets((current) => [...current, {
      clientId,
      id: "",
      kind: "gallery",
      bucket: "public-media",
      path: "",
      filename: "",
      contentType: "",
      locale: "",
      title: "",
      sortOrder: current.length + 1,
      removed: false,
    }]);
  };

  const removeAsset = (asset: AssetDraft) => {
    if (!asset.id) {
      setAssets((current) => current.filter((item) => item.clientId !== asset.clientId));
      return;
    }
    updateAsset(asset.clientId, "removed", true);
  };

  const updateAmazon = <K extends keyof AmazonDraft>(clientId: string, field: K, value: AmazonDraft[K]) => {
    setAmazonLinks((current) => current.map((link) => link.clientId === clientId ? { ...link, [field]: value } : link));
  };

  const setPrimaryAmazon = (clientId: string) => {
    setAmazonLinks((current) => current.map((link) => ({ ...link, isPrimary: link.clientId === clientId })));
  };

  const addAmazon = () => {
    setAmazonLinks((current) => [...current, {
      clientId: `amazon-${Date.now()}-${current.length}`,
      id: "",
      market: "amazon.com",
      url: "",
      isPrimary: current.length === 0,
      removed: false,
    }]);
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
        <input type="hidden" name="id" value={product?.id ?? ""} />
        <input type="hidden" name="returnTo" value={returnTo} />
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
          actions={<ProductSubmitButton />}
        />

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

            <AdminEditorSection title="Okładka i media" description="Binary upload nie jest jeszcze dostępny w local-demo. Dodaj istniejącą ścieżkę lub URL assetu; techniczne metadane są schowane.">
              <div className="grid gap-4">
                {assets.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--color-border)] p-5 text-sm text-[var(--color-muted)]">Brak assetów. Dodaj okładkę, galerię lub plik przez ścieżkę/URL.</p> : null}
                {assets.map((asset, index) => (
                  <AssetEditor key={asset.clientId} asset={asset} index={index} onChange={updateAsset} onRemove={removeAsset} onUndo={() => updateAsset(asset.clientId, "removed", false)} />
                ))}
                <Button type="button" variant="outline" onClick={addAsset} className="w-fit"><Plus className="size-4" aria-hidden />Dodaj asset</Button>
              </div>
            </AdminEditorSection>

            <AdminEditorSection title="Sprzedaż na Amazon" description="Wybierz jeden domyślny rynek. Backend normalizuje maksymalnie jeden primary link.">
              <div className="grid gap-3">
                {amazonLinks.length === 0 ? <p className="text-sm text-[var(--color-muted)]">Nie dodano jeszcze rynku.</p> : null}
                {amazonLinks.map((link, index) => (
                  <AmazonEditor key={link.clientId} link={link} index={index} onChange={updateAmazon} onPrimary={setPrimaryAmazon} onRemove={removeAmazon} onUndo={() => updateAmazon(link.clientId, "removed", false)} />
                ))}
                <Button type="button" variant="outline" onClick={addAmazon} className="w-fit"><Plus className="size-4" aria-hidden />Dodaj rynek</Button>
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
                <Field label="Okładka" htmlFor="product-cover"><select id="product-cover" name="coverAssetId" defaultValue={product?.coverAssetId ?? ""} className="h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm"><option value="">Pierwszy asset cover</option>{coverOptions.map((asset) => <option key={asset.id} value={asset.id}>{asset.title || asset.filename}</option>)}</select></Field>
                <Field label="Wideo" htmlFor="product-video"><select id="product-video" name="videoAssetId" defaultValue={product?.videoAssetId ?? ""} className="h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm"><option value="">Brak / pierwsze video</option>{videoOptions.map((asset) => <option key={asset.id} value={asset.id}>{asset.title || asset.filename}</option>)}</select></Field>
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

function ProductSubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}><Save className="size-4" aria-hidden />{pending ? "Zapisywanie…" : "Zapisz"}</Button>;
}

function AssetEditor({
  asset,
  index,
  onChange,
  onRemove,
  onUndo,
}: {
  asset: AssetDraft;
  index: number;
  onChange: <K extends keyof AssetDraft>(clientId: string, field: K, value: AssetDraft[K]) => void;
  onRemove: (asset: AssetDraft) => void;
  onUndo: () => void;
}) {
  if (asset.removed) {
    return <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><span>Asset „{asset.title || asset.filename || asset.path || `#${index + 1}`}” zostanie usunięty.</span><><input type="hidden" name="assetId" value={asset.id} /><input type="hidden" name="assetKind" value={asset.kind} /><input type="hidden" name="assetPath" value={asset.path} /><input type="hidden" name="assetRemove" value={asset.id} /><Button type="button" variant="ghost" size="sm" onClick={onUndo}><Undo2 className="size-4" aria-hidden />Cofnij</Button></></div>;
  }

  const preview = asset.path && asset.kind !== "premium_download" && (asset.contentType.startsWith("image/") || /\.(png|jpe?g|gif|svg|webp)$/i.test(asset.path));
  return (
    <div className="grid min-w-0 gap-4 rounded-lg border border-[var(--color-border)] bg-white p-4">
      <input type="hidden" name="assetId" value={asset.id} />
      <div className="flex min-w-0 items-start gap-4">
        {preview ? <div role="img" aria-label={`Podgląd ${asset.title || asset.filename || "assetu"}`} className="size-16 shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] bg-cover bg-center" style={{ backgroundImage: `url("${asset.path}")` }} /> : <div className="grid size-16 shrink-0 place-items-center rounded-md border border-dashed border-[var(--color-border)] text-xs text-[var(--color-muted)]">asset</div>}
        <div className="min-w-0 flex-1"><p className="font-medium">{asset.title || asset.filename || "Nowy asset"}</p><p className="mt-1 truncate text-xs text-[var(--color-muted)]">{asset.path || "Dodaj ścieżkę lub URL"}</p><p className="mt-1 text-xs text-[var(--color-muted)]">{assetLabel(asset.kind)}</p></div>
        <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(asset)} className="shrink-0 text-red-800">Usuń</Button>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <Field label="Typ" htmlFor={`asset-kind-${asset.clientId}`}><select id={`asset-kind-${asset.clientId}`} name="assetKind" value={asset.kind} onChange={(event) => onChange(asset.clientId, "kind", event.target.value as AssetDraft["kind"])} className="h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm">{assetKinds.map((kind) => <option key={kind} value={kind}>{assetLabel(kind)}</option>)}</select></Field>
        <Field label="Ścieżka / URL" htmlFor={`asset-path-${asset.clientId}`}><Input id={`asset-path-${asset.clientId}`} name="assetPath" value={asset.path} onChange={(event) => onChange(asset.clientId, "path", event.target.value)} placeholder="/assets/gallery/page.svg" /></Field>
        <Field label="Tytuł" htmlFor={`asset-title-${asset.clientId}`}><Input id={`asset-title-${asset.clientId}`} name="assetTitle" value={asset.title} onChange={(event) => onChange(asset.clientId, "title", event.target.value)} /></Field>
        <Field label="Locale" htmlFor={`asset-locale-${asset.clientId}`}><select id={`asset-locale-${asset.clientId}`} name="assetLocale" value={asset.locale} onChange={(event) => onChange(asset.clientId, "locale", event.target.value as AssetDraft["locale"])} className="h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm"><option value="">Wszystkie</option>{routing.locales.map((code) => <option key={code} value={code}>{code.toUpperCase()}</option>)}</select></Field>
      </div>
      <AdminDisclosure className="rounded-md border border-dashed border-[var(--color-border)] p-3" summary="Zaawansowane metadane">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bucket" htmlFor={`asset-bucket-${asset.clientId}`}><Input id={`asset-bucket-${asset.clientId}`} name="assetBucket" value={asset.bucket} onChange={(event) => onChange(asset.clientId, "bucket", event.target.value)} /></Field>
          <Field label="Filename" htmlFor={`asset-filename-${asset.clientId}`}><Input id={`asset-filename-${asset.clientId}`} name="assetFilename" value={asset.filename} onChange={(event) => onChange(asset.clientId, "filename", event.target.value)} /></Field>
          <Field label="Content type" htmlFor={`asset-content-type-${asset.clientId}`}><Input id={`asset-content-type-${asset.clientId}`} name="assetContentType" value={asset.contentType} onChange={(event) => onChange(asset.clientId, "contentType", event.target.value)} placeholder="image/svg+xml" /></Field>
          <Field label="Kolejność" htmlFor={`asset-sort-${asset.clientId}`}><Input id={`asset-sort-${asset.clientId}`} name="assetSortOrder" type="number" value={asset.sortOrder} onChange={(event) => onChange(asset.clientId, "sortOrder", Number(event.target.value) || 100)} /></Field>
        </div>
      </AdminDisclosure>
    </div>
  );
}

function AmazonEditor({
  link,
  index,
  onChange,
  onPrimary,
  onRemove,
  onUndo,
}: {
  link: AmazonDraft;
  index: number;
  onChange: <K extends keyof AmazonDraft>(clientId: string, field: K, value: AmazonDraft[K]) => void;
  onPrimary: (clientId: string) => void;
  onRemove: (link: AmazonDraft) => void;
  onUndo: () => void;
}) {
  if (link.removed) {
    return <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><span>Rynek {link.market} zostanie usunięty.</span><><input type="hidden" name="amazonId" value={link.id} /><input type="hidden" name="amazonMarket" value={link.market} /><input type="hidden" name="amazonUrl" value={link.url} /><input type="hidden" name="amazonRemove" value={link.id} /><Button type="button" variant="ghost" size="sm" onClick={onUndo}><Undo2 className="size-4" aria-hidden />Cofnij</Button></></div>;
  }
  const primaryValue = link.id || `new-${index}`;
  return <div className="grid min-w-0 gap-3 rounded-lg border border-[var(--color-border)] bg-white p-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto_auto]"><input type="hidden" name="amazonId" value={link.id} /><Field label="Rynek" htmlFor={`amazon-market-${link.clientId}`}><select id={`amazon-market-${link.clientId}`} name="amazonMarket" value={link.market} onChange={(event) => onChange(link.clientId, "market", event.target.value as AmazonDraft["market"])} className="h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm"><option value="amazon.com">Amazon.com</option><option value="amazon.de">Amazon.de</option></select></Field><Field label="Link" htmlFor={`amazon-url-${link.clientId}`}><Input id={`amazon-url-${link.clientId}`} name="amazonUrl" value={link.url} onChange={(event) => onChange(link.clientId, "url", event.target.value)} placeholder="https://www.amazon.com/..." /></Field><label className="flex items-end gap-2 pb-3 text-sm"><input type="radio" name="amazonPrimary" value={primaryValue} checked={link.isPrimary} onChange={() => onPrimary(link.clientId)} /><Star className="size-4" aria-hidden />Domyślny</label><Button type="button" variant="ghost" size="sm" onClick={() => onRemove(link)} className="self-end text-red-800">Usuń</Button></div>;
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
  return (product?.assets ?? []).map((asset, index) => ({ clientId: `existing-asset-${asset.id}`, id: asset.id, kind: asset.kind, bucket: asset.bucket, path: asset.path, filename: asset.filename, contentType: asset.contentType, locale: asset.locale ?? "", title: asset.title ?? "", sortOrder: asset.sortOrder || index + 1, removed: false }));
}

function buildAmazonLinks(product?: Product): AmazonDraft[] {
  return (product?.amazonLinks ?? []).map((link) => ({ clientId: `existing-amazon-${link.id}`, id: link.id, market: link.market, url: link.url, isPrimary: link.isPrimary, removed: false }));
}

function buildPremiumCodes(product?: Product): PremiumDraft[] {
  return (product?.premiumCodes ?? []).map((code) => ({ clientId: `existing-code-${code.id}`, id: code.id, code: code.code, active: code.active, removed: false }));
}

function assetLabel(kind: ProductAsset["kind"]) {
  return { cover: "Okładka", gallery: "Galeria", video: "Wideo", public_download: "Publiczny download", premium_download: "Premium download" }[kind];
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
