import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { hasAdminAccess } from "@/lib/auth";
import { getBackendMode } from "@/lib/config";
import { isMediaKind, validateMediaFile } from "@/lib/media-upload";
import { createSignedMediaUpload, removeUploadedMedia, storeMediaFile } from "@/lib/media-storage";
import { getMediaUploadProvider } from "@/lib/media-r2-config";
import { createSignedR2Upload } from "@/lib/media-r2";
import { getDemoSession } from "@/lib/session.server";
import { getCurrentAccessToken } from "@/lib/supabase/server";
import { ADMIN_ERROR_CODES, getAdminErrorMessage, mapAdminError, type AdminErrorCode } from "@/lib/admin-errors";

export async function POST(request: Request) {
  let session;
  try {
    session = await getDemoSession();
  } catch (error) {
    const errorCode = mapAdminError(error, "administrator session");
    return adminErrorResponse(errorCode, 500);
  }

  if (!hasAdminAccess(session)) {
    return adminErrorResponse(ADMIN_ERROR_CODES.AUTHORIZATION_DENIED, 403);
  }

  if (getBackendMode() === "supabase") {
    try {
      return await createSupabaseUpload(request, await getCurrentAccessToken());
    } catch (error) {
      const errorCode = mapAdminError(error, "administrator upload authorization");
      return adminErrorResponse(errorCode, 500);
    }
  }

  return createLocalUpload(request);
}

async function createLocalUpload(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
    return adminErrorResponse(ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT, 415, "Lokalny upload wymaga przesłania pliku.");
  }

  const formData = await request.formData();
  const productId = stringField(formData, "productId");
  const kindValue = stringField(formData, "kind");
  const file = formData.get("file");

  if (!isSafeId(productId) || !isMediaKind(kindValue) || !(file instanceof File)) {
    return adminErrorResponse(ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT, 400, "Nieprawidłowe dane uploadu.");
  }

  const validation = validateMediaFile(kindValue, file);
  if (!validation.ok) {
    return adminErrorResponse(ADMIN_ERROR_CODES.VALIDATION_ASSET_FILE, 400, validation.error);
  }

  try {
    const stored = await storeMediaFile({
      productId,
      kind: kindValue,
      filename: file.name,
      contentType: validation.contentType,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    const id = randomUUID();

    return NextResponse.json({
      asset: {
        id,
        productId,
        kind: kindValue,
        bucket: stored.bucket,
        path: stored.publicPath,
        storagePath: stored.storagePath,
        storageProvider: "supabase",
        filename: stored.filename,
        contentType: validation.contentType,
        sizeBytes: file.size,
        locale: "en",
        title: stored.filename,
        sortOrder: 100,
        isPublic: kindValue !== "premium_download",
        isActive: true,
        uploaded: true,
      },
    });
  } catch (error) {
    console.error("[media-upload] Localny zapis pliku nie powiódł się.", error);
    return adminErrorResponse(ADMIN_ERROR_CODES.INTERNAL, 500, "Nie udało się zapisać pliku. Spróbuj ponownie.");
  }
}

async function createSupabaseUpload(request: Request, authorizationToken: string | null) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const productId = typeof body?.productId === "string" ? body.productId.trim() : "";
  const kindValue = typeof body?.kind === "string" ? body.kind.trim() : "";
  const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
  const contentType = typeof body?.contentType === "string" ? body.contentType.trim() : "";
  const sizeBytes = typeof body?.sizeBytes === "number" ? body.sizeBytes : NaN;

  if (
    !isUuid(productId) ||
    !isMediaKind(kindValue) ||
    !filename ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0
  ) {
    return adminErrorResponse(ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT, 400, "Nieprawidłowe dane uploadu.");
  }

  const validation = validateMediaFile(kindValue, {
    name: filename,
    size: sizeBytes,
    type: contentType,
  });

  if (!validation.ok) {
    return adminErrorResponse(ADMIN_ERROR_CODES.VALIDATION_ASSET_FILE, 400, validation.error);
  }

  const id = randomUUID();

  try {
    const stored = await createSignedMediaUpload({
      assetId: id,
      productId,
      kind: kindValue,
      filename,
      authorizationToken,
    });
    if (getMediaUploadProvider() === "r2" && (kindValue === "cover" || kindValue === "gallery")) {
      const r2 = await createSignedR2Upload({
        assetId: id,
        productId,
        kind: kindValue,
        storagePath: stored.storagePath,
        contentType: validation.contentType,
        sizeBytes,
      });

      return NextResponse.json({
        asset: {
          id,
          productId,
          kind: kindValue,
          bucket: stored.bucket,
          path: `/api/media/${id}`,
          storagePath: stored.storagePath,
          storageProvider: "r2_private",
          filename: stored.filename,
          contentType: validation.contentType,
          sizeBytes,
          locale: "en",
          title: stored.filename,
          sortOrder: 100,
          isPublic: true,
          isActive: true,
          uploaded: false,
        },
        upload: {
          driver: "r2-mirrored",
          r2: { url: r2.url, headers: r2.headers },
          supabase: {
            driver: "supabase-tus",
            endpoint: stored.uploadEndpoint,
            token: stored.uploadToken,
            bucket: stored.bucket,
            path: stored.storagePath,
          },
        },
      });
    }

    return NextResponse.json({
      asset: {
        id,
        productId,
        kind: kindValue,
        bucket: stored.bucket,
        path: kindValue === "premium_download" ? stored.storagePath : `/api/media/${id}`,
        storagePath: stored.storagePath,
        storageProvider: "supabase",
        filename: stored.filename,
        contentType: validation.contentType,
        sizeBytes,
        locale: "en",
        title: stored.filename,
        sortOrder: 100,
        isPublic: kindValue !== "premium_download",
        isActive: true,
        uploaded: false,
      },
      upload: {
        driver: "supabase-tus",
        endpoint: stored.uploadEndpoint,
        token: stored.uploadToken,
        bucket: stored.bucket,
        path: stored.storagePath,
      },
    });
  } catch (error) {
    console.error("[media-upload] Przygotowanie uploadu w Storage nie powiodło się.", error);
    return adminErrorResponse(ADMIN_ERROR_CODES.INTERNAL, 500, "Nie udało się przygotować przesyłania pliku. Spróbuj ponownie.");
  }
}

