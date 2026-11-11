"use client";

import { useActionState, useState } from "react";

import { updateMarketingConsentAction } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";

type Props = {
  locale: string;
  initialConsent: boolean;
};

export function MarketingPreferenceForm({ locale, initialConsent }: Props) {
  const [state, formAction] = useActionState(updateMarketingConsentAction, {
    status: "idle" as const,
    marketingConsent: initialConsent,
  });
  const consent = state.marketingConsent ?? initialConsent;

  return (
    <PreferenceForm
      key={`${state.status}:${consent}`}
      action={formAction}
      locale={locale}
      initialConsent={consent}
      status={state.status}
    />
  );
}

function PreferenceForm({
  action,
  locale,
  initialConsent,
  status,
}: Props & {
  action: (formData: FormData) => void;
  status: "idle" | "updated" | "error";
}) {
  const [marketingConsent, setMarketingConsent] = useState(initialConsent);

  return (
    <form action={action} className="mt-4 grid gap-4">
      <input type="hidden" name="locale" value={locale} />
      <label className="flex items-start gap-3 text-sm text-[var(--color-ink)]">
        <input
          className="mt-0.5 size-4 accent-[var(--color-terracotta)]"
          type="checkbox"
          name="marketingConsent"
          checked={marketingConsent}
          onChange={(event) => setMarketingConsent(event.currentTarget.checked)}
        />
        <span>I agree to receive marketing emails.</span>
      </label>
      <div>
        <SubmitButton pendingLabel="Saving…">Save preferences</SubmitButton>
      </div>
      {status === "updated" ? (
        <p role="status" className="text-sm text-emerald-800">
          Your marketing preference has been saved.
        </p>
      ) : null}
      {status === "error" ? (
        <p role="alert" className="text-sm text-red-700">
          We could not save your preference. Please try again.
        </p>
      ) : null}
    </form>
  );
}
