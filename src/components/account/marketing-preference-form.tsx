"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

type Props = {
  initialConsent: boolean;
};

type SaveStatus = "idle" | "saving" | "updated" | "error";

export function MarketingPreferenceForm({ initialConsent }: Props) {
  const [savedConsent, setSavedConsent] = useState(initialConsent);
  const [marketingConsent, setMarketingConsent] = useState(initialConsent);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");

  async function savePreference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");

    try {
      const response = await fetch("/api/account/marketing-consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketingConsent }),
      });
      const result = await response.json().catch(() => null) as {
        ok?: unknown;
        marketingConsent?: unknown;
      } | null;

      if (!response.ok || result?.ok !== true || result.marketingConsent !== marketingConsent) {
        setStatus("error");
        return;
      }

      setSavedConsent(marketingConsent);
      setDirty(false);
      setStatus("updated");
    } catch {
      setStatus("error");
    }
  }

  return (
    <form onSubmit={(event) => { void savePreference(event); }} className="mt-4 grid gap-4">
      <label className="flex items-start gap-3 text-sm text-[var(--color-ink)]">
        <input
          className="mt-0.5 size-4 accent-[var(--color-terracotta)]"
          type="checkbox"
          name="marketingConsent"
          checked={marketingConsent}
          disabled={status === "saving"}
          onChange={(event) => {
            const nextConsent = event.currentTarget.checked;
            setMarketingConsent(nextConsent);
            setDirty(nextConsent !== savedConsent);
          }}
        />
        <span>I agree to receive marketing emails.</span>
      </label>
      <div>
        <Button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save preferences"}
        </Button>
      </div>
      {status === "updated" && !dirty ? (
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
