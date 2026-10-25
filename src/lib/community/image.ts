import crypto from "node:crypto";
import sharp from "sharp";

import { CommunityValidationError } from "./errors";
import type { CommunityImageContentType } from "./types";

export const COMMUNITY_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const COMMUNITY_IMAGE_MAX_PIXELS = 40_000_000;
export const COMMUNITY_IMAGE_MAX_EDGE = 2048;
export const COMMUNITY_IMAGE_OUTPUT_TYPE: CommunityImageContentType = "image/webp";

const formats: Record<CommunityImageContentType, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function normalizeCommunityArtworkImage(
  bytes: Uint8Array,
  declaredContentType: string,
) {
  if (bytes.byteLength === 0 || bytes.byteLength > COMMUNITY_IMAGE_MAX_BYTES) {
    throw new CommunityValidationError("Choose an image no larger than 4 MiB.");
  }
  if (!(declaredContentType in formats)) {
    throw new CommunityValidationError("Use a JPG, PNG, or WebP image.");
  }

  try {
    const input = Buffer.from(bytes);
    if (!hasSupportedImageSignature(input, declaredContentType as CommunityImageContentType)) {
      throw new CommunityValidationError("The image content does not match its file type.");
    }
    // Metadata inspection reads only the bounded image header; verify dimensions before enabling decode.
    const decoder = sharp(input, { failOn: "warning" });
    const metadata = await decoder.metadata();
    if (metadata.format !== formats[declaredContentType as CommunityImageContentType]) {
      throw new CommunityValidationError("The image content does not match its file type.");
    }
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > COMMUNITY_IMAGE_MAX_PIXELS) {
      throw new CommunityValidationError("This image is too large to process.");
    }
    if ((metadata.pages ?? 1) !== 1) {
      throw new CommunityValidationError("Animated or multi-page images are not supported.");
    }

    const normalized = await sharp(input, {
      failOn: "warning",
      limitInputPixels: COMMUNITY_IMAGE_MAX_PIXELS,
    })
      .rotate()
      .resize({ width: COMMUNITY_IMAGE_MAX_EDGE, height: COMMUNITY_IMAGE_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    if (!normalized.info.width || !normalized.info.height || normalized.data.byteLength > COMMUNITY_IMAGE_MAX_BYTES) {
      throw new CommunityValidationError("This image could not be safely prepared. Choose a smaller image.");
    }
    return {
      bytes: new Uint8Array(normalized.data),
      contentType: COMMUNITY_IMAGE_OUTPUT_TYPE,
      width: normalized.info.width,
      height: normalized.info.height,
      originalSha256: sha256(input),
      normalizedSha256: sha256(normalized.data),
    } as const;
  } catch (error) {
    if (error instanceof CommunityValidationError) throw error;
    throw new CommunityValidationError("This image could not be opened. Choose a valid JPG, PNG, or WebP image.");
  }
}

function hasSupportedImageSignature(bytes: Buffer, contentType: CommunityImageContentType) {
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") return bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  return bytes.length >= 12
    && bytes.toString("ascii", 0, 4) === "RIFF"
    && bytes.toString("ascii", 8, 12) === "WEBP";
}

export function communityUploadFingerprint(input: {
  originalSha256: string;
  normalizedSha256: string;
  productId: string;
  description: string;
}) {
  return sha256(`${input.originalSha256}\n${input.normalizedSha256}\n${input.productId}\n${input.description.trim()}`);
}

function sha256(value: Uint8Array | string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
