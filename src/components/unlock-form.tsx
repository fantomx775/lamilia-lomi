import { CheckCircle2, LockKeyhole, MailCheck } from "lucide-react";
import Link from "next/link";

import { unlockPremiumAction, verifyDemoEmailAction } from "@/app/actions";
import { GuestUnlockActions } from "@/components/guest-unlock-actions";
import { SubmitButton } from "@/components/submit-button";
import { buttonClassName } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Locale } from "@/i18n/routing";
import type { DemoSession } from "@/lib/types";

export type UnlockCopy = {
  loginRequired: string;
  loginRequiredDescription: string;
  verificationRequired: string;
  verificationRequiredDescription: string;
  verifyDemo: string;
  codeLabel: string;
  codePlaceholder: string;
  unlock: string;
  pending: string;
  login: string;
  register: string;
  success: string;
  already: string;
  successDescription: string;
  goLibrary: string;
  errors: Record<string, string>;
};

type Props = {
  locale: Locale;
  productSlug: string;
  productId: string;
  initialCode?: string;
  session: DemoSession | null;
  error?: string;
  alreadyUnlocked?: boolean;
  copy: UnlockCopy;
};

export function UnlockForm({
  locale,
  productSlug,
  productId,
  initialCode,
  session,
  error,
  alreadyUnlocked = false,
  copy,
}: Props) {
  const redirectTo = `/${locale}/products/${productSlug}`;
  const errorMessage = error ? copy.errors[error] ?? copy.errors.unexpected : undefined;

  if (!session) {
    return (
      <div className="grid gap-4" data-testid="unlock-guest-state">
        <div className="flex gap-3 rounded-lg bg-[var(--color-blush)]/70 p-4" role="status">
          <LockKeyhole className="mt-1 size-5 shrink-0 text-[var(--color-terracotta)]" aria-hidden />
          <div>
            <p className="font-medium">{copy.loginRequired}</p>
            <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">
              {copy.loginRequiredDescription}
            </p>
          </div>
        </div>
        <GuestUnlockActions
          locale={locale}
          productSlug={productSlug}
          initialCode={initialCode}
          copy={{
            codeLabel: copy.codeLabel,
            codePlaceholder: copy.codePlaceholder,
            login: copy.login,
            register: copy.register,
            pending: copy.pending,
          }}
        />
      </div>
    );
  }

  if (!session.emailVerified) {
    return (
      <div className="grid gap-4" data-testid="unlock-verification-state">
        <div className="flex gap-3 rounded-lg bg-[var(--color-blush)]/70 p-4" role="alert">
          <MailCheck className="mt-1 size-5 shrink-0 text-[var(--color-terracotta)]" aria-hidden />
          <div>
            <p className="font-medium">{copy.verificationRequired}</p>
            <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">
              {copy.verificationRequiredDescription}
            </p>
          </div>
        </div>
        <form action={verifyDemoEmailAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="returnTo" value={redirectTo} />
          <SubmitButton pendingLabel={copy.pending}>{copy.verifyDemo}</SubmitButton>
        </form>
      </div>
    );
  }

  if (session.unlockedProductIds.includes(productId) || alreadyUnlocked) {
    return (
      <div className="grid gap-4" data-testid="unlock-success-state">
        <div className="flex gap-3 rounded-lg bg-[var(--color-sage)]/80 p-4" role="status" aria-live="polite">
          <CheckCircle2 className="mt-1 size-5 shrink-0 text-[var(--color-ink)]" aria-hidden />
          <div>
            <p className="font-medium">{alreadyUnlocked ? copy.already : copy.success}</p>
            <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">
              {copy.successDescription}
            </p>
          </div>
        </div>
        <Link className={buttonClassName({ variant: "outline" })} href={`/${locale}/library`}>
          {copy.goLibrary}
        </Link>
      </div>
    );
  }

  return (
    <form action={unlockPremiumAction} className="grid gap-4" data-testid="unlock-code-state">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="productSlug" value={productSlug} />
      <div className="grid gap-2">
        <Label htmlFor="premium-code">{copy.codeLabel}</Label>
        <Input
          id="premium-code"
          name="code"
          defaultValue={initialCode ?? ""}
          placeholder={copy.codePlaceholder}
          autoComplete="one-time-code"
          aria-describedby={errorMessage ? "premium-code-error" : undefined}
          aria-invalid={Boolean(errorMessage)}
        />
        {errorMessage ? (
          <p id="premium-code-error" className="text-sm text-[var(--color-terracotta)]" role="alert" aria-live="polite">
            {errorMessage}
          </p>
        ) : null}
      </div>
      <SubmitButton pendingLabel={copy.pending}>{copy.unlock}</SubmitButton>
    </form>
  );
}
