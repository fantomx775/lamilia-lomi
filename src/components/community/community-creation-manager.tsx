"use client";

import Link from "next/link";
import { Ellipsis, Plus, ShieldCheck, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AdminDrawer } from "@/components/admin/admin-drawer";
import { useToast } from "@/components/ui/toast";
import type { CommunityOwnerArtwork } from "@/lib/community/types";
import { trackEvent } from "@/lib/analytics-client";

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
const UPLOAD_FORM_ID = "community-upload-form";
const FOCUS_STYLE = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]";
const STATUS_STYLE: Record<CommunityOwnerArtwork["status"], string> = {
  approved: "bg-[var(--color-sage)] text-[var(--color-ink)]",
  pending: "bg-amber-50 text-amber-900",
  rejected: "bg-[var(--color-error-bg)] text-[var(--color-error)]",
  removed: "bg-[var(--color-blush)] text-[var(--color-ink)]",
};

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
  const { showToast } = useToast();
  const [artworks, setArtworks] = useState(initialArtworks);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [productId, setProductId] = useState(preselectedProductId);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [descriptionDrafts, setDescriptionDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [uploadDrawerOpen, setUploadDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const previewUrls = useRef(new Set<string>());
  const trackedSubmissions = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadTriggerRef = useRef<HTMLButtonElement>(null);
  const editingDescriptionRef = useRef<HTMLTextAreaElement>(null);
  const artworkActions = useRef(new Map<string, HTMLButtonElement>());
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const keepArtworkRef = useRef<HTMLButtonElement>(null);
  const artworkListTitleRef = useRef<HTMLHeadingElement>(null);
  const emptyStateTitleRef = useRef<HTMLHeadingElement>(null);
  const focusAfterLastDelete = useRef(false);
  const artworkToDelete = artworks.find((artwork) => artwork.id === deleteId);

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  useEffect(() => {
    if (editingId) editingDescriptionRef.current?.focus();
  }, [editingId]);

  useEffect(() => {
    if (!artworks.length && focusAfterLastDelete.current) {
      focusAfterLastDelete.current = false;
      (uploadTriggerRef.current ?? emptyStateTitleRef.current)?.focus();
    }
  }, [artworks.length]);

  useEffect(() => {
    if (!actionId) return;
    const group = artworkActions.current.get(actionId)?.parentElement;
    function dismissOnOutsidePress(event: PointerEvent) {
      if (event.target instanceof Node && !group?.contains(event.target)) setActionId(null);
    }
    document.addEventListener("pointerdown", dismissOnOutsidePress);
    return () => document.removeEventListener("pointerdown", dismissOnOutsidePress);
  }, [actionId]);

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (deleteId && dialog && !dialog.open) {
      dialog.showModal();
      keepArtworkRef.current?.focus();
    }
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [deleteId]);

  function closeDeleteDialog() {
    if (mutationBusy) return;
    deleteDialogRef.current?.close();
    if (deleteId) artworkActions.current.get(deleteId)?.focus();
    setDeleteId(null);
  }

  function addFiles(fileList: FileList | File[]) {
    const selected = Array.from(fileList);
    if (!selected.length) return;
    setUploadError("");
    if (selected.length > 3) {
      setUploadError("Choose up to three images at a time.");
      return;
    }
    if (pendingImages.length + selected.length > 3) {
      setUploadError("Remove an image before adding more. Submit up to three artworks at a time.");
      return;
    }
    const added = selected.map((file) => {
      let validationError: string | null = null;
      if (!ACCEPTED_TYPES.has(file.type)) validationError = "Use a JPG, PNG, or WebP image.";
      else if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) validationError = "Choose an image no larger than 4 MiB.";
      const previewUrl = validationError ? "" : URL.createObjectURL(file);
      if (previewUrl) previewUrls.current.add(previewUrl);
      return { file, idempotencyKey: crypto.randomUUID(), previewUrl, description: "", validationError, requestError: null };
    });
    setPendingImages((current) => [...current, ...added]);
  }

  function removePending(idempotencyKey: string) {
    const target = pendingImages.find((item) => item.idempotencyKey === idempotencyKey);
    if (target?.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
      previewUrls.current.delete(target.previewUrl);
    }
    setPendingImages((current) => current.filter((item) => item.idempotencyKey !== idempotencyKey));
    setUploadError("");
  }

  function closeUploadDrawer() {
    if (busy) return;
    setUploadDrawerOpen(false);
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
      const result = await response.json().catch(() => null) as { ok?: boolean; artwork?: CommunityOwnerArtwork; message?: string } | null;
      const artwork = result?.artwork;
      if (!response.ok || !result?.ok || !artwork) throw new Error(result?.message ?? "This image could not be submitted. Try again.");
      setArtworks((current) => [artwork, ...current.filter((item) => item.id !== artwork.id)]);
      if (!trackedSubmissions.current.has(item.idempotencyKey)) {
        trackedSubmissions.current.add(item.idempotencyKey);
        trackEvent("artwork_submitted");
      }
      removePending(item.idempotencyKey);
      return true;
    } catch (error) {
      const message = error instanceof Error && !(error instanceof TypeError)
        ? error.message
        : "This image could not be submitted. Check your connection and try again.";
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
    setUploadError("");
    let uploadedCount = 0;
    let failedCount = 0;
    for (const item of pendingImages) {
      if (item.validationError) continue;
      const payload = item.retryPayload ?? { productId, description: item.description.trim() };
      if (await uploadOne(item, payload)) uploadedCount += 1;
      else failedCount += 1;
    }
    if (failedCount) {
      showToast("error", uploadedCount
        ? `${uploadedCount} sent for review. Retry the images that could not be sent.`
        : "Your artwork could not be sent. You can retry each image.");
    } else if (uploadedCount) {
      showToast("success", `${uploadedCount === 1 ? "Artwork was" : `${uploadedCount} artworks were`} sent for review. Private until approved.`);
    }
    if (uploadedCount === pendingImages.length) {
      setRulesAccepted(false);
      setUploadDrawerOpen(false);
    }
    setBusy(false);
  }

  async function retryOne(item: PendingImage) {
    if (!canSubmit || !item.retryPayload || !rulesAccepted || busy) return;
    setBusy(true);
    setUploadError("");
    if (await uploadOne(item, item.retryPayload)) {
      showToast("success", "Artwork was sent for review. It stays private until approved.");
      if (pendingImages.length === 1) {
        setRulesAccepted(false);
        setUploadDrawerOpen(false);
      }
    } else {
      showToast("error", "This image could not be sent. Try again.");
    }
    setBusy(false);
  }

  async function saveDescription(artwork: CommunityOwnerArtwork) {
    const description = descriptionDrafts[artwork.id] ?? artwork.description;
    if (!canEdit || mutationBusy || description.trim() === artwork.description) return;
    setMutationBusy(true);
    setSavingId(artwork.id);
    try {
      const response = await fetch(`/api/community/artworks/${encodeURIComponent(artwork.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: artwork.revision, description }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; artwork?: CommunityOwnerArtwork; message?: string } | null;
      const updatedArtwork = payload?.artwork;
      if (!response.ok || !payload?.ok || !updatedArtwork) throw new Error(payload?.message ?? "Your description could not be saved.");
      setArtworks((current) => current.map((item) => item.id === artwork.id ? updatedArtwork : item));
      setDescriptionDrafts((current) => ({ ...current, [artwork.id]: updatedArtwork.description }));
      setEditingId(null);
      artworkActions.current.get(artwork.id)?.focus();
      showToast("success", updatedArtwork.status === "pending"
        ? "Your description was saved. This artwork is pending review again."
        : "Your description was saved.");
    } catch (error) {
      showToast("error", error instanceof Error && !(error instanceof TypeError) ? error.message : "Your description could not be saved. Try again.");
    } finally {
      setSavingId(null);
      setMutationBusy(false);
    }
  }

  async function deleteArtwork(artwork: CommunityOwnerArtwork) {
    if (!canDelete || mutationBusy) return;
    setMutationBusy(true);
    try {
      const response = await fetch(`/api/community/artworks/${encodeURIComponent(artwork.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: artwork.revision }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; message?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.message ?? "This artwork could not be deleted.");
      deleteDialogRef.current?.close();
      if (artworks.length > 1) artworkListTitleRef.current?.focus();
      else focusAfterLastDelete.current = true;
      setArtworks((current) => current.filter((item) => item.id !== artwork.id));
      setDeleteId(null);
      showToast("success", "Your artwork was deleted.");
    } catch (error) {
      deleteDialogRef.current?.close();
      artworkActions.current.get(artwork.id)?.focus();
      setDeleteId(null);
      showToast("error", error instanceof Error && !(error instanceof TypeError) ? error.message : "This artwork could not be deleted. Try again.");
    } finally {
      setMutationBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-6 sm:gap-8" data-testid="community-creation-manager">
      {canSubmit ? (
        <button
          type="button"
          ref={uploadTriggerRef}
          onClick={(event) => {
            event.currentTarget.focus();
            setUploadDrawerOpen(true);
          }}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-[var(--color-ink)] px-5 text-sm font-semibold text-white hover:bg-[var(--color-ink-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-terracotta)]"
          aria-haspopup="dialog"
          data-testid="community-upload-open"
        >
          <Plus className="size-4" aria-hidden />
          Share your art
        </button>
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

      <AdminDrawer
        open={canSubmit && uploadDrawerOpen}
        onClose={closeUploadDrawer}
        closeDisabled={busy}
        closeLabel="Close upload"
        title="Share your art"
        fitVisualViewport
        bodyClassName="min-w-0 overflow-x-hidden px-4 py-5 sm:px-8 sm:py-7"
        footer={(
          <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8">
            <button
              type="submit"
              form={UPLOAD_FORM_ID}
              disabled={busy || !pendingImages.some((item) => !item.validationError) || !productId || !rulesAccepted}
              className={`inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[var(--color-ink)] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_STYLE}`}
              data-testid="community-upload-submit"
            >
              {busy ? "Sending artwork…" : "Send for review"}
            </button>
          </div>
        )}
      >
        {canSubmit ? (
        <form id={UPLOAD_FORM_ID} className="grid min-w-0 grid-cols-1 gap-5" onSubmit={submit} data-testid="community-upload-form" aria-busy={busy}>
          <div className="grid min-w-0 gap-2">
            <label className="text-sm font-medium text-[var(--color-ink)]" htmlFor="community-product">Book</label>
            <select id="community-product" required value={productId} disabled={busy || pendingImages.some((item) => Boolean(item.retryPayload))} onChange={(event) => setProductId(event.currentTarget.value)} className={`min-h-11 w-full min-w-0 max-w-full truncate rounded-md border border-[var(--color-border)] bg-white px-3 text-base lg:text-sm ${FOCUS_STYLE}`} data-testid="community-product-select">
              <option value="">Choose an unlocked book</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}
            </select>
            <p className="text-sm text-[var(--color-muted)]">{products.length ? "Choose a book you’ve unlocked in My Library." : "No unlocked books are available for sharing."}</p>
          </div>

          <div
            className="grid min-w-0 place-items-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-alt)] p-4 text-center"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); if (!busy) addFiles(event.dataTransfer.files); }}
            data-testid="community-upload-dropzone"
          >
            <div className="grid justify-items-center gap-2">
              <input
                ref={inputRef}
                className="sr-only"
                id="community-artwork-files"
                aria-label="Artwork images"
                tabIndex={-1}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={busy}
                onChange={(event) => { if (event.currentTarget.files) addFiles(event.currentTarget.files); event.currentTarget.value = ""; }}
                data-testid="community-upload-file-input"
              />
              <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className={`inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-4 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-blush)] disabled:opacity-50 ${FOCUS_STYLE}`}>
                <Upload className="size-4" aria-hidden />
                Add photos
              </button>
              <p className="text-xs text-[var(--color-muted)]">Up to 3 photos, 4 MiB each. JPG, PNG, or WebP.</p>
            </div>
          </div>
          {uploadError ? <p className="text-sm text-[var(--color-error)]" role="alert">{uploadError}</p> : null}

          {pendingImages.length ? (
            <ul className="grid min-w-0 grid-cols-1 gap-3" aria-label="Selected artwork images" data-testid="community-selected-artworks">
              {pendingImages.map((item, index) => (
                <li key={item.idempotencyKey} className="grid min-w-0 content-start gap-3 rounded-lg border border-[var(--color-border)] bg-white p-3" data-testid="community-selected-artwork">
                  <div className="flex min-w-0 items-center gap-3">
                    {item.previewUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={item.previewUrl} alt={`Preview of ${item.file.name}`} className="size-16 shrink-0 rounded-md bg-[var(--color-bg-alt)] object-contain" />
                    ) : null}
                    <p className="line-clamp-2 min-w-0 flex-1 break-all text-sm font-medium text-[var(--color-ink)]">{item.file.name}</p>
                    <button type="button" disabled={busy} onClick={() => removePending(item.idempotencyKey)} className={`grid size-11 shrink-0 place-items-center rounded-full bg-[var(--color-bg-alt)] text-[var(--color-ink)] disabled:opacity-50 ${FOCUS_STYLE}`} aria-label={`Remove image ${item.file.name}`}>
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                  {!item.validationError ? <label className="grid min-w-0 gap-1 text-sm" htmlFor={`community-description-${item.idempotencyKey}`}>
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
                      className={`w-full min-w-0 rounded-md border border-[var(--color-border)] px-3 py-2 text-base lg:text-sm ${FOCUS_STYLE}`}
                      aria-describedby={item.validationError || item.requestError ? `community-file-error-${index}` : undefined}
                    />
                  </label> : null}
                  {item.validationError || item.requestError ? <p id={`community-file-error-${index}`} className="text-sm text-[var(--color-error)]" role="alert">{item.validationError ?? item.requestError}</p> : null}
                  {item.requestError && item.retryPayload ? <button type="button" disabled={busy || !rulesAccepted} onClick={() => void retryOne(item)} className={`min-h-11 justify-self-start rounded-sm text-sm font-medium text-[var(--color-ink)] underline underline-offset-4 disabled:opacity-50 ${FOCUS_STYLE}`} data-testid="community-artwork-retry">Retry this image</button> : null}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="grid gap-3 rounded-lg bg-[var(--color-bg-alt)] p-4 text-sm leading-6 text-[var(--color-ink)]">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
              <p>Photos stay private during review. Approved photos are public alongside your Coloring Club username. You can remove your photos in My Creations. Keep faces of children, personal details and locations out of the photo.</p>
            </div>
            <label className="flex min-h-11 items-start gap-3 font-medium">
              <input type="checkbox" checked={rulesAccepted} disabled={busy} onChange={(event) => setRulesAccepted(event.currentTarget.checked)} className="mt-1 size-5 shrink-0 accent-[var(--color-terracotta)]" data-testid="community-upload-rules" />
              <span>I took these photos of my own coloring and accept the community guidelines for publishing them.</span>
            </label>
            <Link href={guidelinesHref} target="_blank" rel="noopener noreferrer" className={`justify-self-start rounded-sm font-medium underline underline-offset-4 ${FOCUS_STYLE}`}>Read the community guidelines (opens in a new tab)</Link>
          </div>
        </form>
        ) : null}
      </AdminDrawer>

      {artworks.length ? (
        <section aria-labelledby="my-creations-list-title" data-testid="community-my-artworks">
          <h2 id="my-creations-list-title" ref={artworkListTitleRef} tabIndex={-1} className="mb-4 font-serif text-2xl font-semibold text-[var(--color-ink)]">Your artwork</h2>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {artworks.map((artwork) => {
              const description = descriptionDrafts[artwork.id] ?? artwork.description;
              return (
                <li key={artwork.id} className="min-w-0">
                  <article className="grid min-w-0 grid-cols-1 rounded-xl border border-[var(--color-border)] bg-white" data-testid="community-artwork-card">
                    <div className="relative aspect-[4/3] w-full max-h-[220px] overflow-hidden rounded-t-xl bg-[var(--color-bg-alt)] lg:max-h-none">
                      {/* The app media route rechecks current visibility on every byte request. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/community/artworks/${encodeURIComponent(artwork.id)}/media`} alt={`Your artwork for ${artwork.product.title}`} loading="lazy" className="absolute inset-0 size-full object-contain" data-testid="community-artwork-preview" />
                    </div>
                    <div className="grid min-w-0 content-start gap-3 p-4">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[artwork.status]}`}>{statusLabel(artwork.status)}</span>
                          <h3 className="mt-2 line-clamp-2 font-serif text-xl font-semibold leading-tight break-words text-[var(--color-ink)]">{artwork.product.title}</h3>
                          <p className="mt-1 text-xs text-[var(--color-muted)]">Updated <time dateTime={artwork.updatedAt}>{formatDate(artwork.updatedAt)}</time></p>
                        </div>
                        {canEdit || canDelete ? (
                          <div
                            className="relative shrink-0"
                            onBlur={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget)) setActionId((current) => current === artwork.id ? null : current);
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== "Escape" || actionId !== artwork.id) return;
                              event.stopPropagation();
                              setActionId(null);
                              artworkActions.current.get(artwork.id)?.focus();
                            }}
                          >
                            <button
                              ref={(button) => {
                                if (button) artworkActions.current.set(artwork.id, button);
                                else artworkActions.current.delete(artwork.id);
                              }}
                              type="button"
                              aria-label={`Actions for ${artwork.product.title}`}
                              aria-expanded={actionId === artwork.id}
                              aria-controls={actionId === artwork.id ? `creation-actions-${artwork.id}` : undefined}
                              aria-disabled={mutationBusy || undefined}
                              onClick={(event) => {
                                if (mutationBusy) return;
                                event.currentTarget.focus();
                                setActionId(actionId === artwork.id ? null : artwork.id);
                              }}
                              className={`grid size-11 place-items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-blush)] aria-disabled:opacity-50 ${FOCUS_STYLE}`}
                              data-testid="community-artwork-actions"
                            >
                              <Ellipsis className="size-5" aria-hidden />
                            </button>
                            {actionId === artwork.id ? (
                              <div id={`creation-actions-${artwork.id}`} className="absolute right-0 z-10 mt-1 grid w-44 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-md">
                                {canEdit && editingId !== artwork.id ? <button type="button" disabled={mutationBusy} onClick={() => { setActionId(null); setEditingId(artwork.id); }} className={`min-h-11 rounded px-3 text-left text-sm hover:bg-[var(--color-blush)] ${FOCUS_STYLE}`} data-testid="community-artwork-edit-description">Edit description</button> : null}
                                {canDelete ? <button type="button" disabled={mutationBusy} onClick={() => { setActionId(null); setDeleteId(artwork.id); }} className={`min-h-11 rounded px-3 text-left text-sm text-[var(--color-error)] hover:bg-[var(--color-error-bg)] ${FOCUS_STYLE}`} data-testid="community-artwork-delete">Delete artwork</button> : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      {editingId === artwork.id && canEdit ? (
                        <label className="grid min-w-0 gap-2 text-sm font-medium text-[var(--color-ink)]">
                          Description
                          {artwork.status === "approved" || artwork.status === "rejected" ? (
                            <span className="text-xs font-normal text-[var(--color-muted)]">Saving sends this artwork for review again.</span>
                          ) : null}
                          <textarea
                            ref={editingDescriptionRef}
                            rows={3}
                            maxLength={240}
                            disabled={mutationBusy}
                            value={description}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setDescriptionDrafts((current) => ({ ...current, [artwork.id]: value }));
                            }}
                            className={`min-w-0 rounded-md border border-[var(--color-border)] px-3 py-2 text-base font-normal lg:text-sm ${FOCUS_STYLE}`}
                            data-testid="community-artwork-description"
                          />
                        </label>
                      ) : (
                        <p className="break-words text-sm leading-6 text-[var(--color-muted)]">{artwork.description || "No description added."}</p>
                      )}
                      {artwork.rejectionReason ? (
                        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-alt)] p-2.5">
                          <h4 className="text-xs font-semibold text-[var(--color-ink)]">Private review reason</h4>
                          <p className="mt-1 break-words text-xs leading-5 text-[var(--color-muted)]">{artwork.rejectionReason}</p>
                        </div>
                      ) : null}
                      {editingId === artwork.id && canEdit ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <button type="button" disabled={mutationBusy || description.trim() === artwork.description} onClick={() => void saveDescription(artwork)} className={`min-h-11 rounded-md bg-[var(--color-ink)] px-3 text-sm font-medium text-white disabled:opacity-50 ${FOCUS_STYLE}`} data-testid="community-artwork-save-description">
                            {savingId === artwork.id ? "Saving…" : "Save description"}
                          </button>
                          <button type="button" disabled={mutationBusy} onClick={() => { setEditingId(null); setDescriptionDrafts((current) => ({ ...current, [artwork.id]: artwork.description })); artworkActions.current.get(artwork.id)?.focus(); }} className={`min-h-11 rounded-md px-3 text-sm font-medium text-[var(--color-ink)] underline underline-offset-4 disabled:opacity-50 ${FOCUS_STYLE}`}>Cancel</button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <section className="rounded-xl border border-[var(--color-border)] bg-white p-5" data-testid="community-my-artworks-empty">
          <h2 ref={emptyStateTitleRef} tabIndex={-1} className="font-serif text-2xl font-semibold text-[var(--color-ink)]">No creations yet</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">Your submissions and private review status will appear here.</p>
          {!communityMember ? <Link className="mt-3 inline-flex font-medium underline underline-offset-4" href={accountHref}>Join the Coloring Club</Link> : null}
          <Link className="mt-3 inline-flex font-medium underline underline-offset-4" href={libraryHref}>Open My Library</Link>
        </section>
      )}
      <dialog
        ref={deleteDialogRef}
        aria-labelledby="community-delete-title"
        aria-describedby="community-delete-description"
        onCancel={(event) => { event.preventDefault(); closeDeleteDialog(); }}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-[var(--color-ink)] shadow-xl backdrop:bg-black/30"
      >
        {artworkToDelete ? (
          <div className="grid gap-3">
            <h2 id="community-delete-title" className="font-serif text-2xl font-semibold">Delete artwork?</h2>
            <p id="community-delete-description" className="text-sm leading-6">This artwork will be removed from My Creations and from any public gallery where it appears.</p>
            <div className="flex flex-wrap gap-2">
              <button ref={keepArtworkRef} type="button" disabled={mutationBusy} onClick={closeDeleteDialog} className={`min-h-11 rounded-md border border-[var(--color-border)] px-3 text-sm font-medium disabled:opacity-50 ${FOCUS_STYLE}`}>Keep artwork</button>
              <button type="button" disabled={mutationBusy} onClick={() => void deleteArtwork(artworkToDelete)} className={`min-h-11 rounded-md bg-[var(--color-error)] px-3 text-sm font-medium text-white disabled:opacity-50 ${FOCUS_STYLE}`} data-testid="community-artwork-confirm-delete">{mutationBusy ? "Deleting…" : "Delete artwork"}</button>
            </div>
          </div>
        ) : null}
      </dialog>
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
