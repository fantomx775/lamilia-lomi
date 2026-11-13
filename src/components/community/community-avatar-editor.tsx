"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { AVATAR_EDGE, AVATAR_INPUT_TYPES, AVATAR_MAX_BYTES, AVATAR_MAX_PIXELS, isAvatarInputType, type AvatarView } from "@/lib/community/avatar-contract";
import { CommunityAvatar } from "./community-avatar";

type Crop = { x: number; y: number; zoom: number };
const CENTER: Crop = { x: 50, y: 50, zoom: 1 };
const ENDPOINT = "/api/community/avatars";

function drawCrop(canvas: HTMLCanvasElement, image: HTMLImageElement, crop: Crop) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not prepare the photo.");
  const side = Math.min(image.naturalWidth, image.naturalHeight) / crop.zoom;
  context.clearRect(0, 0, AVATAR_EDGE, AVATAR_EDGE);
  context.drawImage(image,
    (image.naturalWidth - side) * crop.x / 100, (image.naturalHeight - side) * crop.y / 100,
    side, side, 0, 0, AVATAR_EDGE, AVATAR_EDGE);
}

export function CommunityAvatarEditor({ username, seed, canUpload = true }: {
  username: string; seed: string; canUpload?: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const objectUrl = useRef<string | null>(null);
  const { showToast } = useToast();
  const [avatar, setAvatar] = useState<AvatarView>();
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [source, setSource] = useState<HTMLImageElement>();
  const [crop, setCrop] = useState(CENTER);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(ENDPOINT, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load your profile photo.");
        const data = await response.json();
        if (!controller.signal.aborted) setAvatar(data.avatar);
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  useEffect(() => {
    if (source && previewRef.current) drawCrop(previewRef.current, source, crop);
  }, [source, crop]);

  function clearCrop() {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    if (inputRef.current) inputRef.current.value = "";
    setSource(undefined);
    setCrop(CENTER);
  }

  async function selectPhoto(file?: File) {
    if (!file) return;
    clearCrop();
    setConfirmRemove(false);
    setError("");
    if (!isAvatarInputType(file.type) || file.size > AVATAR_MAX_BYTES) {
      setError("Choose a JPG, PNG, or WebP image up to 4 MiB.");
      return;
    }

    const url = URL.createObjectURL(file);
    objectUrl.current = url;
    const image = new window.Image();
    image.src = url;
    try {
      await image.decode();
      if (objectUrl.current !== url) return;
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > AVATAR_MAX_PIXELS) {
        throw new Error("This photo is too large to process.");
      }
      setSource(image);
    } catch (caught) {
      if (objectUrl.current !== url) return;
      clearCrop();
      setError(caught instanceof Error ? caught.message : "This photo could not be opened.");
    }
  }

  async function mutate(method: "POST" | "DELETE") {
    setBusy(true);
    setError("");
    try {
      let body: Blob | undefined;
      if (method === "POST") {
        if (!previewRef.current) throw new Error("Choose a photo first.");
        const canvas = previewRef.current;
        body = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("This photo could not be prepared."));
          }, "image/webp", 0.9);
        });
      }
      const response = await fetch(ENDPOINT, {
        method, ...(body ? { body, headers: { "Content-Type": body.type } } : {}),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.avatar) throw new Error(payload?.message || "Your profile photo could not be updated. Try again.");
      setAvatar(payload.avatar);
      clearCrop();
      router.refresh();
      setConfirmRemove(false);
      showToast("success", method === "POST" ? "Profile photo saved." : "Profile photo removed.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Your profile photo could not be updated.";
      setError(message);
      showToast("error", message);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return (
    <div className="grid gap-2">
      <p role="alert" className="text-sm">Your profile photo could not be loaded.</p>
      <Button type="button" variant="outline" className="w-fit" onClick={() => { setLoadError(false); setReload((value) => value + 1); }}>Retry</Button>
    </div>
  );
  if (!avatar) return <p className="text-sm text-[var(--color-muted)]" role="status">Loading profile photo…</p>;

  return (
    <section aria-labelledby={`${id}-title`} className="grid min-w-0 gap-3 rounded-lg border border-[var(--color-border)] p-3">
      <div className="flex items-center gap-3">
        <CommunityAvatar username={username} seed={seed} photoSrc={avatar.approvedId ? `${ENDPOINT}/${avatar.approvedId}?owner=1` : undefined} />
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="font-medium">Profile photo</h3>
          {avatar.pending ? <p className="text-sm text-[var(--color-muted)]" role="status">Your previous photo is unpublished. Choose a photo to publish it immediately.</p> : null}
          {avatar.rejected ? <p className="text-sm text-[var(--color-muted)]" role="status">Your previous photo is unavailable. You can choose another.</p> : null}
        </div>
      </div>
      {canUpload ? (
        <>
          <input ref={inputRef} type="file" accept={AVATAR_INPUT_TYPES.join(",")} disabled={busy}
            onChange={(event) => { void selectPhoto(event.currentTarget.files?.[0]); }} className="hidden" />
          <Button type="button" variant="outline" className="w-fit" disabled={busy}
            onClick={() => inputRef.current?.click()}>
            {avatar.approvedId || avatar.pending ? "Change photo" : "Choose a photo"}
          </Button>
          <p className="text-sm text-[var(--color-muted)]">Saved photos are immediately visible on your public creator profile. Choose an image without children’s faces, names, or location details.</p>
        </>
      ) : null}
      {source ? (
        <fieldset disabled={busy} className="grid min-w-0 gap-3">
          <legend className="font-medium">Crop your photo</legend>
          <canvas ref={previewRef} width={AVATAR_EDGE} height={AVATAR_EDGE} role="img" aria-label="Circular crop preview"
            className="size-40 max-w-full rounded-full bg-[var(--color-bg-alt)]" />
          {([
            { key: "zoom", label: "Zoom", min: 1, max: 3, step: 0.05 },
            { key: "x", label: "Horizontal position", min: 0, max: 100, step: 1 },
            { key: "y", label: "Vertical position", min: 0, max: 100, step: 1 },
          ] as const).map(({ key, label, min, max, step }) => (
            <label key={key} className="grid gap-1 text-sm">
              {label}
              <input type="range" min={min} max={max} step={step} value={crop[key]}
                onChange={(event) => setCrop({ ...crop, [key]: event.currentTarget.valueAsNumber })} />
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => { void mutate("POST"); }}>{busy ? "Sending…" : "Save photo"}</Button>
            <Button type="button" variant="ghost" onClick={clearCrop}>Cancel</Button>
          </div>
        </fieldset>
      ) : null}
      {avatar.approvedId || avatar.pending || avatar.rejected ? (
        confirmRemove ? (
          <div className="grid gap-2">
            <p className="text-sm">Remove your profile photo?</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => { void mutate("DELETE"); }}>{busy ? "Removing…" : "Confirm removal"}</Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="ghost" className="w-fit" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove photo</Button>
        )
      ) : null}
      {error ? <p role="alert" className="text-sm text-red-800">{error}</p> : null}
    </section>
  );
}
