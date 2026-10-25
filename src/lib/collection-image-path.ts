import { mediaFilenameForStorage } from "./media-upload";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLLECTION_IMAGE_PATH_PATTERN = /^(collections|reader-artworks)\/([0-9a-f-]{36})\/image\/([0-9a-f-]{36})-([A-Za-z0-9_-]+\.(?:png|jpe?g|webp))$/i;

export function createCollectionImagePath(
  collectionId: string,
  imageId: string,
  filename: string,
  contentType: string,
  namespace: "collections" | "reader-artworks" = "collections",
) {
  if (!UUID_PATTERN.test(collectionId) || !UUID_PATTERN.test(imageId)) {
    throw new Error("Invalid collection image identity.");
  }

  const extension = contentType === "image/png"
    ? ".png"
    : contentType === "image/jpeg"
      ? ".jpg"
      : contentType === "image/webp"
        ? ".webp"
        : null;
  if (!extension) throw new Error("Invalid collection image content type.");

  const safeFilename = mediaFilenameForStorage(filename);
  const stem = safeFilename.replace(/\.[A-Za-z0-9]+$/, "");
  return `${namespace}/${collectionId}/image/${imageId}-${stem}${extension}`;
}

export function isSafeCollectionImagePath(value: string, collectionId?: string, namespace: "collections" | "reader-artworks" = "collections") {
  const match = COLLECTION_IMAGE_PATH_PATTERN.exec(value);
  if (!match || match[1] !== namespace || !UUID_PATTERN.test(match[2]) || !UUID_PATTERN.test(match[3])) return false;
  return !collectionId || match[2].toLowerCase() === collectionId.toLowerCase();
}

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}
