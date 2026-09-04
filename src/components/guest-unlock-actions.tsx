"use client";

import { useState } from "react";

import { startUnlockAuthAction } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";
import { buttonClassName } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Locale } from "@/i18n/routing";

type Props = {
  locale: Locale;
  productSlug: string;
  initialCode?: string;
  copy: {
    codeLabel: string;
    codePlaceholder: string;
    login: string;
    register: string;
    pending: string;
  };
};

export function GuestUnlockActions({ locale, productSlug, initialCode, copy }: Props) {
  const [code, setCode] = useState(initialCode ?? "");

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="guest-premium-code">{copy.codeLabel}</Label>
        <Input
          id="guest-premium-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={copy.codePlaceholder}
          autoComplete="one-time-code"
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <form action={startUnlockAuthAction} className="flex-1">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="productSlug" value={productSlug} />
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="mode" value="login" />
          <SubmitButton className="w-full" pendingLabel={copy.pending}>
            {copy.login}
          </SubmitButton>
        </form>
        <form action={startUnlockAuthAction} className="flex-1">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="productSlug" value={productSlug} />
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="mode" value="register" />
          <SubmitButton
            className={buttonClassName({ variant: "outline", className: "w-full" })}
            pendingLabel={copy.pending}
          >
            {copy.register}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
