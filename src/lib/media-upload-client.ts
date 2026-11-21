"use client";

import { Upload } from "tus-js-client";

import { createClient, getClientPublicEnv } from "./supabase/client";

export type SupabaseTusUploadTarget = {
  driver: "supabase-tus";
  endpoint: string;
  token: string;
  bucket: string;
  path: string;
};

export type SignedMediaUploadTarget =
  | SupabaseTusUploadTarget
  | {
    driver: "r2-mirrored";
    r2: {
      url: string;
      headers: Record<string, string>;
    };
    supabase: SupabaseTusUploadTarget;
  };

export function getMediaErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  const status = getErrorStatus(error);

  if (
    status === 401 ||
    status === 403 ||
    /unauthorized|forbidden|invalid compact jws|session.*expired|\b(jwt|token)\b/i.test(message)
  ) {
    return "Sesja administratora wygasła. Zaloguj się ponownie.";
  }

  return fallback;
}

export function getMediaUploadErrorMessage(error: unknown) {
  return getMediaErrorMessage(error, "Nie udało się przesłać pliku. Spróbuj ponownie.");
}

export async function uploadMedia(
  file: File,
  target: SignedMediaUploadTarget,
  contentType: string,
  onProgress: (percentage: number) => void,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (target.driver === "r2-mirrored") {
    await uploadR2Put(file, target.r2, (progress) => onProgress(Math.round(progress * 0.5)), signal);
    await uploadTus(file, target.supabase, contentType, (progress) => {
      onProgress(50 + Math.round(progress * 0.5));
    }, signal);
    return;
  }

  await uploadTus(file, target, contentType, onProgress, signal);
}

function uploadR2Put(
  file: File,
  target: { url: string; headers: Record<string, string> },
  onProgress: (percentage: number) => void,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const finish = (error?: Error) => {
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    request.open("PUT", target.url);
    for (const [name, value] of Object.entries(target.headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      onProgress(event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : 0);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) finish();
      else finish(new Error(`R2 upload failed with status ${request.status}.`));
    };
    request.onerror = () => finish(new Error("R2 upload network request failed."));
    request.onabort = () => finish(new Error("R2 upload was cancelled."));
    signal?.addEventListener("abort", abort, { once: true });
    request.send(file);
  });
}

async function uploadTus(
  file: File,
  target: SupabaseTusUploadTarget,
  contentType: string,
  onProgress: (percentage: number) => void,
  signal?: AbortSignal,
) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (error || !accessToken) {
    throw new Error("Sesja administratora wygasła. Zaloguj się ponownie.");
  }

  signal?.throwIfAborted();
  const { supabasePublishableKey } = getClientPublicEnv();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => {
      void upload.abort().then(() => finish(new DOMException("Upload cancelled", "AbortError")), (error: Error) => finish(error));
    };
    const upload = new Upload(file, {
      endpoint: target.endpoint,
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey: supabasePublishableKey,
        "x-signature": target.token,
      },
      metadata: {
        bucketName: target.bucket,
        objectName: target.path,
        contentType,
        cacheControl: "31536000",
      },
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      onProgress: (bytesSent, bytesTotal) => {
        onProgress(bytesTotal ? Math.round((bytesSent / bytesTotal) * 100) : 0);
      },
      onSuccess: () => finish(),
      onError: finish,
    });

    signal?.addEventListener("abort", abort, { once: true });
    upload.findPreviousUploads()
      .then((previousUploads) => {
        if (settled || signal?.aborted) return;
        if (previousUploads.length) {
          upload.resumeFromPreviousUpload(previousUploads[0]);
        }
        upload.start();
      })
      .catch(finish);
  });
}

function getErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const response = (error as { originalResponse?: { getStatus?: () => number } }).originalResponse;
  return typeof response?.getStatus === "function" ? response.getStatus() : undefined;
}
