import sharp from "sharp";
import { AVATAR_EDGE, AVATAR_MAX_BYTES, AVATAR_MAX_PIXELS, isAvatarInputType } from "./avatar-contract";
import { CommunityValidationError } from "./errors";

export async function normalizeAvatarImage(bytes: Uint8Array, contentType: string) {
  if (!isAvatarInputType(contentType) || !bytes.byteLength || bytes.byteLength > AVATAR_MAX_BYTES) {
    throw new CommunityValidationError("Choose a JPG, PNG, or WebP image up to 4 MiB.");
  }
  try {
    const image = sharp(Buffer.from(bytes), { failOn: "warning", limitInputPixels: AVATAR_MAX_PIXELS });
    const { width, height, format, pages } = await image.metadata();
    const actualContentType = format === "jpeg" ? "image/jpeg" : `image/${format}`;
    if (actualContentType !== contentType || !width || !height || width * height > AVATAR_MAX_PIXELS || (pages ?? 1) > 1) {
      throw new Error("Invalid photo metadata");
    }
    return await image.autoOrient().resize(AVATAR_EDGE, AVATAR_EDGE, { fit: "cover", position: "centre" })
      .toColourspace("srgb").webp({ quality: 82 }).toBuffer();
  } catch {
    throw new CommunityValidationError("Choose a valid, still JPG, PNG, or WebP image.");
  }
}
