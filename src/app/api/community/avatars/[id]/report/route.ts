import { getCommunityFlags } from "@/lib/community-flags";
import { communityErrorResponse, communityJson, isSameOriginCommunityRequest, readBoundedJson } from "@/lib/community/http";
import { isAvatarId } from "@/lib/community/avatar-contract";
import { supportsCommunityAvatars, submitCommunityAvatarReport } from "@/lib/community/avatar-repository";
import { getCommunityActorForRequest } from "@/lib/community/session";
import type { CommunityReportReason } from "@/lib/community/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Context = { params: Promise<{ id: string }> };
const REPORT_REASONS = ["rights", "privacy", "harmful", "other"] as const;

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginCommunityRequest(request)) return communityJson({ ok: false, error: "forbidden", message: "This request could not be verified." }, 403);
  if (!supportsCommunityAvatars() || !getCommunityFlags().publicEnabled) return communityJson({ ok: false, error: "not_found", message: "Reporting is unavailable." }, 404);
  const { id } = await params;
  if (!isAvatarId(id)) return communityJson({ ok: false, error: "not_found" }, 404);
  let actor;
  try { actor = await getCommunityActorForRequest(); }
  catch { return communityJson({ ok: false, error: "unavailable", message: "Your account could not be checked." }, 503); }
  if (!actor) return communityJson({ ok: false, error: "unauthorized", message: "Sign in to report profile photo." }, 401);
  if (!actor.emailVerified) return communityJson({ ok: false, error: "forbidden", message: "Verify your email to report profile photo." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return communityJson({ ok: false, error: "invalid_body", message: "Send a valid report." }, 400);
  }
  const body = await readBoundedJson(request);
  if (!body.ok) return communityJson({ ok: false, error: body.reason === "too_large" ? "body_too_large" : "invalid_body", message: "Send a valid report." }, body.reason === "too_large" ? 413 : 400);
  if (!isReportBody(body.value)) return communityJson({ ok: false, error: "invalid_input", message: "Choose a reason and enter no more than 500 characters." }, 400);
  try {

    const result = await submitCommunityAvatarReport(actor.userId, id, body.value.reason, body.value.details?.trim() ?? "");
    return communityJson({ ok: true, duplicate: result.duplicate }, result.duplicate ? 200 : 201);
  } catch (error) {
    return communityErrorResponse(error, "This profile photo is no longer available to report.");
  }
}

function isReportBody(value: unknown): value is { reason: CommunityReportReason; details?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).every((key) => ["reason", "details"].includes(key))
    && typeof body.reason === "string" && REPORT_REASONS.includes(body.reason as CommunityReportReason)
    && (body.details === undefined || (typeof body.details === "string" && Array.from(body.details.trim()).length <= 500));
}
