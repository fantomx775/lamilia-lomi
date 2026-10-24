"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AdminEditorSection } from "@/components/admin/admin-editor-foundation";

type Artwork = { id: string; displayName: string; description?: string; sortOrder: number; isVisible: boolean; src: string };

export function ReaderArtworkManager({ productId }: { productId?: string }) {
  const [items, setItems] = useState<Artwork[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const endpoint = productId ? `/api/admin/products/${encodeURIComponent(productId)}/reader-artworks` : "";

  useEffect(() => {
    if (!endpoint) return;
    fetch(endpoint, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Nie udało się wczytać prac.");
      setItems((await response.json()).artworks);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Nie udało się wczytać prac."));
  }, [endpoint]);

  async function request(method: string, body?: unknown, form?: FormData) {
    if (!endpoint) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(endpoint, { method, ...(form ? { body: form } : body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      if (!response.ok) throw new Error("Nie udało się zapisać zmian.");
      if (Array.isArray(result.artworks)) setItems(result.artworks);
      else if (result.artwork) setItems((current) => [...current, result.artwork]);
      setMessage("Zmiany zapisane.");
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Nie udało się zapisać zmian."); return false; }
    finally { setBusy(false); }
  }

  async function upload() {
    if (!file || !name.trim()) { setError("Wybierz obraz i wpisz pseudonim."); return; }
    const form = new FormData(); form.set("file", file); form.set("displayName", name); form.set("description", description);
    if (await request("POST", undefined, form)) { setFile(null); setName(""); setDescription(""); const input = document.getElementById("reader-artwork-file") as HTMLInputElement | null; if (input) input.value = ""; }
  }

  return <AdminEditorSection title="Pokolorowane prace czytelniczek" description="Osobna galeria prac dodawanych przez administratora. Nie trafiają do podglądu stron książki.">
    {!productId ? <p className="text-sm text-[var(--color-muted)]">Najpierw zapisz produkt, aby dodać do niego prace.</p> : <div className="grid gap-4">
      <div className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
        <label className="grid gap-1 text-sm font-medium">Obraz <input id="reader-artwork-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <label className="grid gap-1 text-sm font-medium">Pseudonim <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} className="h-10 rounded-md border border-[var(--color-border)] bg-white px-3" /></label>
        <label className="grid gap-1 text-sm font-medium">Opis obrazu (opcjonalnie) <input value={description} maxLength={240} onChange={(event) => setDescription(event.target.value)} className="h-10 rounded-md border border-[var(--color-border)] bg-white px-3" /></label>
        <button type="button" disabled={busy} onClick={() => void upload()} className="w-fit rounded-md bg-[var(--color-terracotta)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Dodaj pracę</button>
      </div>
      {items.map((item, index) => <div key={item.id} className="grid gap-3 rounded-lg border border-[var(--color-border)] p-3 sm:grid-cols-[5rem_1fr_auto] sm:items-center">
        <Image src={item.src} alt="" width={80} height={80} unoptimized className="h-20 w-20 rounded object-cover" />
        <div className="grid gap-2 text-sm">{editingId === item.id ? <>
          <label className="grid gap-1">Pseudonim<input value={editName} maxLength={80} onChange={(event) => setEditName(event.target.value)} className="h-9 rounded border px-2" /></label>
          <label className="grid gap-1">Opis alternatywny<input value={editDescription} maxLength={240} onChange={(event) => setEditDescription(event.target.value)} className="h-9 rounded border px-2" /></label>
        </> : <><strong>Colored by {item.displayName}</strong>{item.description ? <span className="text-[var(--color-muted)]">{item.description}</span> : null}<span>{item.isVisible ? "Widoczna publicznie" : "Ukryta"}</span></>}</div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || index === 0} onClick={() => void request("PATCH", { id: item.id, action: "move", direction: -1 })} aria-label="Przesuń wyżej">↑</button>
          <button type="button" disabled={busy || index === items.length - 1} onClick={() => void request("PATCH", { id: item.id, action: "move", direction: 1 })} aria-label="Przesuń niżej">↓</button>
          <button type="button" disabled={busy} onClick={() => void request("PATCH", { id: item.id, action: "visibility", isVisible: !item.isVisible })}>{item.isVisible ? "Ukryj" : "Pokaż"}</button>
          {editingId === item.id ? <><button type="button" disabled={busy} onClick={async () => { if (await request("PATCH", { id: item.id, action: "edit", displayName: editName, description: editDescription })) setEditingId(null); }}>Zapisz</button><button type="button" disabled={busy} onClick={() => setEditingId(null)}>Anuluj</button></> : <button type="button" disabled={busy} onClick={() => { setEditingId(item.id); setEditName(item.displayName); setEditDescription(item.description ?? ""); }}>Edytuj</button>}
          <button type="button" disabled={busy} onClick={() => { if (window.confirm("Usunąć tę pracę?")) void request("DELETE", { id: item.id }); }}>Usuń</button>
        </div>
      </div>)}
      {!items.length ? <p className="text-sm text-[var(--color-muted)]">Nie dodano jeszcze prac.</p> : null}
      {error ? <p role="alert" className="text-sm text-red-800">{error}</p> : null}{message ? <p role="status" className="text-sm text-green-800">{message}</p> : null}
    </div>}
  </AdminEditorSection>;
}
