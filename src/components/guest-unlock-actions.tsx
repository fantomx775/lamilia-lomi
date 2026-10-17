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
  return (
    <div className="grid gap-4">
      <form action={startUnlockAuthAction} className="grid gap-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="productSlug" value={productSlug} />
        <div className="grid gap-2">
          <Label htmlFor="guest-premium-code">{copy.codeLabel}</Label>
          <Input
            id="guest-premium-code"
            name="code"
            defaultValue={initialCode ?? ""}
            placeholder={copy.codePlaceholder}
            autoComplete="one-time-code"
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <SubmitButton
            className="w-full flex-1"
            name="mode"
            value="login"
            pendingLabel={copy.pending}
          >
            {copy.login}
          </SubmitButton>
          <SubmitButton
            className={buttonClassName({ variant: "outline", className: "w-full flex-1" })}
            name="mode"
            value="register"
            pendingLabel={copy.pending}
          >
            {copy.register}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
