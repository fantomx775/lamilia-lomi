import { LogIn } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { loginDemoAction } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Locale } from "@/i18n/routing";
import { isUnlockRegistrationContext } from "@/lib/auth";
import { sanitizeReturnTo } from "@/lib/return-to";

type Props = {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const query = await searchParams;
  const t = await getTranslations("Auth");
  const redirectTo = sanitizeReturnTo(
    stringParam(query.returnTo) ?? stringParam(query.redirectTo),
    locale,
  );
  const code = stringParam(query.code) ?? "";
  const error = stringParam(query.error);
  const canCreateAccount = isUnlockRegistrationContext({ locale, redirectTo });

  return (
    <div className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-6xl place-items-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 grid size-11 place-items-center rounded-md bg-[var(--color-sage)]">
            <LogIn className="size-5" aria-hidden />
          </div>
          <h1 className="font-serif text-3xl font-semibold">{t("loginTitle")}</h1>
          <p className="text-sm leading-6 text-[var(--color-muted)]">
            {t("loginDescription")}
          </p>
          {error ? (
            <p className="rounded-md bg-[var(--color-blush)] p-3 text-sm" role="alert">
              {t("invalid")}
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          <form action={loginDemoAction} className="grid gap-4">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="returnTo" value={redirectTo} />
            <input type="hidden" name="code" value={code} />
            <div className="grid gap-2">
              <Label htmlFor="email">{t("email")}</Label>
              <Input id="email" name="email" type="email" defaultValue="demo@lamilialomi.test" autoComplete="email" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">{t("password")}</Label>
              <Input id="password" name="password" type="password" defaultValue="demo-password" autoComplete="current-password" />
            </div>
            <SubmitButton pendingLabel={t("pending")}>{t("continue")}</SubmitButton>
          </form>
          <div className="mt-5 flex items-center justify-between gap-3 text-sm">
            <Link className="text-[var(--color-terracotta)]" href={`/${locale}/reset-password`}>
              {t("reset")}
            </Link>
            {canCreateAccount ? (
              <Link
                className="text-[var(--color-terracotta)]"
                href={`/${locale}/register?returnTo=${encodeURIComponent(redirectTo)}`}
              >
                {t("createAccount")}
              </Link>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