export async function DELETE(request: Request) {
  let session;
  try {
    session = await getDemoSession();
  } catch (error) {
    const errorCode = mapAdminError(error, "administrator session");
    return adminErrorResponse(errorCode, 500);
  }

  if (!hasAdminAccess(session)) {
    return adminErrorResponse(ADMIN_ERROR_CODES.AUTHORIZATION_DENIED, 403);
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const productId = typeof body?.productId === "string" ? body.productId : "";
  const kind = typeof body?.kind === "string" ? body.kind : "";
  const storagePath = typeof body?.storagePath === "string" ? body.storagePath : "";
  const storageProvider = body?.storageProvider === "r2_private" || body?.storageProvider === "r2_public_revoking" || body?.storageProvider === "r2_public"
    ? body.storageProvider
    : "supabase";

  if (!isSafeId(productId) || !isMediaKind(kind) || !storagePath) {
    return adminErrorResponse(ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT, 400, "Nieprawidłowe dane usuwania.");
  }

  try {
    const removed = await removeUploadedMedia({
      productId,
      kind,
      storagePath,
      storageProvider,
      authorizationToken: getBackendMode() === "supabase" ? await getCurrentAccessToken() : undefined,
    });
    return NextResponse.json({ ok: true, cleanupDeferred: !removed });
  } catch (error) {
    console.error("[media-upload] Usunięcie pliku ze Storage nie powiodło się.", error);
    return adminErrorResponse(ADMIN_ERROR_CODES.INTERNAL, 500, "Nie udało się usunąć pliku. Spróbuj ponownie.");
  }
}

function stringField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isSafeId(value: string) {
  return /^[a-zA-Z0-9-]{1,80}$/.test(value);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function adminErrorResponse(code: AdminErrorCode, status: number, message?: string) {
  return NextResponse.json({
    error: message ?? getAdminErrorMessage(code, "pl"),
    errorCode: code,
  }, { status });
}
