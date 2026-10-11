import "server-only";

import { ADMIN_ERROR_CODES, type AdminErrorCode } from "@/lib/admin-errors";
import type { AssetKind } from "@/lib/types";

import { readImageDimensionsFromBytes } from "./image-file-dimensions";
import { validateImageDimensions } from "./image-ratios";
import { validateMediaFile } from "./media-upload";

export type ImageUploadValidation =
  | { ok: true }
  | { ok: false; errorCode: AdminErrorCode };

export async function validateImageUploadBytes(input: {
  kind: Extract<AssetKind, "cover" | "gallery">;
  filename: string;
  expectedContentType: string;
  bytes: Uint8Array;
}): Promise<ImageUploadValidation> {
  const dimensions = await readImageDimensionsFromBytes(input.bytes);
  if (!dimensions || dimensions.contentType !== input.expectedContentType) {
    return { ok: false, errorCode: ADMIN_ERROR_CODES.VALIDATION_ASSET_FILE };
  }

  const mediaValidation = validateMediaFile(input.kind, {
    name: input.filename,
    size: input.bytes.byteLength,
    type: dimensions.contentType,
  });
  if (!mediaValidation.ok) {
    return { ok: false, errorCode: ADMIN_ERROR_CODES.VALIDATION_ASSET_FILE };
  }

  const ratioValidation = validateImageDimensions(input.kind, dimensions);
  if (!ratioValidation.ok) {
    return { ok: false, errorCode: ADMIN_ERROR_CODES.VALIDATION_IMAGE_DIMENSIONS };
  }

  return { ok: true };
}
