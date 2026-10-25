import { NextResponse } from "next/server";
import { hasAdminAccess } from "@/lib/auth";
import { getBackendMode } from "@/lib/config";
import { readCollectionImage } from "@/lib/collection-image-storage";
import { getReaderArtwork, getProductStatus } from "@/lib/reader-artworks";
import { getDemoSession } from "@/lib/session.server";
import { getCurrentAccessToken } from "@/lib/supabase/server";

export async function GET(_request: Request, context: { params: Promise<{ artworkId: string }> }) {
  const { artworkId } = await context.params;
  let admin = false;
  try { admin = hasAdminAccess(await getDemoSession()); } catch { /* Public access is checked below. */ }
  try {
    const artwork = await getReaderArtwork(artworkId, admin);
    if (!artwork) return notFound();
    if (!admin && (await getProductStatus(artwork.productId)) !== "published") return notFound();
    const authorizationToken = getBackendMode() === "supabase" ? await getCurrentAccessToken().catch(() => null) : null;
    const bytes = await readCollectionImage({ collectionId: artwork.productId, storagePath: artwork.storagePath, provider: artwork.storageProvider, authorizationToken });
    return new Response(Uint8Array.from(bytes), { headers: { "Content-Type": artwork.contentType, "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return notFound(); }
}

function notFound() { return NextResponse.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "private, no-store" } }); }
