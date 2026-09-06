import type { AssetKind, ProductAsset } from "./types";

export const MAX_GALLERY_ASSETS = 20;

export const MEDIA_UPLOAD_SPECS: Record<
  ProductAsset["kind"],
  {
    bucket: string;
    maxBytes: number;
    multiple: boolean;
    accept: string;
    allowedMimeTypes: readonly string[];
  }
> = {
  cover: {
    bucket: "public-media",
    maxBytes: 20 * 1024 * 1024,
    multiple: false,
    accept: "image/png,image/jpeg,image/webp",
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  },
  gallery: {
    bucket: "public-media",
    maxBytes: 20 * 1024 * 1024,
    multiple: true,
    accept: "image/png,image/jpeg,image/webp",
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  },
  video: {
    bucket: "public-videos",
    maxBytes: 50 * 1024 * 1024,
    multiple: false,
    accept: "video/mp4,video/webm",
    allowedMimeTypes: ["video/mp4", "video/webm"],
  },
  public_download: {
    bucket: "public-media",
    maxBytes: 20 * 1024 * 1024,
    multiple: true,
    accept: "application/pdf,image/png,image/jpeg,image/webp",
    allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
  },
  premium_download: {
    bucket: "premium-files",
    maxBytes: 50 * 1024 * 1024,
    multiple: true,
    accept: "application/pdf,image/png,image/jpeg,image/webp",
    allowedMimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
  },
};

export type UploadValidation =
  | { ok: true; contentType: string }
  | { ok: false; error: string };

export function validateMediaFile(
  kind: AssetKind,
  file: Pick<File, "name" | "size" | "type">,
): UploadValidation {
  const spec = MEDIA_UPLOAD_SPECS[kind];
  const contentType = file.type || inferContentType(file.name);

  if (!contentType || !spec.allowedMimeTypes.includes(contentType)) {
    return {
      ok: false,
      error: `Plik „${file.name}” ma niedozwolony format dla tej sekcji.`,
    };
  }

  if (file.size <= 0) {
    return { ok: false, error: `Plik „${file.name}” jest pusty.` };
  }

  if (file.size > spec.maxBytes) {
    return {
      ok: false,
      error: `Plik „${file.name}” jest za duży. Maksymalny rozmiar to ${formatBytes(spec.maxBytes)}.`,
    };
  }

  return { ok: true, contentType };
}

export function formatBytes(bytes: number | undefined) {
  if (!bytes || bytes < 1024) {
    return bytes ? `${bytes} B` : "—";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function mediaBucketForKind(kind: AssetKind) {
  return MEDIA_UPLOAD_SPECS[kind].bucket;
}

export function filenameWithCollisionSuffix(filename: string, suffix: number) {
  if (!suffix) return filename;
  const extensionMatch = filename.match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1] ?? "";
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  return `${stem}_${suffix}${extension}`;
}

export function isMediaKind(value: string): value is AssetKind {
  return Object.prototype.hasOwnProperty.call(MEDIA_UPLOAD_SPECS, value);
}

function inferContentType(filename: string) {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";

  return "";
}
