import { NextResponse } from "next/server";

import { getCommunityArtworkMedia } from "@/lib/community/repository";
import { readCommunityArtworkImage } from "@/lib/community/storage";
import { resizeCommunityArtworkImage } from "@/lib/community/image";
import { COMMUNITY_MEDIA_WIDTHS, type CommunityMediaWidth } from "@/lib/community/media-urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return notFound();
  try {
    const artwork = await getCommunityArtworkMedia(id);
    if (!artwork) return notFound();
    const requestedWidth = new URL(request.url).searchParams.get("width");
    const width = Number(requestedWidth) as CommunityMediaWidth;
    if (requestedWidth !== null && !COMMUNITY_MEDIA_WIDTHS.includes(width)) return notFound();
    const original = await readCommunityArtworkImage(artwork);
    const bytes = requestedWidth === null ? original : await resizeCommunityArtworkImage(original, width);
    return new Response(Uint8Array.from(bytes), {
      headers: {
        "Content-Type": requestedWidth === null ? artwork.contentType : "image/webp",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Vary": "Cookie",
      },
    });
  } catch {
    return notFound();
  }
}

function notFound() {
  return NextResponse.json({ error: "not_found" }, {
    status: 404,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
