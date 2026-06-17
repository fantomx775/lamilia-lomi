import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getContentSnapshot } from "@/lib/content-store";

export default function AdminDashboardPage() {
  const { products } = getContentSnapshot();
  const published = products.filter((product) => product.status === "published").length;

  return (
    <div>
      <p className="text-sm font-medium text-[var(--color-terracotta)]">Panel administracyjny</p>
      <h1 className="mt-2 font-serif text-4xl font-semibold">Dashboard</h1>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Metric label="Produkty opublikowane" value={published} />
        <Metric label="Kody premium" value={products.flatMap((p) => p.premiumCodes).length} />
        <Metric label="Pliki premium" value={products.flatMap((p) => p.assets).filter((a) => a.kind === "premium_download").length} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <p className="text-sm text-[var(--color-muted)]">{label}</p>
      </CardHeader>
      <CardContent>
        <p className="font-serif text-4xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
