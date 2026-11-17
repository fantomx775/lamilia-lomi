import { communityErrorResponse, communityJson } from "@/lib/community/http";
import { decodeCommunityTimestampCursor } from "@/lib/community/cursor";
import { getCommunityActorForRequest } from "@/lib/community/session";
import { listMyCommunityArtworksPage } from "@/lib/community/repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const cursor = params.get("cursor");
  if ([...params.keys()].some((key) => key !== "cursor") || params.getAll("cursor").length > 1
    || (cursor !== null && !decodeCommunityTimestampCursor(cursor))) {
    return communityJson({ ok: false, message: "The artwork page cursor is invalid." }, 400);
  }
  try {
    const actor = await getCommunityActorForRequest();
    if (!actor) return communityJson({ ok: false, message: "Log in to view your artworks." }, 401);
    if (!actor.emailVerified) return communityJson({ ok: false, message: "Verify your email to view your artworks." }, 403);
    const page = await listMyCommunityArtworksPage({ cursor, limit: 50 });
    return communityJson({ ok: true, ...page });
  } catch (error) {
    return communityErrorResponse(error);
  }
}
