import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { hasAdminAccess } from "@/lib/auth";
import { getBackendMode } from "@/lib/config";
import {
  createSignedCollectionImageUrl,
  readLocalCollectionImage,
  removeCollectionImage,
  storeCollectionImage,
} from "@/lib/collection-image-storage";
import { isSafeCollectionImagePath, isUuid } from "@/lib/collection-image-path";
import {
  getCollectionImageForRequest,
  isCollectionImageReferencedForRequest,
} from "@/lib/content-repository";
import { ADMIN_ERROR_CODES } from "@/lib/admin-errors";
import { validateMediaFile } from "@/lib/media-upload";
import { getDemoSession } from "@/lib/session.server";
import { getCurrentAccessToken } from "@/lib/supabase/server";
import type { CollectionImageStorageProvider } from "@/lib/types";

const IMAGE_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(request: Request) {
  const access = await requireAdmin();
  if (access instanceof NextResponse) return access;

  if (!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
    return errorResponse(ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT, 415);
  }

  const formData = await request.formData();
  const collectionId = stringField(formData, "collectionId");
  const file = formData.get("file");
  if (!isUuid(collectionId) || !(file instanceof File)) {
    return errorResponse(ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT, 400);
  }

  const validation = validateMediaFile("cover", file);
  if (!validation.ok || !IMAGE_CONTENT_TYPES.has(validation.contentType)) {
    return errorResponse(ADMIN_ERROR_CODES.VALIDATION_COLLECTION_IMAGE, 400);
  }

  try {
    const imageId = randomUUID();
    const stored = await storeCollectionImage({
      collectionId,
      imageId,
      filename: file.name,
      contentType: validation.contentType,
      bytes: new Uint8Array(await file.arrayBuffer()),
      authorizationToken: access.token,
    });

    return NextResponse.json({
      image: {
        path: stored.path,
        provider: stored.provider,
        filename: stored.filename,
        contentType: validation.contentType,
        sizeBytes: file.size,
        url: previewUrl(collectionId, stored.path, stored.provider, validation.contentType),
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[collection-image] Upload failed.", error);
    return errorResponse(ADMIN_ERROR_CODES.VALIDATION_COLLECTION_IMAGE, 400);
  }
}

export async function GET(request: Request) {
  const access = await requireAdmin();
  if (access instanceof NextResponse) return access;

  const url = new URL(request.url);
  const collectionId = url.searchParams.get("collectionId") ?? "";
  const storagePath = url.searchParams.get("path") ?? "";
  if (!isUuid(collectionId) || !isSafeCollectionImagePath(storagePath, collectionId)) {
    return errorResponse(ADMIN_ERROR_CODES.NOT_FOUND_RESOURCE, 404);
  }

  try {
    const savedCollection = await getCollectionImageForRequest(collectionId);
    const isSavedImage = savedCollection?.imagePath === storagePath;
    const provider = isSavedImage
      ? savedCollection.imageStorageProvider
      : providerValue(url.searchParams.get("provider"));
    const contentType = isSavedImage
      ? savedCollection.imageContentType
      : url.searchParams.get("contentType");

    if (!provider || !contentType || !IMAGE_CONTENT_TYPES.has(contentType)) {
      return errorResponse(ADMIN_ERROR_CODES.NOT_FOUND_RESOURCE, 404);
    }

    if (provider === "local") {
      const bytes = await readLocalCollectionImage(storagePath, collectionId);
      return new Response(bytes, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const signedUrl = await createSignedCollectionImageUrl({
      collectionId,
      storagePath,
      provider,
      authorizationToken: access.token,
    });
    return signedUrl
      ? NextResponse.redirect(signedUrl, { headers: { "Cache-Control": "private, no-store" } })
      : errorResponse(ADMIN_ERROR_CODES.NOT_FOUND_RESOURCE, 404);
  } catch {
    return errorResponse(ADMIN_ERROR_CODES.NOT_FOUND_RESOURCE, 404);
  }
}

export async function DELETE(request: Request) {
  const access = await requireAdmin();
  if (access instanceof NextResponse) return access;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const collectionId = typeof body?.collectionId === "string" ? body.collectionId : "";
  const storagePath = typeof body?.path === "string" ? body.path : "";
  const provider = providerValue(body?.provider);
  if (!isUuid(collectionId) || !isSafeCollectionImagePath(storagePath, collectionId) || !provider) {
    return errorResponse(ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT, 400);
  }

  try {
    if (await isCollectionImageReferencedForRequest(storagePath)) {
      return errorResponse(ADMIN_ERROR_CODES.CONFLICT_DATA, 409);
    }
    await removeCollectionImage({
      collectionId,
      storagePath,
      provider,
      authorizationToken: access.token,
    });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[collection-image] Cleanup failed.", error);
    return errorResponse(ADMIN_ERROR_CODES.INTERNAL, 500);
  }
}

async function requireAdmin() {
  try {
    const session = await getDemoSession();
    if (!hasAdminAccess(session)) return errorResponse(ADMIN_ERROR_CODES.AUTHORIZATION_DENIED, 403);
    return { token: getBackendMode() === "supabase" ? await getCurrentAccessToken() : null };
  } catch {
    return errorResponse(ADMIN_ERROR_CODES.AUTHORIZATION_DENIED, 403);
  }
}

function errorResponse(code: string, status: number) {
  return NextResponse.json({ error: code }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function stringField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function providerValue(value: unknown): CollectionImageStorageProvider | undefined {
  return value === "local" || value === "supabase" || value === "r2" ? value : undefined;
}

function previewUrl(
  collectionId: string,
  storagePath: string,
  provider: CollectionImageStorageProvider,
  contentType: string,
) {
  const params = new URLSearchParams({ collectionId, path: storagePath, provider, contentType });
  return `/api/admin/collection-image?${params.toString()}`;
}
