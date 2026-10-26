"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

export function AccountDeletionPanel({ locale }: { locale: string }) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function deleteAccount() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const result = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) {
        setError(result.message ?? "We could not delete your account. Try again later.");
        return;
      }
      setMessage(result.message ?? "Your account was deleted.");
      // Drop the document and its client/router identity cache after deleting
      // the account; the next document reads the cleared session cookie.
      globalThis.location.replace(`/${locale}/account`);
    } catch {
      setError("We could not reach the account service. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="delete-account-heading" className="rounded-lg border border-red-200 bg-red-50/50 p-5">
      <h2 id="delete-account-heading" className="font-serif text-2xl font-semibold text-red-950">Delete account</h2>
      <div className="mt-3 space-y-2 text-sm leading-6 text-red-950/90">
        <p>Deleting your account removes your login and access to product unlocks connected to this account.</p>
        <p>Premium codes already redeemed are single-use and stay consumed; they cannot be reused.</p>
        <p>Your community work becomes private immediately. Physical media cleanup is queued and may take some time.</p>
      </div>
      <label htmlFor="account-deletion-confirmation" className="mt-4 block text-sm font-medium text-red-950">
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
        className="mt-1 w-full rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-[var(--color-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 sm:max-w-xs"
      />
      <Button
        data-testid="account-deletion-submit"
        variant="outline"
        className="mt-3 border-red-300 text-red-900 hover:bg-red-100"
        disabled={busy || confirmation !== "DELETE"}
        onClick={deleteAccount}
      >
        {busy ? "Deleting account…" : "Delete account permanently"}
      </Button>
      {error ? <p id="account-deletion-error" role="alert" className="mt-3 text-sm text-red-800">{error}</p> : null}
      {message ? <p role="status" className="mt-3 text-sm text-green-800">{message}</p> : null}
    </section>
  );
}
