import type { FFmpeg } from "@ffmpeg/ffmpeg";
import type { AssetKind } from "./types";

const CORE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/";
const CORE_FILES = [
  ["ffmpeg-core.js", "sha384-9KlAmgHu5wDqdgQvFhQGZOtKdCwGcMppDhM/kBkUpZ5LS7KGuAHbE+NgtJQEf84i", "text/javascript"],
  ["ffmpeg-core.wasm", "sha384-U1VDhkPYrM3wTCT4/vjSpSsKqG/UjljYrYCI4hBSJ02svbCkxuCi6U6u/peg5vpW", "application/wasm"],
] as const;

let imageEncoding = Promise.resolve();

export async function optimizeProductMedia(kind: AssetKind, file: File): Promise<File> {
  if (kind === "cover" || kind === "gallery") {
    const result = imageEncoding.then(() => optimizeProductImage(file));
    imageEncoding = result.then(() => undefined, () => undefined);
    return result;
  }

  if (kind !== "video") return file;

  const signal = AbortSignal.timeout(60_000);
  const encoder = await createVideoEncoder(signal);
  const coreObjectUrls: string[] = [];
  try {
    const binaries = await Promise.all(CORE_FILES.map(async ([name, integrity, contentType]) => {
      const response = await fetch(CORE_URL + name, { integrity, signal });
      if (!response.ok) throw new Error("Nie udało się pobrać enkodera wideo.");
      return new Blob([await response.arrayBuffer()], { type: contentType });
    }));
    coreObjectUrls.push(...binaries.map((binary) => URL.createObjectURL(binary)));
    await encoder.load({
      classWorkerURL: new URL("/admin-video-encoder/worker.js", window.location.origin).href,
      coreURL: coreObjectUrls[0],
      wasmURL: coreObjectUrls[1],
    }, { signal });
    const encodingSignal = AbortSignal.timeout(420_000);
    await encoder.writeFile("input", new Uint8Array(await file.arrayBuffer()), { signal: encodingSignal });
    const result = await encoder.exec([
      "-i", "input",
      "-map", "0:v:0", "-map", "0:a:0?",
      "-vf", "scale='trunc(iw*min(1,min(1280/iw,720/ih))/2)*2':'trunc(ih*min(1,min(1280/iw,720/ih))/2)*2'",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
      "-maxrate", "1800k", "-bufsize", "1800k", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "preview.mp4",
    ], 360_000, { signal: encodingSignal });
    if (result !== 0) throw new Error("Nie udało się przygotować podglądu wideo MP4.");
    const output = await encoder.readFile("preview.mp4", "binary", { signal: encodingSignal });
    if (typeof output === "string" || output.byteLength === 0) {
      throw new Error("Konwersja wideo zwróciła pusty plik.");
    }
    return new File([new Uint8Array(output)], withExtension(file.name, "mp4"), { type: "video/mp4" });
  } finally {
    encoder.terminate();
    coreObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
}

async function optimizeProductImage(file: File): Promise<File> {
  if (file.type === "image/webp" || typeof createImageBitmap !== "function") return file;
  const image = await createImageBitmap(file).catch(() => null);
  if (!image) return file;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(image, 0, 0);
    const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
    return webp?.type === "image/webp" && webp.size < file.size
      ? new File([webp], withExtension(file.name, "webp"), { type: "image/webp" })
      : file;
  } finally {
    image.close();
  }
}

async function createVideoEncoder(signal: AbortSignal): Promise<FFmpeg> {
  const scope = window as Window & { FFmpegWASM?: { FFmpeg: new () => FFmpeg } };
  if (!scope.FFmpegWASM) {
    const script = document.createElement("script");
    script.src = "/admin-video-encoder/ffmpeg.js";
    const error = new Error("Nie udało się uruchomić enkodera wideo.");
    try {
      await new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        signal.addEventListener("abort", () => reject(error), { once: true });
        script.onload = () => resolve();
        script.onerror = () => reject(error);
        document.head.append(script);
      });
    } finally {
      script.remove();
    }
  }
  if (!scope.FFmpegWASM) throw new Error("Brakuje enkodera wideo.");
  return new scope.FFmpegWASM.FFmpeg();
}

function withExtension(filename: string, extension: string) {
  return filename.replace(/\.[^.]+$/, "") + "." + extension;
}
