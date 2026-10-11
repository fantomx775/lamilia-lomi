import type { ImageDimensions } from "./image-ratios";
import sharp from "sharp";

const MAX_IMAGE_PIXELS = 40_000_000;

export type DecodedImageDimensions = ImageDimensions & { contentType: string };

export async function readImageDimensionsFromBytes(bytes: Uint8Array): Promise<DecodedImageDimensions | null> {
  if (bytes.byteLength === 0) return null;

  try {
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: MAX_IMAGE_PIXELS });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) return null;

    const contentType = getSupportedContentType(metadata.format);
    if (!contentType) return null;

    // Metadata parsing alone accepts truncated files; pixel statistics force a full decode.
    await image.stats();

    return { width: metadata.width, height: metadata.height, contentType };
  } catch {
    return null;
  }
}

function getSupportedContentType(format: string | undefined) {
  switch (format) {
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    default: return null;
  }
}
