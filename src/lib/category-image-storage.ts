import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { CategoryImage } from "./types";
import { getBackendMode } from "./config";
import { getMediaUploadProvider, isSafeCategoryImageStoragePath } from "./media-r2-config";
import { deleteR2Media, uploadR2CategoryImage } from "./media-r2";
import { mediaFilenameForDisplay, mediaFilenameForStorage } from "./media-upload";
import { createServiceRoleClient } from "./supabase/admin";

const categoryImageBucket = "public-media";

export async function storeCategoryImage(input: {
  categoryId: string;
  imageId: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  authorizationToken?: string | null;
}): Promise<CategoryImage> {
  const filename = mediaFilenameForDisplay(input.filename);
  const storageFilename = mediaFilenameForStorage(filename);
  const storagePath = `categories/${input.categoryId}/image/${input.imageId}-${storageFilename}`;
  const publicPath = `/uploads/${storagePath.split("/").map(encodeURIComponent).join("/")}`;

  if (getBackendMode() === "local") {
    writeLocalCategoryImage(storagePath, input.bytes);
    return {
      id: input.imageId,
      path: publicPath,
      storagePath,
      storageProvider: "supabase",
      filename,
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
    };
  }

  const supabase = createServiceRoleClient({
    storageAuthorizationToken: input.authorizationToken ?? undefined,
  });
  const { error } = await supabase.storage.from(categoryImageBucket).upload(storagePath, input.bytes, {
    cacheControl: "31536000",
    contentType: input.contentType,
    upsert: false,
  });
  if (error) throw new Error(`Nie udało się zapisać obrazu kategorii: ${error.message}`);

  try {
    if (getMediaUploadProvider() === "r2") {
      const path = await uploadR2CategoryImage({
        categoryId: input.categoryId,
        imageId: input.imageId,
        storagePath,
        contentType: input.contentType,
        bytes: input.bytes,
      });
      return {
        id: input.imageId,
        path,
        storagePath,
        storageProvider: "r2_public",
        filename,
        contentType: input.contentType,
        sizeBytes: input.bytes.byteLength,
      };
    }

    return {
      id: input.imageId,
      path: `/api/category-media/${input.categoryId}?v=${encodeURIComponent(input.imageId)}`,
      storagePath,
      storageProvider: "supabase",
      filename,
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
    };
  } catch (error) {
    const { error: cleanupError } = await supabase.storage.from(categoryImageBucket).remove([storagePath]);
    if (cleanupError) {
      console.error("Nie udało się posprzątać prywatnej kopii Supabase obrazu kategorii.", {
        categoryId: input.categoryId,
        imageId: input.imageId,
      });
    }
    throw error;
  }
}

export async function removeCategoryImageStorage(input: {
  categoryId: string;
  image: CategoryImage;
  authorizationToken?: string | null;
}) {
  if (!isCategoryImageReference(input.categoryId, input.image)) {
    throw new Error("Nieprawidłowa ścieżka obrazu kategorii.");
  }

  if (getBackendMode() === "local") {
    const target = localImagePath(input.image.storagePath);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return true;
  }

  let removed = true;
  if (input.image.storageProvider === "r2_public") {
    try {
      await deleteR2Media(input.image.storagePath, true);
    } catch (error) {
      removed = false;
      console.error("Nie udało się usunąć obrazu kategorii z R2; wymaga kontrolowanego sprzątania.", {
        categoryId: input.categoryId,
        imageId: input.image.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  const supabase = createServiceRoleClient({
    storageAuthorizationToken: input.authorizationToken ?? undefined,
  });
  const { error } = await supabase.storage.from(categoryImageBucket).remove([input.image.storagePath]);
  if (error) {
    removed = false;
    console.error("Nie udało się usunąć prywatnego obrazu kategorii z Supabase.", {
      categoryId: input.categoryId,
      imageId: input.image.id,
    });
  }

  return removed;
}

export function isCategoryImageReference(categoryId: string, image: CategoryImage) {
  return isSafeCategoryImageStoragePath(image.storagePath, categoryId, image.id);
}

function writeLocalCategoryImage(storagePath: string, bytes: Uint8Array) {
  if (!isSafeCategoryImageStoragePath(storagePath)) {
    throw new Error("Nieprawidłowa ścieżka lokalnego obrazu kategorii.");
  }
  const target = localImagePath(storagePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: "wx" });
}

function localImagePath(storagePath: string) {
  if (!isSafeCategoryImageStoragePath(storagePath)) {
    throw new Error("Nieprawidłowa ścieżka lokalnego obrazu kategorii.");
  }

  const root = path.resolve(process.cwd(), "public", "uploads");
  const target = path.resolve(root, ...storagePath.split("/"));
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Nieprawidłowa ścieżka lokalnego obrazu kategorii.");
  }
  return target;
}
