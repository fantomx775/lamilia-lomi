"use client";

import { Upload } from "tus-js-client";

export type SignedMediaUploadTarget = {
  endpoint: string;
  token: string;
  bucket: string;
  path: string;
};

export function uploadMediaWithTus(
  file: File,
  target: SignedMediaUploadTarget,
  contentType: string,
  onProgress: (percentage: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: target.endpoint,
      headers: { "x-signature": target.token },
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
