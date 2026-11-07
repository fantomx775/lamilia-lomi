import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getBackendMode } from "@/lib/config";
import { normalizeLocale } from "@/lib/locale";

import { requestPasswordReset, saveRecoveredPassword } from "./actions";

const messages = {
  requested: "If an account uses that email, a reset link will arrive shortly. Open it in this same browser.",
  "invalid-email": "Enter a valid email address.",
  "invalid-link": "This reset link could not be verified. Request a new link and open it in the same browser.",
  "invalid-password": "Use at least 8 characters and enter the same password twice.",
  "update-failed": "We couldn't save that password. Try a different password or request a new link.",
  complete: "Your password has been changed. You can now sign in.",
} as const;

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const locale = normalizeLocale((await params).locale);
  const { status } = await searchParams;
  const available = getBackendMode() === "supabase";
  const choosing = status === "choose-password" || status === "invalid-password" || status === "update-failed";
  const message = status && Object.hasOwn(messages, status) ? messages[status as keyof typeof messages] : null;

  return (
    <div className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-6xl place-items-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="font-serif text-3xl font-semibold">{choosing && available ? "Choose a new password" : "Reset password"}</h1>
          <p className="text-sm leading-6 text-[var(--color-muted)]">
            {!available ? "Password reset is unavailable in demo mode." :
              choosing ? "Enter and confirm your new password." :
              status !== "complete" && "Enter your email to receive a password reset link."}
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            {message && available && <p role="status" className="text-sm">{message}</p>}
            {available && status !== "complete" && (choosing ? (
              <form className="grid gap-4" action={saveRecoveredPassword.bind(null, locale)}>
                <div className="grid gap-2">
                  <Label htmlFor="password">New password</Label>
                  <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="confirmation">Confirm new password</Label>
                  <Input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
                </div>
                <Button type="submit">Save new password</Button>
                <Link className="text-sm underline" href={`/${locale}/reset-password`}>Request a new link</Link>
              </form>
            ) : (
              <form className="grid gap-4" action={requestPasswordReset.bind(null, locale)}>
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" autoComplete="email" placeholder="reader@example.com" maxLength={254} required />
                </div>
                <Button type="submit">Send reset link</Button>
              </form>
            ))}
            <Link className="text-sm underline" href={`/${locale}/login`}>Back to sign in</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
