import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { registerDemoAction } from "@/app/actions";
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

export default async function RegisterPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const query = await searchParams;
  const t = await getTranslations("Auth");
  const redirectTo = sanitizeReturnTo(
    stringParam(query.returnTo) ?? stringParam(query.redirectTo),
    locale,
  );
  const unlockIntent = await getUnlockIntent();
  const productSlug = productSlugFromReturnTo(redirectTo, locale);
  const code =
    unlockIntent && unlockIntent.productSlug === productSlug
      ? unlockIntent.code ?? ""
      : "";
  const error = stringParam(query.error);

  if (!isUnlockRegistrationContext({ locale, redirectTo })) {
    redirect(`/${locale}/products`);
  }

  return (
    <div className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-6xl place-items-center px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <h1 className="font-serif text-3xl font-semibold">{t("registerTitle")}</h1>
          <p className="text-sm leading-6 text-[var(--color-muted)]">
            {t("registerDescription")}
          </p>
          {error ? (
            <p className="rounded-md bg-[var(--color-blush)] p-3 text-sm" role="alert">
              {t("invalid")}
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          <form action={registerDemoAction} className="grid gap-4">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="returnTo" value={redirectTo} />
            <input type="hidden" name="code" value={code} />
            <div className="grid gap-2">
              <Label htmlFor="email">{t("email")}</Label>
              <Input id="email" name="email" type="email" placeholder="reader@example.com" autoComplete="email" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">{t("password")}</Label>
              <Input id="password" name="password" type="password" placeholder="At least 8 characters" autoComplete="new-password" required />
            </div>
            <label className="flex gap-3 text-sm leading-6">
              <input className="mt-1 size-4" type="checkbox" name="termsAccepted" required />
              <span>
                {t("terms")} {" "}
                <Link className="text-[var(--color-terracotta)]" href={`/${locale}/terms`}>
                  {t("termsLink")}
                </Link>{" "}
                <Link className="text-[var(--color-terracotta)]" href={`/${locale}/privacy`}>
                  {t("privacyLink")}
                </Link>
              </span>
            </label>
            <label className="flex gap-3 text-sm leading-6">
              <input className="mt-1 size-4" type="checkbox" name="marketingConsent" />
              <span>{t("marketing")}</span>
            </label>
            <SubmitButton pendingLabel={t("registerPending")}>
              {t("createAccountButton")}
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
