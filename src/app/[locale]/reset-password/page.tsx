import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPasswordPage() {
  return (
    <div className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-6xl place-items-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="font-serif text-3xl font-semibold">Reset password</h1>
          <p className="text-sm leading-6 text-[var(--color-muted)]">
            Production sends this through Supabase Auth. Demo mode keeps the
            screen available without external secrets.
          </p>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="reader@example.com" />
            </div>
            <Button type="button">Send reset link</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
