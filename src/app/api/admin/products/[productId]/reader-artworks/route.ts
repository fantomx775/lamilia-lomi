import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { hasAdminAccess } from "@/lib/auth";
import { getBackendMode } from "@/lib/config";
import { hasValidCollectionImageContent } from "@/lib/collection-image-validation";
import { removeCollectionImage, storeCollectionImage } from "@/lib/collection-image-storage";
import { getProductStatus, listReaderArtworks, createReaderArtwork, updateReaderArtwork, reorderReaderArtworks, deleteReaderArtwork } from "@/lib/reader-artworks";
import { validateMediaFile } from "@/lib/media-upload";
import { getDemoSession } from "@/lib/session.server";
import { getCurrentAccessToken } from "@/lib/supabase/server";
import type { ReaderArtwork } from "@/lib/types";

type Context = { params: Promise<{ productId: string }> };
const TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function GET(_request: Request, context: Context) {
  const access = await requireAdmin();
  if (access instanceof NextResponse) return access;
  const { productId } = await context.params;
  if (!isProductStatus(await getProductStatus(productId))) return error(404);
  try {
    const images = await listReaderArtworks(productId, true);
    return NextResponse.json({ artworks: images.map(publicAdminRecord) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return error(500); }
}

export async function POST(request: Request, context: Context) {
  const access = await requireAdmin();
  if (access instanceof NextResponse) return access;
  const { productId } = await context.params;
  if (!isProductStatus(await getProductStatus(productId))) return error(404);
  if (!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) return error(415);
  const form = await request.formData();
  const file = form.get("file");
  const displayName = field(form.get("displayName"), 80);
  const description = field(form.get("description"), 240);
  if (!(file instanceof File) || !displayName) return error(400);
  const validation = validateMediaFile("gallery", file);
  if (!validation.ok || !TYPES.has(validation.contentType)) return error(400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!await hasValidCollectionImageContent(bytes, validation.contentType)) return error(400);
  const id = randomUUID();
  let stored: Awaited<ReturnType<typeof storeCollectionImage>> | undefined;
  try {
    stored = await storeCollectionImage({ collectionId: productId, imageId: id, filename: file.name, contentType: validation.contentType, bytes, authorizationToken: access.token, namespace: "reader-artworks" });
    const existing = await listReaderArtworks(productId, true);
    const now = new Date().toISOString();
    const artwork: ReaderArtwork = { id, productId, storagePath: stored.path, storageProvider: stored.provider,
      filename: stored.filename, contentType: validation.contentType as ReaderArtwork["contentType"], sizeBytes: bytes.byteLength,
      displayName, ...(description ? { description } : {}), sortOrder: existing.length ? Math.max(...existing.map((item) => item.sortOrder)) + 1 : 0,
      isVisible: true, createdAt: now, updatedAt: now };
    await createReaderArtwork(artwork);
    return NextResponse.json({ artwork: publicAdminRecord(artwork) }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    if (stored) {
      const cleanupError = await removeCollectionImage({ collectionId: productId, storagePath: stored.path, provider: stored.provider, authorizationToken: access.token }).then(() => null, (failure: unknown) => failure);
      if (cleanupError) console.error("[reader-artwork] Partial upload cleanup failed.", cleanupError);
    }
    console.error("[reader-artwork] Upload failed.", cause);
    return error(500);
  }
}

export async function PATCH(request: Request, context: Context) {
  const access = await requireAdmin();
  if (access instanceof NextResponse) return access;
  const { productId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const action = body?.action;
  if (!id || !["edit", "move", "visibility"].includes(String(action))) return error(400);
  try {
    const items = await listReaderArtworks(productId, true);
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return error(404);
    if (action === "edit") {
      const displayName = field(body?.displayName, 80);
      const description = field(body?.description, 240);
      if (!displayName) return error(400);
      if (!await updateReaderArtwork(productId, id, { displayName, description })) return error(404);
    } else if (action === "visibility") {
      if (typeof body?.isVisible !== "boolean") return error(400);
      if (!await updateReaderArtwork(productId, id, { isVisible: body.isVisible })) return error(404);
    } else {
      const direction = body?.direction;
      if (direction !== -1 && direction !== 1) return error(400);
      const next = index + direction;
      if (next < 0 || next >= items.length) return error(400);
      const orderedIds = items.map((item) => item.id);
      [orderedIds[index], orderedIds[next]] = [orderedIds[next], orderedIds[index]];
      if (!await reorderReaderArtworks(productId, orderedIds)) return error(409);
    }
    return NextResponse.json({ artworks: (await listReaderArtworks(productId, true)).map(publicAdminRecord) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return error(500); }
}

export async function DELETE(request: Request, context: Context) {
  const access = await requireAdmin();
  if (access instanceof NextResponse) return access;
  const { productId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id : "";
  try {
    const items = await listReaderArtworks(productId, true);
    const existing = items.find((item) => item.id === id);
    if (!existing) return error(404);
    await removeCollectionImage({ collectionId: productId, storagePath: existing.storagePath, provider: existing.storageProvider, authorizationToken: access.token });
    const removed = await deleteReaderArtwork(productId, id);
    if (!removed) return error(409);
    return NextResponse.json({ artworks: (await listReaderArtworks(productId, true)).map(publicAdminRecord) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return error(500); }
}

async function requireAdmin() {
  try {
    if (!hasAdminAccess(await getDemoSession())) return error(403);
    return { token: getBackendMode() === "supabase" ? await getCurrentAccessToken() : null };
  } catch { return error(403); }
}
function field(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function isProductStatus(value: string | null): value is "draft" | "published" | "archived" { return value === "draft" || value === "published" || value === "archived"; }
function error(status: number) { return NextResponse.json({ error: "reader_artwork_request_failed" }, { status, headers: { "Cache-Control": "private, no-store" } }); }
function publicAdminRecord(item: ReaderArtwork) {
  return { id: item.id, displayName: item.displayName, description: item.description, sortOrder: item.sortOrder, isVisible: item.isVisible,
    src: `/api/reader-artworks/${encodeURIComponent(item.id)}`, adminSrc: `/api/admin/reader-artwork-media/${encodeURIComponent(item.id)}` };
}
