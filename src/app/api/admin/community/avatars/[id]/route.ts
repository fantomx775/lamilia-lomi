import { getCommunityAdminAccess } from "@/lib/community/admin-http";
import { isAvatarId } from "@/lib/community/avatar-contract";
import { readCommunityAvatar, reviewCommunityAvatar, supportsCommunityAvatars } from "@/lib/community/avatar-repository";
import { communityErrorResponse, communityJson, isSameOriginCommunityRequest, readBoundedJson } from "@/lib/community/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!isAvatarId(id) || !supportsCommunityAvatars()) return communityJson({ error: "not_found" }, 404);
  const access = await getCommunityAdminAccess();
  if (access.response) return access.response;
  try {
    return await readCommunityAvatar(id, "admin") ?? communityJson({ error: "not_found" }, 404);
  } catch {
    return communityJson({ error: "not_found" }, 404);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginCommunityRequest(request)) return communityJson({ error: "invalid_request" }, 403);
  const { id } = await params;
  if (!isAvatarId(id) || !supportsCommunityAvatars()) return communityJson({ error: "not_found" }, 404);
  const access = await getCommunityAdminAccess();
  if (access.response) return access.response;
  const body = await readBoundedJson(request);
  if (!body.ok || !isReview(body.value)) return communityJson({ error: "invalid_body" }, 400);
  try {
    await reviewCommunityAvatar(access.actor.userId, id, body.value.decision);
    return communityJson({ ok: true });
  } catch (error) {
    return communityErrorResponse(error, "To zdjęcie się zmieniło. Odśwież kolejkę.");
  }
}

function isReview(value: unknown): value is { decision: "removed" } {
  return typeof value === "object" && value !== null && "decision" in value
    && value.decision === "removed";
}
