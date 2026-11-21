"use client";

import { useState } from "react";

import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

export function AccountDeletionPanel({ locale }: { locale: string }) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const { showToast, resolveToast } = useToast();
  const [error, setError] = useState("");

  async function deleteAccount() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const result = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) {
        const message = result.message ?? "We could not delete your account. Try again later.";
        if (response.status === 400) setError(message);
        else showToast("error", message, { scope: "account-delete" });
        return;
      }
      resolveToast("account-delete");
      try {
        sessionStorage.setItem("lamilia-account-deleted", "1");
      } catch {
        // The identity cache must still be cleared when storage is unavailable.
      }
      // Drop the document and its client/router identity cache after deleting
      // the account; the next document reads the cleared session cookie.
      globalThis.location.replace(`/${locale}/account`);
    } catch {
      showToast("error", "We could not reach the account service. Try again.", { scope: "account-delete" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <summary className="min-h-11 cursor-pointer rounded-sm py-2 font-serif text-xl font-semibold text-[var(--color-ink-soft)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-sage-deep)]">Account management</summary>
      <section aria-labelledby="delete-account-heading" className="pt-4">
        <h2 id="delete-account-heading" className="font-serif text-lg font-semibold text-[var(--color-ink-soft)]">Delete account</h2>
        <div className="mt-3 space-y-2 text-sm leading-6 text-[var(--color-muted)]">
          <p>Deleting your account removes your login and access to product unlocks connected to this account.</p>
          <p>Any single-use code you redeemed stays consumed and cannot be reused. Shared codes remain available to other accounts after you delete your account.</p>
          <p>Your community work becomes private immediately. Physical media cleanup is queued and may take some time.</p>
        </div>
        <label htmlFor="account-deletion-confirmation" className="mt-4 block text-sm font-medium text-[var(--color-ink-soft)]">
          Type DELETE to confirm
        </label>
        <input
          id="account-deletion-confirmation"
          data-testid="account-deletion-confirmation"
          autoComplete="off"
          value={confirmation}
          onChange={(event) => setConfirmation(event.currentTarget.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "account-deletion-error" : undefined}
          className="mt-1 min-h-11 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-base text-[var(--color-ink-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-sage-deep)] sm:max-w-xs"
        />
        <Button
          data-testid="account-deletion-submit"
          variant="outline"
          className="mt-3 text-[var(--color-ink-soft)] hover:bg-[var(--color-sage)] focus-visible:outline-[var(--color-sage-deep)]"
          disabled={busy || confirmation !== "DELETE"}
          onClick={deleteAccount}
        >
          {busy ? "Deleting account…" : "Delete account permanently"}
        </Button>
        {error ? <p id="account-deletion-error" role="alert" className="mt-3 text-sm font-medium text-[var(--color-ink-soft)]">{error}</p> : null}
      </section>
    </details>
  );
}
