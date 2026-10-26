"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { CommunityHeartAccess } from "@/lib/community/types";

const reasons = [
  ["rights", "Prawa autorskie lub własność pracy"],
  ["privacy", "Dane osobowe lub prywatność"],
  ["harmful", "Treść krzywdząca lub nieodpowiednia"],
  ["other", "Inny problem"],
] as const;

export function CommunityArtworkReport({ artworkId, access, returnTo }: { artworkId: string; access: CommunityHeartAccess; returnTo: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) { setOpen(false); return; }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previousOverflow; trigger?.focus(); };
  }, [open]);

  if (access === "guest") return <div className="mt-4 border-t border-[var(--color-border)] pt-4"><p className="text-sm text-[var(--color-muted)]">Zgłoś problem z tą pracą.</p><Link data-testid="community-artwork-report-login" href={`/en/login?returnTo=${encodeURIComponent(returnTo)}`} className="mt-2 inline-flex min-h-10 items-center text-sm font-semibold underline">Zaloguj się, aby zgłosić</Link><p className="mt-1 text-xs text-[var(--color-muted)]">Bez konta możesz napisać przez <Link href="/en/contact" className="underline">formularz kontaktowy</Link>.</p></div>;
  if (access === "verify") return <p className="mt-4 border-t border-[var(--color-border)] pt-4 text-sm text-[var(--color-muted)]">Potwierdź adres e-mail, aby zgłosić tę pracę.</p>;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason || busy) return;
    busyRef.current = true;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/community/artworks/${artworkId}/report`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, ...(details.trim() ? { details: details.trim() } : {}) }),
      });
      const payload = await response.json();
      if (response.status === 201 || (response.ok && payload.ok)) {
        setMessage(payload.duplicate ? "To zgłoszenie zostało już przyjęte. Dziękujemy." : "Dziękujemy. Zgłoszenie trafiło do zespołu moderacji.");
        setOpen(false);
        return;
      }
      setMessage(payload.message || "Nie udało się wysłać zgłoszenia. Spróbuj ponownie.");
    } catch { setMessage("Nie udało się połączyć z serwerem. Spróbuj ponownie."); }
    finally { busyRef.current = false; setBusy(false); }
  };

  return <div className="mt-4 border-t border-[var(--color-border)] pt-4">
    <button ref={triggerRef} data-testid="community-artwork-report-open" type="button" onClick={() => { setMessage(""); setOpen(true); }} className="min-h-10 text-sm font-semibold underline underline-offset-2">Zgłoś tę pracę</button>
    {message && <p data-testid="community-artwork-report-message" role="status" className="mt-2 text-sm text-[var(--color-muted)]">{message}</p>}
    {open && <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="community-report-title" data-testid="community-artwork-report-dialog" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-terracotta)]">Prywatne zgłoszenie</p><h2 id="community-report-title" className="mt-1 font-serif text-2xl font-semibold">Zgłoś pracę</h2></div><button ref={closeRef} type="button" disabled={busy} onClick={() => setOpen(false)} aria-label="Zamknij formularz zgłoszenia" className="min-h-10 min-w-10 rounded-md border border-[var(--color-border)] disabled:opacity-50">×</button></div>
        <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">Zgłoszenie zobaczą wyłącznie administratorzy. Nie podawaj danych kontaktowych ani informacji o dziecku.</p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <fieldset className="grid gap-2"><legend className="mb-2 text-sm font-semibold">Dlaczego zgłaszasz tę pracę?</legend>{reasons.map(([value, label]) => <label key={value} className="flex min-h-11 items-center gap-3 rounded-lg border border-[var(--color-border)] p-3 text-sm"><input type="radio" name="community-report-reason" value={value} checked={reason === value} onChange={() => setReason(value)} required />{label}</label>)}</fieldset>
          <label className="grid gap-1.5 text-sm font-medium">Dodatkowe informacje (opcjonalnie)
            <textarea data-testid="community-artwork-report-details" value={details} onChange={(event) => setDetails(event.target.value)} maxLength={500} rows={4} aria-describedby="community-report-details-help" className="rounded-lg border border-[var(--color-border)] p-3" />
          </label>
          <p id="community-report-details-help" className="text-xs text-[var(--color-muted)]">Do 500 znaków. Administratorzy zobaczą treść zgłoszenia.</p>
          <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-[var(--color-border)] px-4 text-sm font-semibold">Anuluj</button><button data-testid="community-artwork-report-submit" type="submit" disabled={!reason || busy} className="min-h-11 rounded-lg bg-[var(--color-ink)] px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Wysyłanie…" : "Wyślij zgłoszenie"}</button></div>
        </form>
      </div>
    </div>}
  </div>;
}
