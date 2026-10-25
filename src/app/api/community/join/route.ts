import { COMMUNITY_RULES_VERSION } from "@/lib/community/rules";
import {
  bodyErrorResponse,
  communityErrorResponse,
  communityJson,
  isSameOriginCommunityRequest,
  readBoundedJson,
} from "@/lib/community/http";
import { getCommunityFlags } from "@/lib/community-flags";
import { consumeCommunityRateLimit, joinColoringClub } from "@/lib/community/repository";
import { getCommunityActorForRequest } from "@/lib/community/session";
import { CommunityRateLimitError } from "@/lib/community/errors";

export const dynamic = "force-dynamic";

const JOIN_BODY_KEYS = new Set(["username", "adultAttested", "rulesAccepted", "rulesVersion"]);

export async function POST(request: Request) {
  if (!isSameOriginCommunityRequest(request)) {
    return communityJson({ ok: false, error: "invalid_request", message: "Refresh the page and try again." }, 403);
  }
  const flags = getCommunityFlags();
  if (!flags.publicEnabled && !flags.uploadsEnabled) {
    return communityJson({ ok: false, error: "unavailable", message: "Coloring Club is unavailable." }, 404);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return communityJson({ ok: false, error: "invalid_body", message: "Send a valid JSON request." }, 400);
  }
  const body = await readBoundedJson(request);
  if (!body.ok) return bodyErrorResponse(body.reason);
  if (!isJoinRequest(body.value)) {
    return communityJson({ ok: false, error: "invalid_input", message: "Check your username and accept both community requirements." }, 400);
  }

  try {
    const actor = await getCommunityActorForRequest();
    if (!actor) return communityJson({ ok: false, error: "unauthorized", message: "Log in to join Coloring Club." }, 401);
    if (!actor.emailVerified) return communityJson({ ok: false, error: "email_unverified", message: "Verify your email before joining." }, 403);
    const allowed = await consumeCommunityRateLimit("join", actor.userId, 6, 60 * 60);
    if (!allowed) throw new CommunityRateLimitError("You have tried to join too often. Try again later.");
    const profile = await joinColoringClub({ username: body.value.username, adultAttested: true });
    return communityJson({ ok: true, profile }, 201);
  } catch (error) {
    return communityErrorResponse(error);
  }
}

function isJoinRequest(value: unknown): value is {
  username: string;
  adultAttested: true;
  rulesAccepted: true;
  rulesVersion: typeof COMMUNITY_RULES_VERSION;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !JOIN_BODY_KEYS.has(key))) return false;
  return typeof body.username === "string"
    && body.username.length <= 80
    && body.adultAttested === true
    && body.rulesAccepted === true
    && body.rulesVersion === COMMUNITY_RULES_VERSION;
}
