import sharp from "sharp";

const MAX_INPUT_PIXELS = 40_000_000;
const FORMATS_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function hasValidCollectionImageContent(bytes: Uint8Array, contentType: string) {
  const expectedFormat = FORMATS_BY_CONTENT_TYPE[contentType];
  if (!expectedFormat || bytes.byteLength === 0) return false;

  try {
    const input = Buffer.from(bytes);
    const options = { failOn: "warning" as const, limitInputPixels: MAX_INPUT_PIXELS };
    const metadata = await sharp(input, options).metadata();
    if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) return false;

    await sharp(input, options).stats();
    return true;
  } catch {
    return false;
  }
}
