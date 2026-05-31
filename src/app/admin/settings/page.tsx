import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AdminSettingsPage() {
  return (
    <div>
      <p className="text-sm font-medium text-[var(--color-terracotta)]">Ustawienia</p>
      <h1 className="mt-2 font-serif text-4xl font-semibold">Konfiguracja</h1>
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
