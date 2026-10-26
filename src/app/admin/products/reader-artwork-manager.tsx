"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, MoveDown, MoveUp, Pencil, Trash2 } from "lucide-react";
import { AdminEditorSection } from "@/components/admin/admin-editor-foundation";
import { useAdminToast } from "@/components/admin/admin-toast";
import { Button } from "@/components/ui/button";
import { validateReaderArtworkFile } from "@/lib/media-upload";

type Artwork = { id: string; displayName: string; description?: string; sortOrder: number; isVisible: boolean; src: string };
type PendingArtwork = { id: string; file: File; src: string; name: string; description: string };

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
  const [pending, setPending] = useState<PendingArtwork[]>([]);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef(new Set<string>());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const endpoint = productId ? `/api/admin/products/${encodeURIComponent(productId)}/reader-artworks` : "";
  const ready = Boolean(endpoint) && loadedEndpoint === endpoint;
  const isLoading = loading || (Boolean(endpoint) && !ready && !error);

  useEffect(() => {
    const urls = previewUrls.current;
    return () => { urls.forEach((url) => URL.revokeObjectURL(url)); urls.clear(); };
  }, []);

  function queueFiles(files: FileList | File[]) {
    if (busy || !ready) return;
    const accepted: PendingArtwork[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(files)) {
      const validation = validateReaderArtworkFile(file);
      if (!validation.ok) { rejected.push(`${file.name}: ${validation.error}`); continue; }
      const src = URL.createObjectURL(file);
      previewUrls.current.add(src);
      accepted.push({ id: crypto.randomUUID(), file, src, name: "", description: "" });
    }
    setPending((current) => [...current, ...accepted]);
    setError(rejected.join(" "));
  }

  function removePending(id: string) {
    const draft = pending.find((item) => item.id === id);
    if (draft) { URL.revokeObjectURL(draft.src); previewUrls.current.delete(draft.src); }
    setPending((current) => current.filter((item) => item.id !== id));
  }

  function updatePending(id: string, field: "name" | "description", value: string) {
    setPending((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item));
  }

  useEffect(() => {
    if (!endpoint) return;
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Nie udało się wczytać prac.");
      const result: unknown = await response.json().catch(() => null);
      if (!result || typeof result !== "object" || !Array.isArray((result as { artworks?: unknown }).artworks)
        || !(result as { artworks: unknown[] }).artworks.every(isArtwork)) {
        throw new Error("Nie udało się wczytać prac. Odpowiedź serwera ma nieprawidłowy format.");
      }
      const fetched = (result as { artworks: Artwork[] }).artworks;
      if (generation === requestGeneration.current) { setItems(fetched); setLoadedEndpoint(endpoint); }
    }).catch((reason: unknown) => {
      if (generation !== requestGeneration.current || controller.signal.aborted) return;
      setError(reason instanceof Error && reason.message.startsWith("Nie udało się wczytać") ? reason.message : "Nie udało się wczytać prac. Sprawdź połączenie i ponów próbę.");
    })
      .finally(() => { if (generation === requestGeneration.current) setLoading(false); });
    return () => {
      requestGeneration.current += 1;
      controller.abort();
    };
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

  async function upload(draft: PendingArtwork) {
    if (!draft.name.trim()) { setError("Wpisz pseudonim autorki przy wybranej miniaturze."); return; }
    const validation = validateReaderArtworkFile(draft.file);
    if (!validation.ok) { setError(validation.error); return; }
    const form = new FormData(); form.set("file", draft.file); form.set("displayName", draft.name); form.set("description", draft.description);
    setUploadingId(draft.id);
    try { if (await request("POST", undefined, form)) removePending(draft.id); }
    finally { setUploadingId(null); }
  }

  return <section aria-label="Pokolorowane prace czytelniczek" data-testid="reader-artwork-manager" className="min-w-0" onKeyDown={(event) => { if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && event.target instanceof HTMLInputElement && event.target.type !== "file") event.preventDefault(); }}><AdminEditorSection title="Pokolorowane prace czytelniczek" description="Osobna galeria prac dodawanych przez administratora. Nie trafiają do podglądu stron książki.">
    {!productId ? <p className="text-sm text-[var(--color-muted)]">Najpierw zapisz produkt, aby dodać do niego prace.</p> : <div className="grid gap-4">
      <div>
        <button type="button" disabled={busy || !ready} onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); if (ready && !busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); queueFiles(event.dataTransfer.files); }} className={`grid min-h-36 w-full cursor-pointer place-items-center rounded-xl border-2 border-dashed px-5 py-6 text-center transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)] disabled:cursor-not-allowed disabled:opacity-50 ${dragging ? "border-[var(--color-terracotta)] bg-[var(--color-blush)]" : "border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-terracotta)] hover:bg-[var(--color-blush)]"}`} aria-label="Wybierz pliki prac czytelniczek" aria-controls="reader-artwork-file">
          <span className="grid justify-items-center gap-2"><span className="grid size-11 place-items-center rounded-full bg-white text-[var(--color-terracotta)] shadow-sm"><ImagePlus className="size-5" aria-hidden /></span><span className="font-medium">Przeciągnij pliki tutaj lub kliknij, aby wybrać</span><span className="text-xs text-[var(--color-muted)]">Wybór z klawiatury: Enter lub Spacja</span></span>
        </button>
        <input ref={inputRef} disabled={busy || !ready} id="reader-artwork-file" type="file" multiple accept="image/png,image/jpeg,image/webp" tabIndex={-1} className="sr-only" aria-label="Obrazy prac czytelniczek" onChange={(event) => { if (event.target.files) queueFiles(event.target.files); event.currentTarget.value = ""; }} />
        <p className="mt-3 text-xs leading-5 text-[var(--color-muted)]">PNG, JPG lub WEBP · maks. 4 MB każdy · po wyborze uzupełnij autorkę przy miniaturze</p>
      </div>
      {pending.map((draft) => <div key={draft.id} data-testid="reader-artwork-draft" className="grid min-w-0 gap-3 rounded-xl border border-[var(--color-border)] bg-white p-3 sm:grid-cols-[5rem_minmax(0,1fr)]">
        <Image src={draft.src} alt={`Podgląd ${draft.file.name}`} width={80} height={100} unoptimized className="h-24 w-20 rounded-lg border border-[var(--color-border)] object-contain" />
        <div className="grid min-w-0 gap-3">
          <div><p className="break-all text-sm font-medium">{draft.file.name}</p><p className="text-xs text-[var(--color-muted)]">Do dodania · {(draft.file.size / 1024 / 1024).toFixed(1)} MB</p></div>
          <label className="grid min-w-0 gap-1 text-sm font-medium">Pseudonim<input disabled={busy} value={draft.name} maxLength={80} aria-required="true" onChange={(event) => updatePending(draft.id, "name", event.target.value)} className="h-10 min-w-0 rounded-md border border-[var(--color-border)] bg-white px-3" /></label>
          <label className="grid min-w-0 gap-1 text-sm font-medium">Opis obrazu (opcjonalnie)<input disabled={busy} value={draft.description} maxLength={240} onChange={(event) => updatePending(draft.id, "description", event.target.value)} className="h-10 min-w-0 rounded-md border border-[var(--color-border)] bg-white px-3" /></label>
          <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || !ready || !draft.name.trim()} onClick={() => void upload(draft)} className="bg-[var(--color-action)] text-white hover:bg-[var(--color-action-hover)]">{uploadingId === draft.id ? "Przesyłanie…" : "Dodaj pracę"}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => removePending(draft.id)}><Trash2 className="size-4" aria-hidden />Usuń</Button></div>
        </div>
      </div>)}
      {items.map((item, index) => <div key={item.id} data-testid="reader-artwork-item" className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-3 rounded-xl border border-[var(--color-border)] bg-white p-3">
        <Image src={item.src} alt="" width={80} height={100} unoptimized className="h-24 w-20 rounded-lg border border-[var(--color-border)] object-contain" />
        <div className="grid min-w-0 content-start gap-2 text-sm">{editingId === item.id ? <>
          <label className="grid min-w-0 gap-1">Pseudonim<input disabled={busy || !ready} value={editName} maxLength={80} onChange={(event) => setEditName(event.target.value)} className="h-10 min-w-0 rounded-md border border-[var(--color-border)] px-3" /></label>
          <label className="grid min-w-0 gap-1">Opis alternatywny<input disabled={busy || !ready} value={editDescription} maxLength={240} onChange={(event) => setEditDescription(event.target.value)} className="h-10 min-w-0 rounded-md border border-[var(--color-border)] px-3" /></label>
        </> : <><strong className="[overflow-wrap:anywhere]">Colored by {item.displayName}</strong>{item.description ? <span className="[overflow-wrap:anywhere] text-[var(--color-muted)]">{item.description}</span> : null}<span>{item.isVisible ? "Widoczna publicznie" : "Ukryta"}</span></>}</div>
        <div className="col-span-2 flex min-w-0 flex-wrap gap-2 sm:col-span-1 sm:col-start-2">
          <Button type="button" variant="ghost" size="icon" disabled={busy || !ready || index === 0} onClick={() => void request("PATCH", { id: item.id, action: "move", direction: -1 })} aria-label="Przesuń wyżej" title="Przesuń wyżej"><MoveUp className="size-4" aria-hidden /></Button>
          <Button type="button" variant="ghost" size="icon" disabled={busy || !ready || index === items.length - 1} onClick={() => void request("PATCH", { id: item.id, action: "move", direction: 1 })} aria-label="Przesuń niżej" title="Przesuń niżej"><MoveDown className="size-4" aria-hidden /></Button>
          <Button type="button" variant="ghost" disabled={busy || !ready} onClick={() => void request("PATCH", { id: item.id, action: "visibility", isVisible: !item.isVisible })}>{item.isVisible ? "Ukryj" : "Pokaż"}</Button>
          {editingId === item.id ? <><Button type="button" disabled={busy || !ready} onClick={async () => { if (await request("PATCH", { id: item.id, action: "edit", displayName: editName, description: editDescription })) setEditingId(null); }}>Zapisz</Button><Button type="button" variant="ghost" disabled={busy || !ready} onClick={() => setEditingId(null)}>Anuluj</Button></> : <Button type="button" variant="ghost" disabled={busy || !ready} onClick={() => { setEditingId(item.id); setEditName(item.displayName); setEditDescription(item.description ?? ""); }}><Pencil className="size-4" aria-hidden />Edytuj</Button>}
          <Button type="button" variant="ghost" className="text-red-700" disabled={busy || !ready} onClick={() => { if (window.confirm("Usunąć tę pracę?")) void request("DELETE", { id: item.id }); }}><Trash2 className="size-4" aria-hidden />Usuń</Button>
        </div>
      </div>)}
      {ready && !items.length && !pending.length ? <p className="text-sm text-[var(--color-muted)]">Nie dodano jeszcze prac.</p> : null}
      {isLoading ? <p role="status" className="text-sm text-[var(--color-muted)]">Wczytywanie prac…</p> : null}
      {!ready && error.startsWith("Nie udało się wczytać") ? <button type="button" onClick={() => { setLoading(true); setError(""); setReloadCount((count) => count + 1); }}>Ponów wczytywanie</button> : null}
      {error ? <p role="alert" className="text-sm text-red-800">{error}</p> : null}
    </div>}
  </AdminEditorSection></section>;
}
