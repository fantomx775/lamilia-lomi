"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { CommunityOwnerArtwork } from "@/lib/community/types";

type CommunityBook = { id: string; slug: string; title: string };
type PendingImage = {
  file: File;
  idempotencyKey: string;
  previewUrl: string;
  description: string;
  validationError: string | null;
  requestError: string | null;
  retryPayload?: { productId: string; description: string };
};
type Props = {
  initialArtworks: CommunityOwnerArtwork[];
  products: CommunityBook[];
  uploadsEnabled: boolean;
  canSubmit: boolean;
  canEdit: boolean;
  canDelete: boolean;
  communityMember: boolean;
  guidelinesHref: string;
  accountHref: string;
  libraryHref: string;
  preselectedProductId: string;
};

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function CommunityCreationManager({
  initialArtworks,
  products,
  uploadsEnabled,
  canSubmit,
  canEdit,
  canDelete,
  communityMember,
  guidelinesHref,
  accountHref,
  libraryHref,
  preselectedProductId,
}: Props) {
  const [artworks, setArtworks] = useState(initialArtworks);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [productId, setProductId] = useState(preselectedProductId);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pageError, setPageError] = useState("");
  const [descriptionDrafts, setDescriptionDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const previewUrls = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    previewUrls.current.clear();
  }, []);

  function addFiles(fileList: FileList | File[]) {
    const selected = Array.from(fileList);
    if (!selected.length) return;
    setNotice("");
    setPageError("");
    if (selected.length > 3) {
      setPageError("Choose up to three images at a time.");
      return;
    }
    if (pendingImages.length + selected.length > 3) {
      setPageError("Remove an image before adding more. Submit up to three artworks at a time.");
      return;
    }
    const added = selected.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      let validationError: string | null = null;
      if (!ACCEPTED_TYPES.has(file.type)) validationError = "Use a JPG, PNG, or WebP image.";
      else if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) validationError = "Choose an image no larger than 4 MiB.";
      return { file, idempotencyKey: crypto.randomUUID(), previewUrl, description: "", validationError, requestError: null };
    });
    setPendingImages((current) => [...current, ...added]);
  }

  function removePending(idempotencyKey: string) {
    setPendingImages((current) => {
      const target = current.find((item) => item.idempotencyKey === idempotencyKey);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        previewUrls.current.delete(target.previewUrl);
      }
      return current.filter((item) => item.idempotencyKey !== idempotencyKey);
    });
  }

  async function uploadOne(item: PendingImage, payload: { productId: string; description: string }) {
    const form = new FormData();
    form.set("file", item.file);
    form.set("productId", payload.productId);
    form.set("description", payload.description);
    form.set("idempotencyKey", item.idempotencyKey);
    form.set("rulesAccepted", "true");
    try {
      const response = await fetch("/api/community/artworks", { method: "POST", body: form });
      const result = await response.json() as { ok?: boolean; artwork?: CommunityOwnerArtwork; message?: string };
      if (!response.ok || !result.ok || !result.artwork) throw new Error(result.message ?? "This image could not be submitted. Try again.");
      setArtworks((current) => [result.artwork!, ...current.filter((artwork) => artwork.id !== result.artwork!.id)]);
      removePending(item.idempotencyKey);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "This image could not be submitted. Try again.";
      setPendingImages((current) => current.map((candidate) => candidate.idempotencyKey === item.idempotencyKey
        ? { ...candidate, requestError: message, retryPayload: candidate.retryPayload ?? payload }
        : candidate));
      return false;
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !productId || !rulesAccepted || !pendingImages.some((item) => !item.validationError) || busy) return;
    setBusy(true);
    setPageError("");
    setNotice("");
    let uploadedCount = 0;
    for (const item of pendingImages) {
      if (item.validationError) continue;
      const payload = item.retryPayload ?? { productId, description: item.description.trim() };
      if (await uploadOne(item, payload)) uploadedCount += 1;
    }
    if (uploadedCount) setNotice(`${uploadedCount === 1 ? "Artwork was" : `${uploadedCount} artworks were`} sent for review. They stay private until approved.`);
    setBusy(false);
  }

  async function retryOne(item: PendingImage) {
    if (!item.retryPayload || busy) return;
    setBusy(true);
    setPageError("");
    if (await uploadOne(item, item.retryPayload)) setNotice("Artwork was sent for review. It stays private until approved.");
    setBusy(false);
  }

  async function saveDescription(artwork: CommunityOwnerArtwork) {
    const description = descriptionDrafts[artwork.id] ?? artwork.description;
    if (!canEdit || description.trim() === artwork.description) return;
    setSavingId(artwork.id);
    setPageError("");
    try {
      const response = await fetch(`/api/community/artworks/${encodeURIComponent(artwork.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: artwork.revision, description }),
      });
      const payload = await response.json() as { ok?: boolean; artwork?: CommunityOwnerArtwork; message?: string };
      if (!response.ok || !payload.ok || !payload.artwork) throw new Error(payload.message ?? "Your description could not be saved.");
      setArtworks((current) => current.map((item) => item.id === artwork.id ? payload.artwork! : item));
      setDescriptionDrafts((current) => ({ ...current, [artwork.id]: payload.artwork!.description }));
      setNotice("Your description was saved. This artwork is pending review again.");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Your description could not be saved.");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteArtwork(artwork: CommunityOwnerArtwork) {
    setPageError("");
    try {
      const response = await fetch(`/api/community/artworks/${encodeURIComponent(artwork.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: artwork.revision }),
      });
      const payload = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? "This artwork could not be deleted.");
      setArtworks((current) => current.filter((item) => item.id !== artwork.id));
      setDeleteId(null);
      setNotice("Your artwork was deleted.");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "This artwork could not be deleted.");
    }
  }

  return (
    <div className="grid gap-8" data-testid="community-creation-manager">
      {pageError ? <p className="rounded-md bg-[var(--color-error-bg)] p-3 text-sm text-[var(--color-error)]" role="alert">{pageError}</p> : null}
      {notice ? <p className="rounded-md bg-[var(--color-sage)] p-3 text-sm text-[var(--color-ink)]" role="status" aria-live="polite">{notice}</p> : null}

      {canSubmit ? (
        <form className="grid gap-5 rounded-xl border border-[var(--color-border)] bg-white p-5 sm:p-6" onSubmit={submit} data-testid="community-upload-form">
          <div>
            <h2 className="font-serif text-2xl font-semibold text-[var(--color-ink)]">Share your art</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Choose an unlocked book and share up to three images. Your artwork stays private while it is reviewed.</p>
          </div>
          <div className="grid gap-2 sm:max-w-xl">
            <label className="text-sm font-medium text-[var(--color-ink)]" htmlFor="community-product">Book</label>
            <select id="community-product" required value={productId} disabled={busy || pendingImages.some((item) => Boolean(item.retryPayload))} onChange={(event) => setProductId(event.currentTarget.value)} className="min-h-11 rounded-md border border-[var(--color-border)] bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" data-testid="community-product-select">
              <option value="">Choose an unlocked book</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}
            </select>
            {!products.length ? <p className="text-sm text-[var(--color-muted)]">No published unlocked books are available for sharing.</p> : null}
          </div>

          <div
            className="grid min-h-36 place-items-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-alt)] p-5 text-center"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); if (!busy) addFiles(event.dataTransfer.files); }}
            data-testid="community-upload-dropzone"
          >
            <div className="grid justify-items-center gap-2">
              <p className="text-sm font-medium text-[var(--color-ink)]">Drop images here or choose files</p>
              <p className="text-xs text-[var(--color-muted)]">JPG, PNG, or WebP · up to 4 MiB each · choose up to three</p>
              <input
                ref={inputRef}
                className="sr-only"
                id="community-artwork-files"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={busy}
                onChange={(event) => { if (event.currentTarget.files) addFiles(event.currentTarget.files); event.currentTarget.value = ""; }}
                data-testid="community-upload-file-input"
              />
              <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="inline-flex min-h-10 items-center rounded-md border border-[var(--color-border)] bg-white px-4 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-blush)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]">
                Choose images
              </button>
            </div>
          </div>

          {pendingImages.length ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Selected artwork images" data-testid="community-selected-artworks">
              {pendingImages.map((item, index) => (
                <li key={item.idempotencyKey} className="grid content-start gap-3 rounded-lg border border-[var(--color-border)] p-3" data-testid="community-selected-artwork">
                  {/* Private previews bypass Next's persistent image optimizer cache. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.previewUrl} alt={`Preview of ${item.file.name}`} className="aspect-[4/3] w-full rounded-md bg-[var(--color-bg-alt)] object-contain" />
                  <p className="break-all text-sm font-medium text-[var(--color-ink)]">{item.file.name}</p>
                  <label className="grid gap-1 text-sm" htmlFor={`community-description-${item.idempotencyKey}`}>
                    Description <span className="text-xs text-[var(--color-muted)]">Optional · up to 240 characters</span>
                    <textarea
                      id={`community-description-${item.idempotencyKey}`}
                      maxLength={240}
                      rows={2}
                      value={item.description}
                      disabled={busy || Boolean(item.retryPayload)}
                      onChange={(event) => {
                        const description = event.currentTarget.value;
                        setPendingImages((current) => current.map((candidate) => candidate.idempotencyKey === item.idempotencyKey
                        ? { ...candidate, description }
                        : candidate))}
                      }
                      className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
                      aria-describedby={item.validationError || item.requestError ? `community-file-error-${index}` : undefined}
                    />
                  </label>
                  {item.validationError || item.requestError ? <p id={`community-file-error-${index}`} className="text-sm text-[var(--color-error)]" role="alert">{item.validationError ?? item.requestError}</p> : null}
                  {item.requestError && item.retryPayload ? <button type="button" disabled={busy} onClick={() => void retryOne(item)} className="min-h-10 justify-self-start rounded-sm text-sm font-medium text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" data-testid="community-artwork-retry">Retry this image</button> : null}
                  <button type="button" disabled={busy} onClick={() => removePending(item.idempotencyKey)} className="min-h-10 justify-self-start rounded-sm text-sm font-medium text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]">Remove image</button>
                </li>
              ))}
            </ul>
          ) : null}

          <label className="flex items-start gap-3 text-sm leading-6 text-[var(--color-ink)]">
            <input type="checkbox" checked={rulesAccepted} onChange={(event) => setRulesAccepted(event.currentTarget.checked)} className="mt-1 size-4 accent-[var(--color-terracotta)]" data-testid="community-upload-rules" />
            <span>I confirm this is my own artwork and accept the <Link href={guidelinesHref} className="font-medium underline underline-offset-4">community guidelines</Link>.</span>
          </label>
          <button type="submit" disabled={busy || !pendingImages.some((item) => !item.validationError) || !productId || !rulesAccepted} className="inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--color-ink)] px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" data-testid="community-upload-submit">
            {busy ? "Sending artwork…" : "Send for review"}
          </button>
        </form>
      ) : uploadsEnabled ? (
        <div className="grid gap-2 rounded-xl border border-[var(--color-border)] bg-white p-5" data-testid="community-upload-unavailable">
          <h2 className="font-serif text-xl font-semibold text-[var(--color-ink)]">Share your art</h2>
          <p className="text-sm leading-6 text-[var(--color-muted)]">{communityMember ? "Join again in Community settings before sharing artwork." : "Join the Coloring Club before sharing artwork."}</p>
          <Link className="justify-self-start text-sm font-medium underline underline-offset-4" href={accountHref}>Open Community settings</Link>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--color-border)] bg-white p-5" data-testid="community-uploads-paused">
          <h2 className="font-serif text-xl font-semibold text-[var(--color-ink)]">New submissions are paused</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">You can still view and delete your existing creations.</p>
        </div>
      )}

      {artworks.length ? (
        <section aria-labelledby="my-creations-list-title" data-testid="community-my-artworks">
          <h2 id="my-creations-list-title" className="mb-4 font-serif text-2xl font-semibold text-[var(--color-ink)]">Your artwork</h2>
          <ul className="grid gap-4 md:grid-cols-2">
            {artworks.map((artwork) => {
              const description = descriptionDrafts[artwork.id] ?? artwork.description;
              return (
                <li key={artwork.id}>
                  <article className="grid h-full content-start gap-4 rounded-xl border border-[var(--color-border)] bg-white p-5" data-testid="community-artwork-card">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-terracotta)]">{statusLabel(artwork.status)}</p>
                        <h3 className="mt-1 break-words font-serif text-xl font-semibold text-[var(--color-ink)]">{artwork.product.title}</h3>
                      </div>
                      <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-alt)] px-3 py-1 text-xs text-[var(--color-ink)]">Revision {artwork.revision}</span>
                    </div>
                    {/* The app media route rechecks current visibility on every byte request. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/community/artworks/${encodeURIComponent(artwork.id)}/media`} alt={`Your artwork for ${artwork.product.title}`} loading="lazy" className="aspect-[4/3] w-full rounded-md bg-[var(--color-bg-alt)] object-contain" data-testid="community-artwork-preview" />
                    {artwork.rejectionReason ? (
                      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-alt)] p-3">
                        <h4 className="text-sm font-semibold text-[var(--color-ink)]">Private review reason</h4>
                        <p className="mt-1 break-words text-sm leading-6 text-[var(--color-muted)]">{artwork.rejectionReason}</p>
                      </div>
                    ) : null}
                    {canEdit ? (
                      <label className="grid gap-2 text-sm font-medium text-[var(--color-ink)]">
                        Description <span className="text-xs font-normal text-[var(--color-muted)]">Editing approved artwork sends it for review again.</span>
                        <textarea
                          rows={3}
                          maxLength={240}
                          value={description}
                          onChange={(event) => setDescriptionDrafts((current) => ({ ...current, [artwork.id]: event.currentTarget.value }))}
                          className="rounded-md border border-[var(--color-border)] px-3 py-2 font-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
                          data-testid="community-artwork-description"
                        />
                      </label>
                    ) : <p className="break-words text-sm leading-6 text-[var(--color-muted)]">{artwork.description || "No description added."}</p>}
                    <p className="text-xs text-[var(--color-muted)]">Updated {formatDate(artwork.updatedAt)}</p>
                    <div className="flex flex-wrap gap-3">
                      {canEdit && description.trim() !== artwork.description ? (
                        <button type="button" disabled={savingId === artwork.id} onClick={() => void saveDescription(artwork)} className="inline-flex min-h-10 items-center rounded-md border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-ink)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" data-testid="community-artwork-save-description">
                          {savingId === artwork.id ? "Saving…" : "Save description"}
                        </button>
                      ) : null}
                      {canDelete && deleteId !== artwork.id ? (
                        <button type="button" onClick={() => setDeleteId(artwork.id)} className="inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium text-[var(--color-ink)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" data-testid="community-artwork-delete">Delete artwork</button>
                      ) : null}
                    </div>
                    {deleteId === artwork.id ? (
                      <div className="grid gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-alt)] p-3" role="group" aria-label="Confirm artwork deletion">
                        <p className="text-sm leading-6">Delete this artwork? It will no longer be visible.</p>
                        <div className="flex flex-wrap gap-3">
                          <button type="button" onClick={() => void deleteArtwork(artwork)} className="min-h-10 rounded-md bg-[var(--color-ink)] px-4 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]" data-testid="community-artwork-confirm-delete">Delete artwork</button>
                          <button type="button" onClick={() => setDeleteId(null)} className="min-h-10 rounded-md border border-[var(--color-border)] px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]">Keep artwork</button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <section className="rounded-xl border border-[var(--color-border)] bg-white p-5" data-testid="community-my-artworks-empty">
          <h2 className="font-serif text-2xl font-semibold text-[var(--color-ink)]">No creations yet</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Your submissions and private review status will appear here.</p>
          {!communityMember ? <Link className="mt-3 inline-flex font-medium underline underline-offset-4" href={accountHref}>Join the Coloring Club</Link> : null}
          <Link className="mt-3 inline-flex font-medium underline underline-offset-4" href={libraryHref}>Open My Library</Link>
        </section>
      )}
    </div>
  );
}

function statusLabel(status: CommunityOwnerArtwork["status"]) {
  switch (status) {
    case "approved": return "Published";
    case "pending": return "Pending review · private";
    case "rejected": return "Rejected · private";
    case "removed": return "Removed · private";
  }
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}
