import { LogIn } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { loginDemoAction, resendSupabaseVerificationEmailAction } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Locale } from "@/i18n/routing";
import { isUnlockRegistrationContext } from "@/lib/auth";
import { productSlugFromReturnTo, sanitizeReturnTo } from "@/lib/return-to";
import { getUnlockIntent } from "@/lib/unlock-intent";

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
  const unlockIntent = await getUnlockIntent();
  const code =
    unlockIntent && unlockIntent.productSlug === productSlugFromReturnTo(redirectTo, locale)
      ? unlockIntent.code ?? ""
      : "";
  const error = stringParam(query.error);
  const canCreateAccount = isUnlockRegistrationContext({ locale, redirectTo });
  const verificationMessage =
    error === "email_unverified"
      ? t("emailNotConfirmed")
      : error === "verification_sent" || error === "verification_unavailable"
        ? t("verificationSent")
        : error
          ? t("invalid")
          : null;
  const canResendVerification =
    error === "email_unverified" ||
    error === "verification_sent" ||
    error === "verification_unavailable";

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
          {verificationMessage ? (
            <p className="rounded-md bg-[var(--color-blush)] p-3 text-sm" role="alert">
              {verificationMessage}
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
          {canResendVerification ? (
            <form action={resendSupabaseVerificationEmailAction} className="mt-6 grid gap-3 border-t border-[var(--color-border)] pt-5">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="returnTo" value={redirectTo} />
              <input type="hidden" name="code" value={code} />
              <Label htmlFor="verification-email">{t("email")}</Label>
              <Input id="verification-email" name="email" type="email" autoComplete="email" required />
              <SubmitButton pendingLabel={t("pending")}>{t("resendVerification")}</SubmitButton>
            </form>
          ) : null}
          <div className="mt-5 flex items-center justify-between gap-3 text-sm">
            <Link className="text-[var(--color-terracotta)]" href={`/${locale}/reset-password`}>
              {t("reset")}
            </Link>
            <span>
              {t("noAccount")} {" "}
              <Link
                className="text-[var(--color-terracotta)]"
                href={
                  canCreateAccount
                    ? `/${locale}/register?returnTo=${encodeURIComponent(redirectTo)}`
                    : `/${locale}/register`
                }
              >
                {t("createAccount")}
              </Link>
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
