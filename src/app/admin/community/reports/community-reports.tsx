"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { CommunityAdminReport, CommunityReportPage, CommunityReportStatus } from "@/lib/community/types";

const statuses: Array<CommunityReportStatus | "all"> = ["open", "reviewed", "resolved", "dismissed", "all"];
const statusLabels: Record<CommunityReportStatus | "all", string> = { open: "Nowe", reviewed: "Sprawdzone", resolved: "Rozwiązane", dismissed: "Odrzucone", all: "Wszystkie" };
const reasonLabels = { rights: "Prawa autorskie", privacy: "Prywatność lub dane osobowe", harmful: "Krzywdząca treść", other: "Inne" };

export default function CommunityReports() {
  const [status, setStatus] = useState<CommunityReportStatus | "all">("open");
  const [page, setPage] = useState<CommunityReportPage>({ items: [], nextCursor: null, counts: { open: 0, reviewed: 0, resolved: 0, dismissed: 0 } });
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (nextCursor: string | null = null) => {
    setLoading(true); setError("");
    const params = new URLSearchParams({ status, limit: "30" });
    if (nextCursor) params.set("cursor", nextCursor);
    try {
      const response = await fetch(`/api/admin/community/reports?${params}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Nie udało się wczytać zgłoszeń.");
      setPage(payload as CommunityReportPage);
      setCursor(nextCursor);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nie udało się wczytać zgłoszeń."); }
    finally { setLoading(false); }
  }, [status]);

  useEffect(() => { void Promise.resolve().then(() => load(null)); }, [load]);

  const decide = async (report: CommunityAdminReport, action: "reviewed" | "resolve" | "dismiss") => {
    setBusyId(report.id); setError("");
    try {
      const response = await fetch(`/api/admin/community/reports/${report.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, revision: report.revision }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(response.status === 409 ? "Inny administrator zmienił to zgłoszenie. Odśwież listę." : payload.message || "Nie udało się zapisać decyzji.");
      await load(cursor);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nie udało się zapisać decyzji."); }
    finally { setBusyId(null); }
  };

  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Liczba zgłoszeń">
      {statuses.filter((item): item is CommunityReportStatus => item !== "all").map((item) => <button key={item} type="button" data-testid={`community-report-count-${item}`} onClick={() => setStatus(item)} className={`rounded-xl border p-3 text-left ${status === item ? "border-[var(--color-ink)] bg-[var(--color-blush)]" : "border-[var(--color-border)] bg-white"}`}><span className="block text-xs text-[var(--color-muted)]">{statusLabels[item]}</span><span className="text-xl font-semibold tabular-nums">{page.counts[item]}</span></button>)}
    </div>
    <label className="grid max-w-sm gap-1.5 text-sm font-medium">Filtruj zgłoszenia
      <select data-testid="community-report-status-filter" value={status} onChange={(event) => setStatus(event.target.value as CommunityReportStatus | "all")} className="min-h-11 rounded-xl border border-[var(--color-border)] bg-white px-3">
        {statuses.map((item) => <option key={item} value={item}>{statusLabels[item]}</option>)}
      </select>
    </label>
    {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error} <button type="button" className="font-semibold underline" onClick={() => void load(cursor)}>Odśwież</button></p>}
    {loading ? <p role="status" className="p-4 text-sm text-[var(--color-muted)]">Wczytywanie zgłoszeń…</p> : page.items.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--color-border)] bg-white p-6 text-sm text-[var(--color-muted)]">Brak zgłoszeń w tej kolejce.</p> : <ul className="grid gap-4 lg:grid-cols-2">
      {page.items.map((report) => <li key={report.id} data-testid="community-report-item" className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white">
        <div className="grid gap-4 p-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
          <div className="aspect-square overflow-hidden rounded-xl bg-[var(--color-bg-alt)]">
            {/* This endpoint rechecks current admin role and media state on every request. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/community/artworks/${report.artworkId}/media`} alt="" aria-hidden="true" className="size-full object-contain" />
          </div>
          <div className="min-w-0 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-terracotta)]">{reasonLabels[report.reason]} · {statusLabels[report.status]}{report.overdue ? " · wymaga pilnego przeglądu" : ""}</p>
            <h2 className="break-words font-serif text-xl font-semibold">{report.creatorUsername ? `@${report.creatorUsername}` : "Twórca niedostępny"}</h2>
            <p className="text-sm">{report.product.title}</p>
            <p className="break-words text-sm text-[var(--color-muted)]">{report.description || "Praca bez opisu"}</p>
            {report.details ? <p className="whitespace-pre-wrap break-words rounded-lg bg-[var(--color-bg)] p-3 text-sm">{report.details}</p> : <p className="text-xs text-[var(--color-muted)]">Brak dodatkowych informacji lub usunięto je zgodnie z zasadami przechowywania zgłoszeń.</p>}
            <p className="text-xs text-[var(--color-muted)]">Zgłoszono {new Intl.DateTimeFormat("pl", { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.createdAt))} · zgłaszający: konto zalogowane</p>
            {report.creatorUsername && <Link href={`/admin/community?status=approved&creator=${encodeURIComponent(report.creatorUsername)}`} className="inline-flex min-h-10 items-center text-sm font-semibold underline">Otwórz moderację prac twórcy</Link>}
            <div className="flex flex-wrap gap-2">
              {report.status === "open" && <button type="button" data-testid="community-report-reviewed" disabled={busyId === report.id} onClick={() => void decide(report, "reviewed")} className="min-h-10 rounded-lg border border-[var(--color-border)] px-3 text-sm font-semibold disabled:opacity-50">Oznacz jako sprawdzone</button>}
              {!(["resolved", "dismissed"] as CommunityReportStatus[]).includes(report.status) && <><button type="button" data-testid="community-report-resolve" disabled={busyId === report.id} onClick={() => void decide(report, "resolve")} className="min-h-10 rounded-lg bg-[var(--color-ink)] px-3 text-sm font-semibold text-white disabled:opacity-50">Rozwiąż</button><button type="button" data-testid="community-report-dismiss" disabled={busyId === report.id} onClick={() => void decide(report, "dismiss")} className="min-h-10 rounded-lg border border-[var(--color-border)] px-3 text-sm font-semibold disabled:opacity-50">Odrzuć zgłoszenie</button></>}
            </div>
          </div>
        </div>
      </li>)}
    </ul>}
    {page.nextCursor && <button data-testid="community-report-next-page" type="button" disabled={loading} onClick={() => void load(page.nextCursor)} className="min-h-11 rounded-xl border border-[var(--color-border)] px-4 text-sm font-semibold disabled:opacity-50">Następne zgłoszenia</button>}
  </div>;
}
