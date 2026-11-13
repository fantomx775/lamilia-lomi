"use client";

import { useState, type FormEvent } from "react";

import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

type Props = {
  initialConsent: boolean;
};

type SaveStatus = "idle" | "saving";

export function MarketingPreferenceForm({ initialConsent }: Props) {
  const [marketingConsent, setMarketingConsent] = useState(initialConsent);
  const { showToast } = useToast();
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
        throw new Error("Preference not saved");
      }

      showToast("success", "Your marketing preference has been saved.");
    } catch {
      showToast("error", "We could not save your preference. Please try again.");
    } finally {
      setStatus("idle");
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
          onChange={(event) => setMarketingConsent(event.currentTarget.checked)}
        />
        <span>I agree to receive marketing emails.</span>
      </label>
      <div>
        <Button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </form>
  );
}
