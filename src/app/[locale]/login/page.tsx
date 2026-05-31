import { LogIn } from "lucide-react";
import Link from "next/link";

import { loginDemoAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Locale } from "@/i18n/routing";

type Props = {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const query = await searchParams;
  const redirectTo = stringParam(query.redirectTo) ?? `/${locale}/library`;
  const code = stringParam(query.code) ?? "";

  return (
    <div className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-6xl place-items-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 grid size-11 place-items-center rounded-md bg-[var(--color-sage)]">
            <LogIn className="size-5" aria-hidden />
          </div>
          <h1 className="font-serif text-3xl font-semibold">Log in</h1>
          <p className="text-sm leading-6 text-[var(--color-muted)]">
            Demo users: `demo@lamilialomi.test`, `unverified@lamilialomi.test`,
            or `admin@lamilialomi.test`.
          </p>
        </CardHeader>
        <CardContent>
          <form action={loginDemoAction} className="grid gap-4">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="code" value={code} />
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" defaultValue="demo@lamilialomi.test" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" defaultValue="demo-password" />
            </div>
            <Button type="submit">Continue</Button>
          </form>
          <div className="mt-5 flex items-center justify-between text-sm">
            <Link className="text-[var(--color-terracotta)]" href={`/${locale}/reset-password`}>
              Reset password
            </Link>
            <Link className="text-[var(--color-terracotta)]" href={`/${locale}/register?redirectTo=${encodeURIComponent(redirectTo)}&code=${encodeURIComponent(code)}`}>
              Create account
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
