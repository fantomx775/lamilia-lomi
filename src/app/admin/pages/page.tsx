import { Save } from "lucide-react";

import { saveStaticPageAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { routing } from "@/i18n/routing";
import { getContentSnapshot } from "@/lib/content-store";

export default function AdminPagesPage() {
  const { staticPages } = getContentSnapshot();

  return (
    <div>
      <p className="text-sm font-medium text-[var(--color-terracotta)]">Strony</p>
      <h1 className="mt-2 font-serif text-4xl font-semibold">Privacy / Terms</h1>
      <div className="mt-8 grid gap-5">
        {(["privacy", "terms"] as const).flatMap((slug) =>
          routing.locales.map((locale) => {
            const page = staticPages.find(
              (item) => item.slug === slug && item.locale === locale,
            );

            return (
              <Card key={`${slug}-${locale}`}>
                <CardHeader>
                  <h2 className="font-serif text-2xl font-semibold">
                    {slug} / {locale}
                  </h2>
                </CardHeader>
                <CardContent>
                  <form action={saveStaticPageAction} className="grid gap-4">
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="locale" value={locale} />
                    <div className="grid gap-2">
                      <Label>Tytul</Label>
                      <Input name="title" defaultValue={page?.title ?? ""} />
                    </div>
                    <div className="grid gap-2">
                      <Label>Tresc</Label>
                      <Textarea name="body" defaultValue={page?.body ?? ""} />
                    </div>
                    <Button type="submit" className="w-fit">
                      <Save className="size-4" aria-hidden />
                      Zapisz
                    </Button>
                  </form>
                </CardContent>
              </Card>
            );
          }),
        )}
      </div>
    </div>
  );
}
