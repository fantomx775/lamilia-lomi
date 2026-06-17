import { Archive, Save, Trash2 } from "lucide-react";

import {
  archiveProductAction,
  deleteProductAction,
  saveProductAction,
} from "@/app/admin/actions";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { routing, type Locale } from "@/i18n/routing";
import type { Category, Product, ProductAsset, Tag } from "@/lib/types";
import { getTranslation } from "@/lib/products";

const assetKinds: Array<ProductAsset["kind"]> = [
  "cover",
  "gallery",
  "video",
  "public_download",
  "premium_download",
];

export function ProductEditor({
  title,
  product,
  categories,
  tags,
  feedback,
}: {
  title: string;
  product?: Product;
  categories: Category[];
  tags: Tag[];
  feedback?: string;
}) {
  const coverOptions = product?.assets.filter((asset) => asset.kind === "cover") ?? [];
  const videoOptions = product?.assets.filter((asset) => asset.kind === "video") ?? [];

  return (
    <div>
      <p className="text-sm font-medium text-[var(--color-terracotta)]">Produkty</p>
      <h1 className="mt-2 font-serif text-4xl font-semibold">{title}</h1>
      {feedback ? (
        <p className="mt-4 rounded-md border border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[var(--color-terracotta)]">
          {feedback}
        </p>
      ) : null}

      <form action={saveProductAction} className="mt-8 grid gap-6">
        <input type="hidden" name="id" value={product?.id ?? ""} />
        <input
          type="hidden"
          name="returnTo"
          value={product ? `/admin/products/${product.id}` : "/admin/products/new"}
        />

        <Card>
          <CardHeader>
            <h2 className="font-serif text-2xl font-semibold">Dane podstawowe</h2>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="Slug">
              <Input name="slug" defaultValue={product?.slug ?? ""} placeholder="moon-garden-coloring-book" />
            </Field>
            <Field label="Status">
              <select name="status" className="h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm" defaultValue={product?.status ?? "draft"}>
                <option value="draft">draft</option>
                <option value="published">published</option>
                <option value="archived">archived</option>
              </select>
            </Field>
            <Field label="Segment">
              <select name="audience" className="h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm" defaultValue={product?.audience ?? "kids"}>
                <option value="kids">kids</option>
                <option value="adults">adults</option>
              </select>
            </Field>
            <Field label="Typ produktu">
              <Input name="productType" defaultValue={product?.productType ?? "coloring-book"} />
            </Field>
            <Field label="Kolejnosc">
              <Input name="sortOrder" type="number" defaultValue={product?.sortOrder ?? 100} />
            </Field>
            <Field label="Opoznienie opinii">
              <Input name="reviewDelayDays" type="number" min={1} defaultValue={product?.reviewDelayDays ?? 14} />
            </Field>
            <Field label="Cover">
              <select name="coverAssetId" className="h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm" defaultValue={product?.coverAssetId ?? ""}>
                <option value="">Pierwszy asset typu cover</option>
                {coverOptions.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.title ?? asset.filename}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Wideo publiczne">
              <select name="videoAssetId" className="h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm" defaultValue={product?.videoAssetId ?? ""}>
                <option value="">Brak / pierwsze video</option>
                {videoOptions.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.title ?? asset.filename}
                  </option>
                ))}
              </select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-serif text-2xl font-semibold">Tlumaczenia i SEO</h2>
          </CardHeader>
          <CardContent className="grid gap-5">
            {routing.locales.map((locale) => (
              <TranslationFields key={locale} locale={locale} product={product} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-serif text-2xl font-semibold">Kategorie i tagi</h2>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <CheckboxGroup
              label="Kategorie"
              name="categoryIds"
              values={categories.map((category) => ({
                id: category.id,
                label: `${category.slug} / ${getTranslation(category.translations, "en").name}`,
              }))}
              selected={product?.categoryIds ?? []}
            />
            <CheckboxGroup
              label="Tagi"
              name="tagIds"
              values={tags.map((tag) => ({
                id: tag.id,
                label: `${tag.slug} / ${getTranslation(tag.translations, "en").name}`,
              }))}
              selected={product?.tagIds ?? []}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-serif text-2xl font-semibold">Media publiczne i premium</h2>
            <p className="text-sm leading-6 text-[var(--color-muted)]">
              Cover, galeria, video i public download sa widoczne dla guest. Premium download jest prywatny i pojawia sie dopiero po odblokowaniu produktu.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            {(product?.assets ?? []).map((asset) => (
              <AssetRow key={asset.id} asset={asset} />
            ))}
            <AssetRow newIndex={product?.assets.length ?? 0} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-serif text-2xl font-semibold">Amazon</h2>
          </CardHeader>
          <CardContent className="grid gap-4">
            {(product?.amazonLinks ?? []).map((link) => (
              <div key={link.id} className="grid gap-3 rounded-md border border-[var(--color-border)] p-3 md:grid-cols-[0.7fr_1.4fr_auto_auto]">
                <input type="hidden" name="amazonId" value={link.id} />
                <select name="amazonMarket" className="h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm" defaultValue={link.market}>
                  <option value="amazon.com">amazon.com</option>
                  <option value="amazon.de">amazon.de</option>
                </select>
                <Input name="amazonUrl" defaultValue={link.url} placeholder="https://www.amazon.com/..." />
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="amazonPrimary" value={link.id} defaultChecked={link.isPrimary} />
                  Primary
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
                  <input type="checkbox" name="amazonRemove" value={link.id} />
                  Usun
                </label>
              </div>
            ))}
            <div className="grid gap-3 rounded-md border border-dashed border-[var(--color-border)] p-3 md:grid-cols-[0.7fr_1.4fr_auto]">
              <input type="hidden" name="amazonId" value="" />
              <select name="amazonMarket" className="h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm" defaultValue="amazon.com">
                <option value="amazon.com">amazon.com</option>
                <option value="amazon.de">amazon.de</option>
              </select>
              <Input name="amazonUrl" placeholder="Nowy Amazon URL" />
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="amazonPrimary" value={`new-${product?.amazonLinks.length ?? 0}`} />
                Primary
              </label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-serif text-2xl font-semibold">Kody premium</h2>
          </CardHeader>
          <CardContent className="grid gap-4">
            {(product?.premiumCodes ?? []).map((code) => (
              <div key={code.id} className="grid gap-3 rounded-md border border-[var(--color-border)] p-3 md:grid-cols-[1fr_auto_auto]">
                <input type="hidden" name="premiumCodeId" value={code.id} />
                <Input name="premiumCode" defaultValue={code.code} placeholder="LOMI-BOOK-2026" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="premiumCodeActive" value={code.id} defaultChecked={code.active} />
                  Aktywny
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
                  <input type="checkbox" name="premiumCodeRemove" value={code.id} />
                  Usun
                </label>
              </div>
            ))}
            <div className="grid gap-3 rounded-md border border-dashed border-[var(--color-border)] p-3 md:grid-cols-[1fr_auto]">
              <input type="hidden" name="premiumCodeId" value="" />
              <Input name="premiumCode" placeholder="Nowy kod premium" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="premiumCodeActive" value={`new-${product?.premiumCodes.length ?? 0}`} defaultChecked />
                Aktywny
              </label>
            </div>
          </CardContent>
        </Card>

        <Button type="submit" className="w-fit">
          <Save className="size-4" aria-hidden />
          Zapisz
        </Button>
      </form>

      {product ? (
        <div className="mt-6 flex flex-wrap gap-3">
          <form action={archiveProductAction}>
            <input type="hidden" name="id" value={product.id} />
            <button className={buttonClassName({ variant: "outline" })} type="submit">
              <Archive className="size-4" aria-hidden />
              Archiwizuj
            </button>
          </form>
          <form action={deleteProductAction}>
            <input type="hidden" name="id" value={product.id} />
            <button className={buttonClassName({ variant: "outline", className: "text-red-700" })} type="submit">
              <Trash2 className="size-4" aria-hidden />
              Usun
            </button>
          </form>
        </div>
      ) : null}
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

function TranslationFields({ locale, product }: { locale: Locale; product?: Product }) {
  const translation = product?.translations.find((item) => item.locale === locale);

  return (
    <div className="grid gap-3 rounded-md border border-[var(--color-border)] p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {locale}
      </h3>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Tytul">
          <Input name={`title_${locale}`} defaultValue={translation?.title ?? ""} />
        </Field>
        <Field label="Krotki opis">
          <Input name={`shortDescription_${locale}`} defaultValue={translation?.shortDescription ?? ""} />
        </Field>
      </div>
      <Field label="Długi opis">
        <Textarea name={`longDescription_${locale}`} defaultValue={translation?.longDescription ?? ""} />
      </Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="SEO title">
          <Input name={`seoTitle_${locale}`} defaultValue={translation?.seoTitle ?? ""} />
        </Field>
        <Field label="SEO description">
          <Input name={`seoDescription_${locale}`} defaultValue={translation?.seoDescription ?? ""} />
        </Field>
      </div>
    </div>
  );
}

function CheckboxGroup({
  label,
  name,
  values,
  selected,
}: {
  label: string;
  name: string;
  values: Array<{ id: string; label: string }>;
  selected: string[];
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{label}</h3>
      <div className="mt-3 grid gap-2">
        {values.map((value) => (
          <label key={value.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={name}
              value={value.id}
              defaultChecked={selected.includes(value.id)}
            />
            {value.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function AssetRow({
  asset,
  newIndex,
}: {
  asset?: ProductAsset;
  newIndex?: number;
}) {
  const isPremium = asset?.kind === "premium_download";

  return (
    <div className="grid gap-3 rounded-md border border-[var(--color-border)] p-3">
      <input type="hidden" name="assetId" value={asset?.id ?? ""} />
      <div className="grid gap-3 md:grid-cols-[0.8fr_1fr_1.2fr]">
        <Field label="Typ">
          <select name="assetKind" className="h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm" defaultValue={asset?.kind ?? "gallery"}>
            {assetKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bucket">
          <Input name="assetBucket" defaultValue={asset?.bucket ?? ""} placeholder={isPremium ? "premium-files" : "public-media"} />
        </Field>
        <Field label="Path / URL">
          <Input name="assetPath" defaultValue={asset?.path ?? ""} placeholder="/assets/gallery/page.png" />
        </Field>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_0.5fr_0.5fr]">
        <Field label="Filename">
          <Input name="assetFilename" defaultValue={asset?.filename ?? ""} />
        </Field>
        <Field label="Content type">
          <Input name="assetContentType" defaultValue={asset?.contentType ?? ""} placeholder="image/png" />
        </Field>
        <Field label="Locale">
          <select name="assetLocale" className="h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm" defaultValue={asset?.locale ?? ""}>
            <option value="">all</option>
            {routing.locales.map((locale) => (
              <option key={locale} value={locale}>
                {locale}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Order">
          <Input name="assetSortOrder" type="number" defaultValue={asset?.sortOrder ?? 100} />
        </Field>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <Field label="Tytul assetu">
          <Input name="assetTitle" defaultValue={asset?.title ?? ""} placeholder={newIndex === undefined ? "" : "Nowy asset"} />
        </Field>
        {asset ? (
          <label className="flex items-end gap-2 pb-3 text-sm text-[var(--color-muted)]">
            <input type="checkbox" name="assetRemove" value={asset.id} />
            Usun
          </label>
        ) : null}
      </div>
    </div>
  );
}
