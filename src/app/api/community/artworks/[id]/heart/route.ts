import { getCommunityFlags } from "@/lib/community-flags";
import { communityErrorResponse, communityJson, isSameOriginCommunityRequest, readBoundedBody } from "@/lib/community/http";
import { CommunityAuthorizationError } from "@/lib/community/errors";
import { getCommunityHeartContext, getCommunityPublicArtwork, setCommunityArtworkLike } from "@/lib/community/repository";
import { getCommunityActorForRequest } from "@/lib/community/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Context = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: Context) {
  if (!getCommunityFlags().publicEnabled) return unavailable();
  const { id } = await params;
  if (!UUID.test(id)) return unavailable();
  try {
    const context = await getCommunityHeartContext();
    const artwork = await getCommunityPublicArtwork(id, context.access === "member" ? context.actor : undefined);
    if (!artwork) return unavailable();
    return communityJson({ ok: true, liked: artwork.likedByMe, likesCount: artwork.likesCount });
  } catch {
    return communityJson({ ok: false, error: "unavailable", message: "Reactions could not be loaded." }, 503);
  }
}

export async function PUT(request: Request, context: Context) {
  return mutate(request, context, true);
}

export async function DELETE(request: Request, context: Context) {
  return mutate(request, context, false);
}

async function mutate(request: Request, { params }: Context, liked: boolean) {
  if (!getCommunityFlags().publicEnabled) return unavailable();
  if (!isSameOriginCommunityRequest(request)) {
    return communityJson({ ok: false, error: "forbidden", message: "This request could not be verified." }, 403);
  }
  const body = await readBoundedBody(request);
  if (!body.ok) return communityJson({ ok: false, error: "invalid_input", message: "Send an empty reaction request." }, 400);
  if (body.text !== "") return communityJson({ ok: false, error: "invalid_input", message: "Reaction requests do not accept fields." }, 400);
  const { id } = await params;
  if (!UUID.test(id)) return unavailable();
  try {
    const actor = await getCommunityActorForRequest();
    if (!actor) return communityJson({ ok: false, error: "unauthorized", message: "Log in to react to community artwork." }, 401);
    if (!actor.emailVerified) return communityJson({ ok: false, error: "forbidden", message: "Verify your email before reacting." }, 403);
    const result = await setCommunityArtworkLike(id, liked);
    if (!result.available) return unavailable();
    return communityJson({ ok: true, liked: result.liked, likesCount: result.likesCount });
  } catch (error) {
    if (error instanceof CommunityAuthorizationError) {
      return communityJson({ ok: false, error: "forbidden", message: "Join the Coloring Club before reacting." }, 403);
    }
    return communityErrorResponse(error);
  }
}

function unavailable() {
  return communityJson({ ok: false, error: "not_found", message: "This community artwork is not available." }, 404);
}
