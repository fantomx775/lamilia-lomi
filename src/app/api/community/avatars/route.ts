import { getCommunityFlags } from "@/lib/community-flags";
import {
  consumeAvatarUploadRateLimit, getOwnerAvatarView, removeCommunityAvatar, supportsCommunityAvatars, uploadCommunityAvatar,
} from "@/lib/community/avatar-repository";
import { AVATAR_MAX_BYTES, isAvatarInputType } from "@/lib/community/avatar-contract";
import { normalizeAvatarImage } from "@/lib/community/avatar-image";
import { communityErrorResponse, communityJson, isSameOriginCommunityRequest, readBoundedBinaryBody } from "@/lib/community/http";
import { getCommunityActorForRequest } from "@/lib/community/session";

export const runtime = "nodejs";

async function avatarAccess(request?: Request) {
  if (!supportsCommunityAvatars()) return { response: communityJson({ ok: false }, 404) };
  if (request && !isSameOriginCommunityRequest(request)) {
    return { response: communityJson({ ok: false, message: "Refresh the page and try again." }, 403) };
  }
  const actor = await getCommunityActorForRequest();
  if (!actor) return { response: communityJson({ ok: false, message: "Log in to manage your profile photo." }, 401) };
  if (!actor.emailVerified) {
    return { response: communityJson({ ok: false, message: "Verify your email to manage your profile photo." }, 403) };
  }
  return { actor };
}

export async function GET() {
  try {
    const { actor, response } = await avatarAccess();
    if (response) return response;
    return communityJson({ ok: true, avatar: await getOwnerAvatarView(actor.userId) });
  } catch (error) {
    return communityErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!getCommunityFlags().uploadsEnabled) return communityJson({ ok: false }, 404);
    const { actor, response } = await avatarAccess(request);
    if (response) return response;
    const contentType = request.headers.get("content-type") ?? "";
    if (!isAvatarInputType(contentType)) {
      return communityJson({ ok: false, message: "Choose a JPG, PNG, or WebP image." }, 415);
    }
    await consumeAvatarUploadRateLimit(actor.userId);
    const body = await readBoundedBinaryBody(request, AVATAR_MAX_BYTES);
    if (!body.ok) {
      return body.reason === "too_large"
        ? communityJson({ ok: false, message: "Choose a photo up to 4 MiB." }, 413)
        : communityJson({ ok: false, message: "The photo could not be read. Please try again." }, 400);
    }
    await uploadCommunityAvatar(actor.userId, await normalizeAvatarImage(body.bytes, contentType));
    return communityJson({ ok: true, avatar: await getOwnerAvatarView(actor.userId) }, 201);
  } catch (error) {
    return communityErrorResponse(error, "Your profile photo changed. Refresh the page and try again.");
  }
}

export async function DELETE(request: Request) {
  try {
    const { actor, response } = await avatarAccess(request);
    if (response) return response;
    await removeCommunityAvatar(actor.userId);
    return communityJson({ ok: true, avatar: { approvedId: null, pending: false, rejected: false } });
  } catch (error) {
    return communityErrorResponse(error);
  }
}
