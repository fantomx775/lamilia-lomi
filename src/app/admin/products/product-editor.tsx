import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Product } from "@/lib/types";
import { getTranslation } from "@/lib/products";

export function ProductEditor({
  title,
  product,
}: {
  title: string;
  product?: Product;
}) {
  const en = product ? getTranslation(product.translations, "en") : null;
  const pl = product?.translations.find((translation) => translation.locale === "pl");

  return (
    <div>
      <p className="text-sm font-medium text-[var(--color-terracotta)]">Produkty</p>
      <h1 className="mt-2 font-serif text-4xl font-semibold">{title}</h1>
      <form className="mt-8 grid gap-6">
        <Card>
          <CardHeader>
            <h2 className="font-serif text-2xl font-semibold">Dane podstawowe</h2>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Slug</Label>
              <Input defaultValue={product?.slug ?? ""} placeholder="moon-garden-coloring-book" />
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <select className="h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm" defaultValue={product?.status ?? "draft"}>
                <option value="draft">draft</option>
                <option value="published">published</option>
                <option value="archived">archived</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label>Segment</Label>
              <select className="h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm" defaultValue={product?.audience ?? "kids"}>
                <option value="kids">kids</option>
                <option value="adults">adults</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label>Typ produktu</Label>
              <Input defaultValue={product?.productType ?? "coloring-book"} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="font-serif text-2xl font-semibold">Tłumaczenia EN / PL</h2>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-3">
              <Label>Tytuł EN</Label>
              <Input defaultValue={en?.title ?? ""} />
              <Label>Opis EN</Label>
              <Textarea defaultValue={en?.longDescription ?? ""} />
            </div>
            <div className="grid gap-3">
              <Label>Tytuł PL</Label>
              <Input defaultValue={pl?.title ?? ""} />
              <Label>Opis PL</Label>
              <Textarea defaultValue={pl?.longDescription ?? ""} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="font-serif text-2xl font-semibold">Amazon, media i premium</h2>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <Input placeholder="Amazon.com URL" defaultValue={product?.amazonLinks[0]?.url ?? ""} />
            <Input placeholder="Kod premium" defaultValue={product?.premiumCodes[0]?.code ?? ""} />
            <Input placeholder="Opóźnienie opinii" defaultValue={product?.reviewDelayDays ?? 14} />
          </CardContent>
        </Card>
        <Button type="button" className="w-fit">
          <Save className="size-4" aria-hidden />
          Zapisz szkic demo
        </Button>
      </form>
    </div>
  );
}
