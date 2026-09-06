"use client";

import { Upload } from "tus-js-client";

import { createClient, getClientPublicEnv } from "./supabase/client";

export type SignedMediaUploadTarget = {
  endpoint: string;
  token: string;
  bucket: string;
  path: string;
};

export async function uploadMediaWithTus(
  file: File,
  target: SignedMediaUploadTarget,
  contentType: string,
  onProgress: (percentage: number) => void,
) {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (error || !accessToken) {
    throw new Error("Sesja administratora wygasła. Zaloguj się ponownie.");
  }

  const { supabasePublishableKey } = getClientPublicEnv();

  await new Promise<void>((resolve, reject) => {
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
      onSuccess: () => resolve(),
      onError: reject,
    });

    upload.findPreviousUploads()
      .then((previousUploads) => {
        if (previousUploads.length) {
          upload.resumeFromPreviousUpload(previousUploads[0]);
        }
        upload.start();
      })
      .catch(reject);
  });
}
