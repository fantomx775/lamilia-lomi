import { LogIn } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { loginDemoAction, resendSupabaseVerificationEmailAction } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Locale } from "@/i18n/routing";
import { getBackendMode } from "@/lib/config";
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
  const requestedReturnTo = stringParam(query.returnTo) ?? stringParam(query.redirectTo);
  const safeRequestedReturnTo = requestedReturnTo
    ? sanitizeReturnTo(requestedReturnTo, locale, "")
    : undefined;
  const redirectTo = safeRequestedReturnTo || sanitizeReturnTo(undefined, locale);
  const unlockIntent = await getUnlockIntent();
  const isDemo = getBackendMode() === "local";
  const code =
    unlockIntent &&
    unlockIntent.locale === locale &&
    unlockIntent.productSlug === productSlugFromReturnTo(redirectTo, locale)
      ? unlockIntent.code ?? ""
      : "";
  const error = stringParam(query.error);
  const verificationMessage = getLoginErrorMessage(error, t, isDemo);
  const canCreateAccount = Boolean(safeRequestedReturnTo);
  const canResendVerification =
    !isDemo &&
    (error === "email_unverified" ||
      error === "verification_required" ||
      error === "verification_sent" ||
      error === "verification_unavailable" ||
      error === "verification_failed" ||
      error === "verification_mismatch");

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
            <p id="login-error" className="rounded-md bg-[var(--color-blush)] p-3 text-sm" role="alert">
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
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={isDemo ? "demo@lamilialomi.test" : undefined}
                autoComplete="email"
                required
                aria-invalid={error === "invalid_input" || error === "invalid_credentials"}
                aria-describedby={verificationMessage ? "login-error" : undefined}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">{t("password")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                defaultValue={isDemo ? "demo-password" : undefined}
                autoComplete="current-password"
                required
                aria-invalid={error === "invalid_input" || error === "invalid_credentials"}
                aria-describedby={verificationMessage ? "login-error" : undefined}
              />
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
              <SubmitButton pendingLabel={t("resendPending")}>{t("resendVerification")}</SubmitButton>
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

function getLoginErrorMessage(
  error: string | undefined,
  t: Awaited<ReturnType<typeof getTranslations>>,
  isDemo: boolean,
) {
  if (!error) {
    return null;
  }

  switch (error) {
    case "email_unverified":
      return t("emailNotConfirmed");
    case "verification_sent":
      return t("verificationSent");
    case "verification_required":
      return isDemo ? t("demoVerification") : t("verificationRequired");
    case "verification_unavailable":
      return t("verificationUnavailable");
    case "verification_mismatch":
      return t("verificationMismatch");
    case "verification_failed":
      return t("verificationFailed");
    case "invalid_input":
      return t("invalidInput");
    case "invalid_credentials":
      return t("invalidCredentials");
    default:
      return t("invalidCredentials");
  }
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
