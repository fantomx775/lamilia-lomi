import { CheckCircle2, LockKeyhole, MailCheck } from "lucide-react";
import Link from "next/link";

import { unlockPremiumAction, verifyDemoEmailAction } from "@/app/actions";
import { buttonClassName, Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Locale } from "@/i18n/routing";
import type { DemoSession } from "@/lib/types";

type Props = {
  locale: Locale;
  productSlug: string;
  productId: string;
  initialCode?: string;
  session: DemoSession | null;
};

export function UnlockForm({
  locale,
  productSlug,
  productId,
  initialCode,
  session,
}: Props) {
  const redirectTo = `/${locale}/products/${productSlug}`;

  if (!session) {
    return (
      <div className="grid gap-4">
        <div className="flex gap-3 rounded-lg bg-[var(--color-blush)]/70 p-4">
          <LockKeyhole className="mt-1 size-5 shrink-0 text-[var(--color-terracotta)]" />
          <div>
            <p className="font-medium">Log in to unlock premium content</p>
            <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">
              The QR code is preserved through auth, so you can come right back
              to this product.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            className={buttonClassName()}
            href={`/${locale}/login?redirectTo=${encodeURIComponent(redirectTo)}&code=${encodeURIComponent(initialCode ?? "")}`}
          >
            Log in
          </Link>
          <Link
            className={buttonClassName({ variant: "outline" })}
            href={`/${locale}/register?redirectTo=${encodeURIComponent(redirectTo)}&code=${encodeURIComponent(initialCode ?? "")}`}
          >
            Create account
          </Link>
        </div>
      </div>
    );
  }

  if (!session.emailVerified) {
    return (
      <div className="grid gap-4">
        <div className="flex gap-3 rounded-lg bg-[var(--color-blush)]/70 p-4">
          <MailCheck className="mt-1 size-5 shrink-0 text-[var(--color-terracotta)]" />
          <div>
            <p className="font-medium">Email verification required</p>
            <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">
              Premium downloads open after email verification. Demo mode lets you
              simulate that step locally.
            </p>
          </div>
        </div>
        <form action={verifyDemoEmailAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="redirectTo" value={`${redirectTo}?code=${initialCode ?? ""}`} />
          <Button type="submit">Mark demo email as verified</Button>
        </form>
      </div>
    );
  }

  if (session.unlockedProductIds.includes(productId)) {
    return (
      <div className="flex gap-3 rounded-lg bg-[var(--color-sage)]/80 p-4">
        <CheckCircle2 className="mt-1 size-5 shrink-0 text-[var(--color-ink)]" />
        <div>
          <p className="font-medium">Premium content is unlocked</p>
          <p className="mt-1 text-sm leading-6 text-[var(--color-muted)]">
            Your library keeps this product available for later downloads.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form action={unlockPremiumAction} className="grid gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="productSlug" value={productSlug} />
      <div className="grid gap-2">
        <Label htmlFor="premium-code">Premium code</Label>
        <Input
          id="premium-code"
          name="code"
          defaultValue={initialCode ?? ""}
          placeholder="LOMI-BOOK-2026"
          autoComplete="one-time-code"
        />
      </div>
      <Button type="submit">Unlock premium content</Button>
    </form>
  );
}
