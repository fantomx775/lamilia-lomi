import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { getStaticPage } from "@/lib/static-pages";

export default function AdminPagesPage() {
  const privacy = getStaticPage("privacy", "pl");
  const terms = getStaticPage("terms", "pl");

  return (
    <div>
      <p className="text-sm font-medium text-[var(--color-terracotta)]">Strony</p>
      <h1 className="mt-2 font-serif text-4xl font-semibold">Privacy / Terms</h1>
      <div className="mt-8 grid gap-5">
        {[privacy, terms].map((page) => (
          <Card key={page.title}>
            <CardHeader>
              <h2 className="font-serif text-2xl font-semibold">{page.title}</h2>
            </CardHeader>
            <CardContent>
              <Textarea defaultValue={page.body} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
