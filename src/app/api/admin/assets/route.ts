import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { hasAdminAccess } from "@/lib/auth";
import { getBackendMode } from "@/lib/config";
import { isMediaKind, validateMediaFile } from "@/lib/media-upload";
import { createSignedMediaUpload, removeUploadedMedia, storeMediaFile } from "@/lib/media-storage";
import { getDemoSession } from "@/lib/session.server";

export async function POST(request: Request) {
  const session = await getDemoSession();

  if (!hasAdminAccess(session)) {
    return NextResponse.json({ error: "Brak uprawnień administratora." }, { status: 403 });
  }

  if (getBackendMode() === "supabase") {
    return createSupabaseUpload(request);
  }

  return createLocalUpload(request);
}

async function createLocalUpload(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
    return NextResponse.json({ error: "Lokalny upload wymaga przesłania pliku." }, { status: 415 });
  }

  const formData = await request.formData();
  const productId = stringField(formData, "productId");
  const kindValue = stringField(formData, "kind");
  const file = formData.get("file");

  if (!isSafeId(productId) || !isMediaKind(kindValue) || !(file instanceof File)) {
    return NextResponse.json({ error: "Nieprawidłowe dane uploadu." }, { status: 400 });
  }

  const validation = validateMediaFile(kindValue, file);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
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
    const locale = stringField(formData, "locale");

    return NextResponse.json({
      asset: {
        id,
        productId,
        kind: kindValue,
        bucket: stored.bucket,
        path: stored.publicPath,
        storagePath: stored.storagePath,
        filename: stored.filename,
        contentType: validation.contentType,
        sizeBytes: file.size,
        locale: locale === "en" || locale === "pl" || locale === "de" || locale === "es" ? locale : undefined,
        title: stored.filename,
        sortOrder: 100,
        isPublic: kindValue !== "premium_download",
        isActive: true,
        uploaded: true,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload nie powiódł się." }, { status: 500 });
  }
}

async function createSupabaseUpload(request: Request) {
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
    return NextResponse.json({ error: "Nieprawidłowe dane uploadu." }, { status: 400 });
  }

  const validation = validateMediaFile(kindValue, {
    name: filename,
    size: sizeBytes,
    type: contentType,
  });

  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const id = randomUUID();

  try {
    const stored = await createSignedMediaUpload({
      assetId: id,
      productId,
      kind: kindValue,
      filename,
    });
    const locale = body?.locale === "en" || body?.locale === "pl" || body?.locale === "de" || body?.locale === "es"
      ? body.locale
      : undefined;

    return NextResponse.json({
      asset: {
        id,
        productId,
        kind: kindValue,
        bucket: stored.bucket,
        path: kindValue === "premium_download" ? stored.storagePath : `/api/media/${id}`,
        storagePath: stored.storagePath,
        filename: stored.filename,
        contentType: validation.contentType,
        sizeBytes,
        locale,
        title: stored.filename,
        sortOrder: 100,
        isPublic: kindValue !== "premium_download",
        isActive: true,
        uploaded: false,
      },
      upload: {
        endpoint: stored.uploadEndpoint,
        token: stored.uploadToken,
        bucket: stored.bucket,
        path: stored.storagePath,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload nie powiódł się." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await getDemoSession();

  if (!hasAdminAccess(session)) {
    return NextResponse.json({ error: "Brak uprawnień administratora." }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const productId = typeof body?.productId === "string" ? body.productId : "";
  const kind = typeof body?.kind === "string" ? body.kind : "";
  const storagePath = typeof body?.storagePath === "string" ? body.storagePath : "";

  if (!isSafeId(productId) || !isMediaKind(kind) || !storagePath) {
    return NextResponse.json({ error: "Nieprawidłowe dane usuwania." }, { status: 400 });
  }

  try {
    await removeUploadedMedia({ productId, kind, storagePath });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Nie udało się usunąć pliku." }, { status: 500 });
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
