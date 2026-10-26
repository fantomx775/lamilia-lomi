"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CommunityAdminArtwork, CommunityArtworkStatus, CommunityModerationAction, CommunityModerationCounts, CommunityModerationHistoryItem } from "@/lib/community/types";

type ProductOption = { id: string; title: string };
type QueueResponse = { items: CommunityAdminArtwork[]; nextCursor: string | null; counts: CommunityModerationCounts };
type DetailResponse = { artwork: CommunityAdminArtwork; history: CommunityModerationHistoryItem[] };
type StatusFilter = CommunityArtworkStatus | "all";

const labels: Record<StatusFilter, string> = { pending: "Do sprawdzenia", approved: "Opublikowane", rejected: "Odrzucone", removed: "Usunięte", all: "Wszystkie" };
const actionLabels: Record<CommunityModerationAction, string> = { approve: "Zatwierdź i opublikuj", reject: "Odrzuć", remove: "Usuń z galerii", restore: "Przywróć do sprawdzenia" };
const statusOrder: CommunityArtworkStatus[] = ["pending", "approved", "rejected", "removed"];

export default function CommunityModeration({ products }: { products: ProductOption[] }) {
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [productId, setProductId] = useState("");
  const [creatorInput, setCreatorInput] = useState("");
  const [creator, setCreator] = useState("");
  const [queue, setQueue] = useState<QueueResponse>({ items: [], nextCursor: null, counts: { pending: 0, approved: 0, rejected: 0, removed: 0 } });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<CommunityModerationAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const queueRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  const listUrl = useMemo(() => {
    const params = new URLSearchParams({ status, limit: "30" });
    if (productId) params.set("productId", productId);
    if (creator) params.set("creator", creator);
    if (cursor) params.set("cursor", cursor);
    return `/api/admin/community/artworks?${params}`;
  }, [status, productId, creator, cursor]);

  const loadQueue = useCallback(async (url = listUrl) => {
    const requestId = ++queueRequestRef.current;
    try {
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || "Nie udało się wczytać kolejki.");
      if (requestId !== queueRequestRef.current) return null;
      setQueue({ items: payload.items, nextCursor: payload.nextCursor, counts: payload.counts });
      setSelectedId((current) => current && payload.items.some((item: CommunityAdminArtwork) => item.id === current) ? current : payload.items[0]?.id ?? null);
      setPendingAction(null); setReason(""); setReasonError("");
      return payload.items as CommunityAdminArtwork[];
    } catch (caught) {
      if (requestId === queueRequestRef.current) setError(caught instanceof Error ? caught.message : "Nie udało się wczytać kolejki.");
      return null;
    } finally { if (requestId === queueRequestRef.current) setLoading(false); }
  }, [listUrl]);

  useEffect(() => { void Promise.resolve().then(() => loadQueue()); }, [loadQueue]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    const requestId = ++detailRequestRef.current;
    const controller = new AbortController();
    fetch(`/api/admin/community/artworks/${selectedId}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.message || "Nie udało się wczytać szczegółów.");
        if (active && requestId === detailRequestRef.current) setDetail({ artwork: payload.artwork, history: payload.history });
      })
      .catch((caught) => { if (active && requestId === detailRequestRef.current && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Nie udało się wczytać szczegółów."); });
    return () => { active = false; controller.abort(); };
  }, [selectedId, detailRefreshToken]);

  const runAction = async () => {
    if (!detail || !pendingAction || busy) return;
    const trimmed = reason.trim();
    if ((pendingAction === "reject" || pendingAction === "remove") && (trimmed.length < 1 || trimmed.length > 500)) {
      setReasonError("Wpisz powód (maksymalnie 500 znaków).");
      return;
    }
    setBusy(true); setError(""); setReasonError("");
    try {
      const response = await fetch(`/api/admin/community/artworks/${detail.artwork.id}/moderation`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: pendingAction, revision: detail.artwork.revision, ...((pendingAction === "reject" || pendingAction === "remove") ? { reason: trimmed } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        if (response.status === 409) setError("Praca została zmieniona przez innego administratora. Odśwież kolejkę przed kolejną decyzją.");
        else setError(payload.message || "Nie udało się zapisać decyzji.");
        return;
      }
      setDetail({ artwork: payload.artwork, history: payload.history });
      setPendingAction(null); setReason("");
      await loadQueue();
    } catch {
      setError("Nie udało się połączyć z serwerem. Odśwież dane i spróbuj ponownie.");
    } finally { setBusy(false); }
  };

  const startAction = (action: CommunityModerationAction) => {
    setPendingAction(action); setReason(""); setReasonError("");
  };
  const submitFilters = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true); setError("");
    setCursor(null);
    setPreviousCursors([]);
    setCreator(creatorInput.trim().replace(/^@/, "").toLowerCase());
  };
  const refreshQueueAndDetail = async () => {
    setLoading(true); setError("");
    const items = await loadQueue();
    if (items && selectedId && items.some((item) => item.id === selectedId)) {
      setDetailRefreshToken((token) => token + 1);
    }
  };
  const visibleDetail = detail?.artwork.id === selectedId ? detail : null;
  const current = visibleDetail?.artwork;
  const allowedActions: CommunityModerationAction[] = current?.status === "pending" ? ["approve", "reject"]
    : current?.status === "approved" ? ["remove"] : current?.status === "removed" ? ["restore"] : [];

  return <section data-testid="community-moderation-page" className="space-y-6 p-4 sm:p-6">
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-muted)]">Panel administracyjny</p>
      <h1 className="font-serif text-3xl font-semibold text-[var(--color-ink)]">Moderacja prac</h1>
      <p className="max-w-3xl text-sm leading-6 text-[var(--color-muted)]">Sprawdzaj zgłoszenia, podejmuj decyzje i przeglądaj historię. Zmiany są zapisywane od razu.</p>
    </header>

    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Liczba prac według statusu">
      {statusOrder.map((key) => <button key={key} type="button" data-testid={`community-count-${key}`} disabled={busy} onClick={() => { setLoading(true); setError(""); setStatus(key); setCursor(null); setPreviousCursors([]); }} className={`rounded-2xl border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${status === key ? "border-[var(--color-ink)] bg-[var(--color-blush)]" : "border-[var(--color-border)] bg-white"}`}>
        <span className="block text-xs text-[var(--color-muted)]">{labels[key]}</span><span className="mt-1 block text-2xl font-semibold tabular-nums">{queue.counts[key]}</span>
      </button>)}
    </div>

    <form onSubmit={submitFilters} className="grid gap-3 rounded-2xl border border-[var(--color-border)] bg-white p-4 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
      <label className="grid gap-1.5 text-sm font-medium">Status
        <select data-testid="community-moderation-status-filter" value={status} disabled={busy} onChange={(event) => { setLoading(true); setError(""); setStatus(event.target.value as StatusFilter); setCursor(null); setPreviousCursors([]); }} className="min-h-11 rounded-xl border border-[var(--color-border)] bg-white px-3 disabled:opacity-50">
          {[...statusOrder, "all" as const].map((value) => <option key={value} value={value}>{labels[value]}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm font-medium">Książka
        <select data-testid="community-moderation-product-filter" value={productId} disabled={busy} onChange={(event) => { setLoading(true); setError(""); setProductId(event.target.value); setCursor(null); setPreviousCursors([]); }} className="min-h-11 min-w-0 rounded-xl border border-[var(--color-border)] bg-white px-3 disabled:opacity-50">
          <option value="">Wszystkie książki</option>{products.map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm font-medium">Nazwa twórcy
        <input data-testid="community-moderation-author-filter" value={creatorInput} onChange={(event) => setCreatorInput(event.target.value)} disabled={busy} maxLength={25} placeholder="@nazwa" className="min-h-11 rounded-xl border border-[var(--color-border)] px-3 disabled:opacity-50" />
      </label>
      <button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-[var(--color-ink)] px-5 text-sm font-semibold text-white disabled:opacity-50">Filtruj</button>
    </form>

    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900"><span>{error}</span><button type="button" onClick={() => void refreshQueueAndDetail()} className="font-semibold underline">Odśwież</button></div>}

    <div className="grid gap-5 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.5fr)]">
      <section data-testid="community-moderation-queue" aria-label="Kolejka prac" className="min-w-0 rounded-2xl border border-[var(--color-border)] bg-white p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-serif text-xl font-semibold">{labels[status]}</h2><span className="text-sm text-[var(--color-muted)]">{queue.items.length}</span></div>
        {loading ? <p role="status" className="p-4 text-sm text-[var(--color-muted)]">Wczytywanie prac…</p>
          : queue.items.length === 0 ? <p className="rounded-xl bg-[var(--color-bg)] p-5 text-sm leading-6 text-[var(--color-muted)]">Brak prac w tej kolejce. Zmień filtry, aby sprawdzić inne zgłoszenia.</p>
            : <ul className="flex gap-2 overflow-x-auto pb-2 lg:grid lg:overflow-visible">
              {queue.items.map((item) => <li key={item.id} className="min-w-[13rem] flex-1 lg:min-w-0">
                <button data-testid="community-moderation-item" type="button" aria-pressed={selectedId === item.id} disabled={busy} onClick={() => { if (selectedId !== item.id) { setSelectedId(item.id); setDetail(null); } setPendingAction(null); setReason(""); setReasonError(""); }} className={`flex w-full gap-3 rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-60 ${selectedId === item.id ? "border-[var(--color-ink)] bg-[var(--color-blush)]" : "border-[var(--color-border)] hover:bg-[var(--color-bg)]"}`}>
                  <span className="size-16 shrink-0 overflow-hidden rounded-lg bg-[var(--color-bg)]">
                    {/* Private media is served through the live status-checked endpoint. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/community/artworks/${item.id}/media`} alt="" aria-hidden="true" className="size-full object-cover" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{item.creatorUsername ? `@${item.creatorUsername}` : "Twórca niedostępny"}</span>
                    <span className="mt-1 block truncate text-sm">{item.product.title}</span>
                    <span className="mt-1 block line-clamp-2 text-xs text-[var(--color-muted)]">{item.description || "Brak opisu"}</span>
                    <span className="mt-1 inline-flex rounded-full bg-[var(--color-bg)] px-2 py-1 text-xs">{labels[item.status]}</span>
                    <span className="mt-1 block text-xs text-[var(--color-muted)]">Wersja {item.revision} · {formatDate(item.createdAt)}</span>
                  </span>
                </button>
              </li>)}
            </ul>}
        {(previousCursors.length > 0 || queue.nextCursor) && <div className="mt-3 flex gap-2">
          {previousCursors.length > 0 && <button data-testid="community-moderation-previous-page" type="button" onClick={() => { setLoading(true); setCursor(previousCursors[previousCursors.length - 1]); setPreviousCursors((items) => items.slice(0, -1)); }} disabled={loading || busy} className="min-h-11 flex-1 rounded-xl border border-[var(--color-border)] text-sm font-semibold disabled:opacity-50">Poprzednie</button>}
          {queue.nextCursor && <button data-testid="community-moderation-next-page" type="button" onClick={() => { setLoading(true); setPreviousCursors((items) => [...items, cursor]); setCursor(queue.nextCursor); }} disabled={loading || busy} className="min-h-11 flex-1 rounded-xl border border-[var(--color-border)] text-sm font-semibold disabled:opacity-50">Następne prace</button>}
        </div>}
      </section>

      <section data-testid="community-moderation-detail" aria-label="Szczegóły pracy" className="min-w-0 rounded-2xl border border-[var(--color-border)] bg-white p-4 sm:p-5">
        {!current || !detail ? <div className="grid min-h-72 place-items-center text-center text-sm text-[var(--color-muted)]">{selectedId ? "Wczytywanie szczegółów…" : "Wybierz pracę z kolejki, aby zobaczyć podgląd i historię."}</div> : <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words font-serif text-2xl font-semibold">{current.creatorUsername ? `@${current.creatorUsername}` : "Twórca niedostępny"}</h2><p className="mt-1 break-words text-sm text-[var(--color-muted)]">{current.product.title}</p></div><span className="rounded-full bg-[var(--color-bg)] px-3 py-1 text-sm">{labels[current.status]} · wersja {current.revision}</span></div>
          <div className="overflow-hidden rounded-2xl bg-[var(--color-bg)]">
            {/* Private media bypasses the public image optimizer so every view rechecks moderation status. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img data-testid="community-moderation-preview" src={`/api/community/artworks/${current.id}/media`} alt="Prywatny podgląd pracy przesłanej do moderacji" className="mx-auto max-h-[min(68vh,44rem)] w-full object-contain" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-[var(--color-bg)] p-3"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Opis</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{current.description || "Brak opisu"}</p></div><div className="rounded-xl bg-[var(--color-bg)] p-3"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Zgłoszono</p><p className="mt-1 text-sm">{formatDate(current.createdAt)}</p><a href={`/en/products/${current.product.slug}`} className="mt-2 inline-flex text-sm font-semibold underline">Otwórz książkę</a></div></div>
          {current.rejectionReason && <div className="rounded-xl border border-[var(--color-border)] p-3"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Ostatni powód moderacji</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{current.rejectionReason}</p></div>}

          {allowedActions.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Działania moderacyjne">
            {allowedActions.map((action) => <button key={action} data-testid={`community-moderation-${action}`} type="button" disabled={busy} onClick={() => startAction(action)} className={`min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-50 ${action === "approve" ? "bg-[var(--color-ink)] text-white" : "border border-[var(--color-border)]"}`}>{actionLabels[action]}</button>)}
          </div>}

          {pendingAction && <div className="space-y-3 rounded-xl border border-[var(--color-border)] p-4">
            <h3 className="font-semibold">Potwierdź: {actionLabels[pendingAction].toLowerCase()}</h3>
            {(pendingAction === "reject" || pendingAction === "remove") && <label className="grid gap-1.5 text-sm font-medium" htmlFor="community-moderation-reason">Powód decyzji
              <textarea id="community-moderation-reason" data-testid="community-moderation-reason" value={reason} disabled={busy} onChange={(event) => { setReason(event.target.value); setReasonError(""); }} maxLength={500} rows={3} aria-invalid={Boolean(reasonError)} aria-describedby={reasonError ? "community-moderation-reason-error" : undefined} className="rounded-xl border border-[var(--color-border)] p-3 disabled:opacity-50" />
              {reasonError && <span id="community-moderation-reason-error" className="text-red-800">{reasonError}</span>}
              <span className="text-xs text-[var(--color-muted)]">{reason.trim().length}/500</span>
            </label>}
            {pendingAction === "approve" && <p className="text-sm text-[var(--color-muted)]">Praca zostanie opublikowana, jeśli książka i konto twórcy nadal spełniają wymagania.</p>}
            {pendingAction === "restore" && <p className="text-sm text-[var(--color-muted)]">Praca wróci do kolejki jako oczekująca na sprawdzenie.</p>}
            <div className="flex flex-wrap gap-2"><button data-testid="community-moderation-confirm" type="button" onClick={() => void runAction()} disabled={busy} className="min-h-11 rounded-xl bg-[var(--color-ink)] px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Zapisywanie…" : "Potwierdź decyzję"}</button><button type="button" onClick={() => { setPendingAction(null); setReason(""); }} disabled={busy} className="min-h-11 rounded-xl border border-[var(--color-border)] px-4 text-sm">Anuluj</button></div>
          </div>}

          <section data-testid="community-moderation-history" aria-label="Ostatnie decyzje moderacji" className="border-t border-[var(--color-border)] pt-4"><h3 className="font-serif text-lg font-semibold">Ostatnie decyzje</h3><ol className="mt-3 space-y-3">{detail.history.length === 0 ? <li className="text-sm text-[var(--color-muted)]">Praca oczekuje na pierwszą decyzję.</li> : detail.history.map((entry) => <li key={entry.id} className="border-l-2 border-[var(--color-blush)] pl-3"><p className="text-sm font-semibold">{labels[entry.toStatus]} · wersja {entry.revision}</p><p className="text-xs text-[var(--color-muted)]">{formatDate(entry.createdAt)} · Administrator</p>{entry.reason && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{entry.reason}</p>}</li>)}</ol></section>
        </div>}
      </section>
    </div>
  </section>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
