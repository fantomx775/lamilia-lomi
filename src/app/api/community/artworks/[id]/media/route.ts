import { NextResponse } from "next/server";

import { getCommunityArtworkMedia } from "@/lib/community/repository";
import { readCommunityArtworkImage } from "@/lib/community/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return notFound();
  try {
    const artwork = await getCommunityArtworkMedia(id);
    if (!artwork) return notFound();
    const bytes = await readCommunityArtworkImage(artwork);
    return new Response(Uint8Array.from(bytes), {
      headers: {
        "Content-Type": artwork.contentType,
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
