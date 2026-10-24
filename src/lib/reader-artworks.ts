import "server-only";

import { getBackendMode } from "./config";
import { getContentSnapshot, saveContentSnapshot } from "./content-store";
import { createServiceRoleClient } from "./supabase/admin";
import type { ReaderArtwork } from "./types";

const SELECT: string = "id,product_id,storage_path,storage_provider,filename,content_type,size_bytes,display_name,description,sort_order,is_visible,created_at,updated_at";
const PUBLIC_SELECT: string = `${SELECT},products!product_reader_artworks_product_id_fkey!inner(status)`;

export async function listReaderArtworks(productId: string, admin = false): Promise<ReaderArtwork[]> {
  if (getBackendMode() === "local") {
    const product = getContentSnapshot().products.find((item) => item.id === productId);
    return (product && (admin || product.status === "published") ? product.readerArtworks ?? [] : [])
      .filter((item) => admin || item.isVisible).sort((a, b) => a.sortOrder - b.sortOrder);
  }
  const client = createServiceRoleClient();
  let query = client.from("product_reader_artworks").select(admin ? SELECT : PUBLIC_SELECT).eq("product_id", productId);
  if (!admin) query = query.eq("is_visible", true).eq("products.status", "published");
  const { data, error } = await query.order("sort_order").order("id");
  if (error) throw new Error(`Reader artwork read failed: ${error.message}`);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapRow);
}

export async function getReaderArtwork(id: string, admin = false): Promise<ReaderArtwork | null> {
  if (getBackendMode() === "local") {
    const product = getContentSnapshot().products.find((item) => item.readerArtworks?.some((artwork) => artwork.id === id));
    if (!product || (!admin && product.status !== "published")) return null;
    return product.readerArtworks?.find((item) => item.id === id && (admin || item.isVisible)) ?? null;
  }
  const client = createServiceRoleClient();
  let query = client.from("product_reader_artworks").select(PUBLIC_SELECT).eq("id", id);
  if (!admin) query = query.eq("is_visible", true).eq("products.status", "published");
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Reader artwork lookup failed: ${error.message}`);
  return data ? mapRow(data as unknown as Record<string, unknown>) : null;
}

export async function createReaderArtwork(artwork: ReaderArtwork) {
  if (getBackendMode() === "local") {
    const snapshot = getContentSnapshot();
    const index = snapshot.products.findIndex((item) => item.id === artwork.productId);
    if (index < 0) throw new Error("Product not found.");
    snapshot.products[index].readerArtworks = [...(snapshot.products[index].readerArtworks ?? []), artwork];
    saveContentSnapshot(snapshot);
    return;
  }
  const { error } = await createServiceRoleClient().from("product_reader_artworks").insert(toRow(artwork));
  if (error) throw new Error(`Reader artwork save failed: ${error.message}`);
}

export async function updateReaderArtwork(productId: string, id: string, update: Partial<Pick<ReaderArtwork, "displayName" | "description" | "sortOrder" | "isVisible">>) {
  if (getBackendMode() === "local") {
    const snapshot = getContentSnapshot();
    const product = snapshot.products.find((item) => item.id === productId);
    const artwork = product?.readerArtworks?.find((item) => item.id === id);
    if (!artwork) return false;
    Object.assign(artwork, update, { updatedAt: new Date().toISOString() });
    saveContentSnapshot(snapshot);
    return true;
  }
  const { data, error } = await createServiceRoleClient().from("product_reader_artworks")
    .update({
      ...(update.displayName !== undefined ? { display_name: update.displayName } : {}),
      ...(Object.prototype.hasOwnProperty.call(update, "description") ? { description: update.description ?? null } : {}),
      ...(update.sortOrder !== undefined ? { sort_order: update.sortOrder } : {}),
      ...(update.isVisible !== undefined ? { is_visible: update.isVisible } : {}),
      updated_at: new Date().toISOString(),
    }).eq("product_id", productId).eq("id", id).select("id");
  if (error) throw new Error(`Reader artwork update failed: ${error.message}`);
  return Boolean(data?.length);
}

export async function deleteReaderArtwork(productId: string, id: string) {
  if (getBackendMode() === "local") {
    const snapshot = getContentSnapshot();
    const product = snapshot.products.find((item) => item.id === productId);
    const before = product?.readerArtworks?.length ?? 0;
    if (product) product.readerArtworks = (product.readerArtworks ?? []).filter((item) => item.id !== id);
    if (product?.readerArtworks?.length !== before) saveContentSnapshot(snapshot);
    return product?.readerArtworks?.length !== before;
  }
  const { data, error } = await createServiceRoleClient().from("product_reader_artworks").delete()
    .eq("product_id", productId).eq("id", id).select(SELECT);
  if (error) throw new Error(`Reader artwork delete failed: ${error.message}`);
  return data?.[0] ? mapRow(data[0] as unknown as Record<string, unknown>) : null;
}

export async function reorderReaderArtworks(productId: string, orderedIds: string[]) {
  if (getBackendMode() === "local") {
    const snapshot = getContentSnapshot();
    const product = snapshot.products.find((item) => item.id === productId);
    if (!product) return false;
    const items = product.readerArtworks ?? [];
    if (items.length !== orderedIds.length || new Set(orderedIds).size !== items.length || items.some((item) => !orderedIds.includes(item.id))) return false;
    const byId = new Map(items.map((item) => [item.id, item]));
    product.readerArtworks = orderedIds.map((id, sortOrder) => ({ ...byId.get(id)!, sortOrder, updatedAt: new Date().toISOString() }));
    saveContentSnapshot(snapshot);
    return true;
  }
  const { data, error } = await createServiceRoleClient().rpc("reorder_product_reader_artworks", { requested_product_id: productId, ordered_ids: orderedIds });
  if (error) throw new Error(`Reader artwork reorder failed: ${error.message}`);
  return data === true;
}

export async function getProductStatus(productId: string): Promise<string | null> {
  if (getBackendMode() === "local") return getContentSnapshot().products.find((item) => item.id === productId)?.status ?? null;
  const { data, error } = await createServiceRoleClient().from("products").select("status").eq("id", productId).maybeSingle();
  if (error) throw new Error(`Product lookup failed: ${error.message}`);
  return data?.status ?? null;
}

function mapRow(row: Record<string, unknown>): ReaderArtwork {
  return { id: String(row.id), productId: String(row.product_id), storagePath: String(row.storage_path),
    storageProvider: row.storage_provider as ReaderArtwork["storageProvider"], filename: String(row.filename),
    contentType: row.content_type as ReaderArtwork["contentType"], sizeBytes: Number(row.size_bytes),
    displayName: String(row.display_name), description: typeof row.description === "string" ? row.description : undefined,
    sortOrder: Number(row.sort_order), isVisible: row.is_visible === true,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

function toRow(item: ReaderArtwork) {
  return { id: item.id, product_id: item.productId, storage_path: item.storagePath,
    storage_provider: item.storageProvider, filename: item.filename, content_type: item.contentType,
    size_bytes: item.sizeBytes, display_name: item.displayName, description: item.description ?? null,
    sort_order: item.sortOrder, is_visible: item.isVisible, created_at: item.createdAt, updated_at: item.updatedAt };
}
