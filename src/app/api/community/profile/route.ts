import {
  changeCommunityUsername,
  getMyCommunityProfile,
  leaveColoringClub,
} from "@/lib/community/repository";
import {
  bodyErrorResponse,
  communityErrorResponse,
  communityJson,
  isSameOriginCommunityRequest,
  readBoundedBody,
  readBoundedJson,
} from "@/lib/community/http";
import { getCommunityFlags } from "@/lib/community-flags";
import { getCommunityActorForRequest } from "@/lib/community/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await getCommunityActorForRequest();
    if (!actor) return communityJson({ ok: false, error: "unauthorized", message: "Log in to view community settings." }, 401);
    if (!actor.emailVerified) return communityJson({ ok: false, error: "email_unverified", message: "Verify your email to manage community settings." }, 403);
    return communityJson({ ok: true, profile: await getMyCommunityProfile() });
  } catch (error) {
    return communityErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  if (!isSameOriginCommunityRequest(request)) {
    return communityJson({ ok: false, error: "invalid_request", message: "Refresh the page and try again." }, 403);
  }
  const flags = getCommunityFlags();
  if (!flags.publicEnabled && !flags.uploadsEnabled) {
    return communityJson({ ok: false, error: "unavailable", message: "Community profile changes are unavailable." }, 404);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return communityJson({ ok: false, error: "invalid_body", message: "Send a valid JSON request." }, 400);
  }
  const body = await readBoundedJson(request);
  if (!body.ok) return bodyErrorResponse(body.reason);
  if (!isUsernamePatch(body.value)) {
    return communityJson({ ok: false, error: "invalid_input", message: "Send only a valid username." }, 400);
  }

  try {
    const actor = await getCommunityActorForRequest();
    if (!actor) return communityJson({ ok: false, error: "unauthorized", message: "Log in to change your username." }, 401);
    if (!actor.emailVerified) return communityJson({ ok: false, error: "email_unverified", message: "Verify your email before changing your username." }, 403);
    const profile = await changeCommunityUsername(body.value.username);
    return communityJson({ ok: true, profile });
  } catch (error) {
    return communityErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginCommunityRequest(request)) {
    return communityJson({ ok: false, error: "invalid_request", message: "Refresh the page and try again." }, 403);
  }
  const body = await readBoundedBody(request);
  if (!body.ok) return bodyErrorResponse(body.reason);
  if (body.text.trim()) {
    return communityJson({ ok: false, error: "invalid_body", message: "This action does not accept a request body." }, 400);
  }
  try {
    const actor = await getCommunityActorForRequest();
    if (!actor) return communityJson({ ok: false, error: "unauthorized", message: "Log in to manage community settings." }, 401);
    const left = await leaveColoringClub();
    const profile = await getMyCommunityProfile();
    return communityJson({ ok: true, left, profile });
  } catch (error) {
    return communityErrorResponse(error);
  }
}

function isUsernamePatch(value: unknown): value is { username: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).length === 1 && typeof body.username === "string" && body.username.length <= 80;
}
