"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AdminEditorSection } from "@/components/admin/admin-editor-foundation";
import { useAdminToast } from "@/components/admin/admin-toast";
import { validateReaderArtworkFile } from "@/lib/media-upload";

type Artwork = { id: string; displayName: string; description?: string; sortOrder: number; isVisible: boolean; src: string };

function isArtwork(value: unknown): value is Artwork {
  if (!value || typeof value !== "object") return false;
  const artwork = value as Partial<Artwork>;
  return typeof artwork.id === "string"
    && typeof artwork.displayName === "string"
    && typeof artwork.sortOrder === "number"
    && typeof artwork.isVisible === "boolean"
    && typeof artwork.src === "string"
    && (artwork.description === undefined || typeof artwork.description === "string");
}

export function ReaderArtworkManager({ productId }: { productId?: string }) {
  const publishToast = useAdminToast();
  const [items, setItems] = useState<Artwork[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(productId));
  const [loadedEndpoint, setLoadedEndpoint] = useState("");
  const requestGeneration = useRef(0);
  const [reloadCount, setReloadCount] = useState(0);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const endpoint = productId ? `/api/admin/products/${encodeURIComponent(productId)}/reader-artworks` : "";
  const ready = Boolean(endpoint) && loadedEndpoint === endpoint;
  const isLoading = loading || (Boolean(endpoint) && !ready && !error);

  useEffect(() => {
    if (!endpoint) return;
    const generation = ++requestGeneration.current;
    fetch(endpoint, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Nie udało się wczytać prac.");
      const result: unknown = await response.json().catch(() => null);
      if (!result || typeof result !== "object" || !Array.isArray((result as { artworks?: unknown }).artworks)
        || !(result as { artworks: unknown[] }).artworks.every(isArtwork)) {
        throw new Error("Nie udało się wczytać prac. Odpowiedź serwera ma nieprawidłowy format.");
      }
      const fetched = (result as { artworks: Artwork[] }).artworks;
      if (generation === requestGeneration.current) { setItems(fetched); setLoadedEndpoint(endpoint); }
    }).catch((reason: unknown) => { if (generation === requestGeneration.current) setError(reason instanceof Error && reason.message.startsWith("Nie udało się wczytać") ? reason.message : "Nie udało się wczytać prac. Sprawdź połączenie i ponów próbę."); })
      .finally(() => { if (generation === requestGeneration.current) setLoading(false); });
    return () => { requestGeneration.current += 1; };
  }, [endpoint, reloadCount]);

  async function request(method: string, body?: unknown, form?: FormData) {
    if (!endpoint || !ready) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method, ...(form ? { body: form } : body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error("Nie udało się zapisać zmian. Sprawdź połączenie i spróbuj ponownie.");
      if (!result || typeof result !== "object") throw new Error("Nie udało się potwierdzić zapisu. Odśwież listę przed kolejną próbą.");
      const payload = result as { artworks?: unknown; artwork?: unknown };
      if (Array.isArray(payload.artworks) && payload.artworks.every(isArtwork)) {
        requestGeneration.current += 1;
        setItems(payload.artworks);
      }
      else if (isArtwork(payload.artwork)) {
        requestGeneration.current += 1;
        const artwork = payload.artwork;
        setItems((current) => [...current, artwork]);
      }
      else throw new Error("Nie udało się potwierdzić zapisu. Odpowiedź serwera ma nieprawidłowy format.");
      publishToast("success", "Prace czytelniczek zostały zapisane.");
      return true;
    } catch (reason) {
      const knownMessages = ["Nie udało się zapisać zmian. Sprawdź połączenie i spróbuj ponownie.", "Nie udało się potwierdzić zapisu. Odśwież listę przed kolejną próbą.", "Nie udało się potwierdzić zapisu. Odpowiedź serwera ma nieprawidłowy format."];
      const message = reason instanceof Error && knownMessages.includes(reason.message) ? reason.message : "Nie udało się zapisać zmian. Sprawdź połączenie i spróbuj ponownie.";
      setError(message);
      publishToast("error", message);
      return false;
    }
    finally { setBusy(false); }
  }

  async function upload() {
    if (!file || !name.trim()) { setError("Wybierz obraz i wpisz pseudonim."); return; }
    const validation = validateReaderArtworkFile(file);
    if (!validation.ok) { setError(validation.error); return; }
    const form = new FormData(); form.set("file", file); form.set("displayName", name); form.set("description", description);
    if (await request("POST", undefined, form)) { setFile(null); setName(""); setDescription(""); const input = document.getElementById("reader-artwork-file") as HTMLInputElement | null; if (input) input.value = ""; }
  }

  return <AdminEditorSection title="Pokolorowane prace czytelniczek" description="Osobna galeria prac dodawanych przez administratora. Nie trafiają do podglądu stron książki.">
    {!productId ? <p className="text-sm text-[var(--color-muted)]">Najpierw zapisz produkt, aby dodać do niego prace.</p> : <div className="grid gap-4">
      <div className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
        <label className="grid min-w-0 gap-1 text-sm font-medium">Obraz (maks. 4 MB) <input disabled={busy || !ready} id="reader-artwork-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <label className="grid gap-1 text-sm font-medium">Pseudonim <input disabled={busy || !ready} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="h-10 rounded-md border border-[var(--color-border)] bg-white px-3" /></label>
        <label className="grid gap-1 text-sm font-medium">Opis obrazu (opcjonalnie) <input disabled={busy || !ready} value={description} maxLength={240} onChange={(event) => setDescription(event.target.value)} className="h-10 rounded-md border border-[var(--color-border)] bg-white px-3" /></label>
        <button type="button" disabled={busy || !ready} onClick={() => void upload()} className="w-fit rounded-md bg-[var(--color-action)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-action-hover)] disabled:opacity-50">Dodaj pracę</button>
      </div>
      {items.map((item, index) => <div key={item.id} data-testid="reader-artwork-item" className="grid min-w-0 gap-3 rounded-lg border border-[var(--color-border)] p-3 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center">
        <Image src={item.src} alt="" width={80} height={80} unoptimized className="h-20 w-20 rounded object-cover" />
        <div className="grid min-w-0 gap-2 text-sm">{editingId === item.id ? <>
          <label className="grid gap-1">Pseudonim<input value={editName} maxLength={80} onChange={(event) => setEditName(event.target.value)} className="h-9 rounded border px-2" /></label>
          <label className="grid gap-1">Opis alternatywny<input value={editDescription} maxLength={240} onChange={(event) => setEditDescription(event.target.value)} className="h-9 rounded border px-2" /></label>
        </> : <><strong className="[overflow-wrap:anywhere]">Colored by {item.displayName}</strong>{item.description ? <span className="[overflow-wrap:anywhere] text-[var(--color-muted)]">{item.description}</span> : null}<span>{item.isVisible ? "Widoczna publicznie" : "Ukryta"}</span></>}</div>
        <div className="flex min-w-0 flex-wrap gap-2">
          <button type="button" disabled={busy || !ready || index === 0} onClick={() => void request("PATCH", { id: item.id, action: "move", direction: -1 })} aria-label="Przesuń wyżej">↑</button>
          <button type="button" disabled={busy || !ready || index === items.length - 1} onClick={() => void request("PATCH", { id: item.id, action: "move", direction: 1 })} aria-label="Przesuń niżej">↓</button>
          <button type="button" disabled={busy || !ready} onClick={() => void request("PATCH", { id: item.id, action: "visibility", isVisible: !item.isVisible })}>{item.isVisible ? "Ukryj" : "Pokaż"}</button>
          {editingId === item.id ? <><button type="button" disabled={busy || !ready} onClick={async () => { if (await request("PATCH", { id: item.id, action: "edit", displayName: editName, description: editDescription })) setEditingId(null); }}>Zapisz</button><button type="button" disabled={busy || !ready} onClick={() => setEditingId(null)}>Anuluj</button></> : <button type="button" disabled={busy || !ready} onClick={() => { setEditingId(item.id); setEditName(item.displayName); setEditDescription(item.description ?? ""); }}>Edytuj</button>}
          <button type="button" disabled={busy || !ready} onClick={() => { if (window.confirm("Usunąć tę pracę?")) void request("DELETE", { id: item.id }); }}>Usuń</button>
        </div>
      </div>)}
      {ready && !items.length ? <p className="text-sm text-[var(--color-muted)]">Nie dodano jeszcze prac.</p> : null}
      {isLoading ? <p role="status" className="text-sm text-[var(--color-muted)]">Wczytywanie prac…</p> : null}
      {!ready && error.startsWith("Nie udało się wczytać") ? <button type="button" onClick={() => { setLoading(true); setError(""); setReloadCount((count) => count + 1); }}>Ponów wczytywanie</button> : null}
      {error ? <p role="alert" className="text-sm text-red-800">{error}</p> : null}
    </div>}
  </AdminEditorSection>;
}
