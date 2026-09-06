import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { hasAdminAccess } from "@/lib/auth";
import { isMediaKind, validateMediaFile } from "@/lib/media-upload";
import { removeUploadedMedia, storeMediaFile } from "@/lib/media-storage";
import { getDemoSession } from "@/lib/session.server";

export async function POST(request: Request) {
  const session = await getDemoSession();

  if (!hasAdminAccess(session)) {
    return NextResponse.json({ error: "Brak uprawnień administratora." }, { status: 403 });
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
