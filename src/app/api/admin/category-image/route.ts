import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { hasAdminAccess } from "@/lib/auth";
import { ADMIN_ERROR_CODES, getAdminErrorMessage, type AdminErrorCode } from "@/lib/admin-errors";
import { readImageDimensionsFromBytes } from "@/lib/image-file-dimensions";
import { validateImageDimensions } from "@/lib/image-ratios";
import { validateMediaFile } from "@/lib/media-upload";
import { removeCategoryImageForRequest, saveCategoryImageForRequest } from "@/lib/supabase-content-admin";
import { getDemoSession } from "@/lib/session.server";

export async function POST(request: Request) {
  const authError = await authorizeAdmin();
  if (authError) return authError;

  if (!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
    return adminErrorResponse(ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT, 415);
  }

  const formData = await request.formData();
  const categoryId = stringField(formData, "categoryId");
  const file = formData.get("file");
  if (!isUuid(categoryId) || !(file instanceof File)) {
    return adminErrorResponse(ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT, 400);
  }

  const validation = validateMediaFile("cover", file);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error, errorCode: ADMIN_ERROR_CODES.VALIDATION_ASSET_FILE }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = readImageDimensionsFromBytes(bytes);
  const ratioValidation = dimensions
    ? validateImageDimensions("category", dimensions)
    : { ok: false as const, error: "Nie udało się odczytać wymiarów obrazu. Wybierz prawidłowy plik PNG, JPG lub WEBP." };
  if (!ratioValidation.ok) {
    return NextResponse.json({ error: ratioValidation.error, errorCode: ADMIN_ERROR_CODES.VALIDATION_ASSET_FILE }, { status: 400 });
  }

  try {
    const result = await saveCategoryImageForRequest({
      categoryId,
      imageId: randomUUID(),
      filename: file.name,
      contentType: validation.contentType,
      bytes,
    });
    if (!result.ok) return adminErrorResponse(result.errors[0] ?? ADMIN_ERROR_CODES.INTERNAL, result.errors[0] === ADMIN_ERROR_CODES.NOT_FOUND_RESOURCE ? 404 : 400);
    return NextResponse.json({ image: result.categoryImage, cleanupDeferred: result.cleanupDeferred ?? false });
  } catch (error) {
    console.error("[category-image] Upload nie powiódł się.", error);
    return adminErrorResponse(ADMIN_ERROR_CODES.INTERNAL, 500);
  }
}

export async function DELETE(request: Request) {
  const authError = await authorizeAdmin();
  if (authError) return authError;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const categoryId = typeof body?.categoryId === "string" ? body.categoryId.trim() : "";
  if (!isUuid(categoryId)) return adminErrorResponse(ADMIN_ERROR_CODES.VALIDATION_INVALID_INPUT, 400);

  try {
    const result = await removeCategoryImageForRequest(categoryId);
    if (!result.ok) return adminErrorResponse(result.errors[0] ?? ADMIN_ERROR_CODES.INTERNAL, result.errors[0] === ADMIN_ERROR_CODES.NOT_FOUND_RESOURCE ? 404 : 400);
    return NextResponse.json({ ok: true, cleanupDeferred: result.cleanupDeferred ?? false });
  } catch (error) {
    console.error("[category-image] Usunięcie obrazu nie powiodło się.", error);
    return adminErrorResponse(ADMIN_ERROR_CODES.INTERNAL, 500);
  }
}

async function authorizeAdmin() {
  try {
    if (hasAdminAccess(await getDemoSession())) return null;
    return adminErrorResponse(ADMIN_ERROR_CODES.AUTHORIZATION_DENIED, 403);
  } catch {
    return adminErrorResponse(ADMIN_ERROR_CODES.AUTHORIZATION_DENIED, 401);
  }
}

function stringField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function adminErrorResponse(code: AdminErrorCode, status: number) {
  return NextResponse.json({ error: getAdminErrorMessage(code, "pl"), errorCode: code }, { status });
}
