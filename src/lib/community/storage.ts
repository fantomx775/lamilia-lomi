import "server-only";

import {
  readCollectionImage,
  removeCollectionImage,
  storeCollectionImage,
} from "../collection-image-storage";
import type { CommunityImageContentType, CommunityStorageProvider } from "./types";

export async function storeCommunityArtworkImage(input: {
  authorId: string;
  idempotencyKey: string;
  bytes: Uint8Array;
  contentType: CommunityImageContentType;
}) {
  return storeCollectionImage({
    collectionId: input.authorId,
    imageId: input.idempotencyKey,
    filename: "artwork.webp",
    contentType: input.contentType,
    bytes: input.bytes,
    namespace: "community",
  });
}

export async function readCommunityArtworkImage(input: {
  authorId: string;
  storagePath: string;
  storageProvider: CommunityStorageProvider;
}) {
  return readCollectionImage({
    collectionId: input.authorId,
    storagePath: input.storagePath,
    provider: input.storageProvider,
  });
}

export async function removeCommunityArtworkImage(input: {
  authorId: string;
  storagePath: string;
  storageProvider: CommunityStorageProvider;
}) {
  return removeCollectionImage({
    collectionId: input.authorId,
    storagePath: input.storagePath,
    provider: input.storageProvider,
  });
}
