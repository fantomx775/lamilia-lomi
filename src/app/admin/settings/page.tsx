import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { getCatalogSettingsForRequest } from "@/lib/content-repository";

import { saveCatalogSettingsAction } from "../actions";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminSettingsPage({ searchParams }: Props) {
  const [catalogSettings, query] = await Promise.all([
    getCatalogSettingsForRequest(),
    searchParams,
  ]);
  const saved = query.saved === "1";
  const hasSaveError = query.error !== undefined;

  return (
    <div>
      <p className="text-sm font-medium text-[var(--color-terracotta)]">Ustawienia</p>
      <h1 className="mt-2 font-serif text-4xl font-semibold">Konfiguracja</h1>
      <Card className="mt-8">
        <CardHeader>
          <h2 className="font-serif text-2xl font-semibold">Katalog</h2>
          <p className="text-sm text-[var(--color-muted)]">
            Ustaw liczbę kart w wierszu na dużych ekranach. Tablet pokazuje
            dwie karty, a telefon jedną.
          </p>
        </CardHeader>
        <CardContent>
          <form action={saveCatalogSettingsAction} className="grid max-w-xl gap-4">
            <div className="grid gap-2">
              <Label htmlFor="desktopColumns">
                Karty w wierszu na dużych ekranach
              </Label>
              <select
                id="desktopColumns"
                name="desktopColumns"
                defaultValue={String(catalogSettings.desktopColumns)}
                aria-describedby="catalog-columns-help"
                className="h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm"
              >
                <option value="3">3 karty</option>
                <option value="4">4 karty</option>
                <option value="5">5 kart</option>
              </select>
              <p id="catalog-columns-help" className="text-sm text-[var(--color-muted)]">
                Wartość dotyczy ekranów o szerokości co najmniej 1280 pikseli.
              </p>
            </div>
            <Button type="submit" className="w-fit">
              Zapisz ustawienia katalogu
            </Button>
          </form>
          {saved ? (
            <p role="status" className="mt-4 text-sm text-[var(--color-sage-foreground)]">
              Ustawienia katalogu zostały zapisane.
            </p>
          ) : null}
          {hasSaveError ? (
            <p role="alert" className="mt-4 text-sm text-[var(--color-terracotta)]">
              Nie udało się zapisać ustawień. Wybierz 3, 4 albo 5 kart i spróbuj ponownie.
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card className="mt-8">
        <CardHeader>
          <h2 className="font-serif text-2xl font-semibold">Integracje</h2>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label>Resend status</Label>
            <Input readOnly value={process.env.RESEND_API_KEY ? "configured" : "stub mode"} />
          </div>
          <div className="grid gap-2">
            <Label>GA4</Label>
            <Input readOnly value={process.env.NEXT_PUBLIC_GA4_ID ? "configured" : "not configured"} />
          </div>
          <div className="grid gap-2">
            <Label>Supabase</Label>
            <Input readOnly value={process.env.NEXT_PUBLIC_SUPABASE_URL ? "configured" : "demo mode"} />
          </div>
          <div className="grid gap-2">
            <Label>Cron</Label>
            <Input readOnly value={process.env.CRON_SECRET ? "protected" : "local stub"} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
