import Link from "next/link";

import { registerDemoAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Locale } from "@/i18n/routing";

type Props = {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RegisterPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const query = await searchParams;
  const redirectTo = stringParam(query.redirectTo) ?? `/${locale}/library`;
  const code = stringParam(query.code) ?? "";
  const error = stringParam(query.error);

  return (
    <div className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-6xl place-items-center px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <h1 className="font-serif text-3xl font-semibold">Create account</h1>
          <p className="text-sm leading-6 text-[var(--color-muted)]">
            Terms acceptance is required. Marketing consent stays separate and
            unchecked by default.
          </p>
          {error ? (
            <p className="rounded-md bg-[var(--color-blush)] p-3 text-sm">
              Please accept terms and use a valid email/password.
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          <form action={registerDemoAction} className="grid gap-4">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="code" value={code} />
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="reader@example.com" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" placeholder="At least 8 characters" />
            </div>
            <label className="flex gap-3 text-sm leading-6">
              <input className="mt-1 size-4" type="checkbox" name="termsAccepted" />
              <span>
                I accept the{" "}
                <Link className="text-[var(--color-terracotta)]" href={`/${locale}/terms`}>
                  Terms
                </Link>{" "}
                and{" "}
                <Link className="text-[var(--color-terracotta)]" href={`/${locale}/privacy`}>
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
            <label className="flex gap-3 text-sm leading-6">
              <input className="mt-1 size-4" type="checkbox" name="marketingConsent" />
              <span>I agree to receive calm product updates and bonus news.</span>
            </label>
            <Button type="submit">Create account</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
