import { isIP } from "node:net";

import { getCommunityFlags } from "@/lib/community-flags";
import { communityErrorResponse, communityJson, isSameOriginCommunityRequest, readBoundedJson } from "@/lib/community/http";
import { submitCommunityArtworkReport } from "@/lib/community/repository";
import { getCommunityActorForRequest } from "@/lib/community/session";
import type { CommunityReportReason } from "@/lib/community/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Context = { params: Promise<{ id: string }> };
const REPORT_REASONS = ["rights", "privacy", "harmful", "other"] as const;

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginCommunityRequest(request)) return communityJson({ ok: false, error: "forbidden", message: "This request could not be verified." }, 403);
  if (!getCommunityFlags().publicEnabled) return communityJson({ ok: false, error: "not_found", message: "Reporting is unavailable." }, 404);
  let actor;
  try { actor = await getCommunityActorForRequest(); }
  catch { return communityJson({ ok: false, error: "unavailable", message: "Your account could not be checked." }, 503); }
  if (!actor) return communityJson({ ok: false, error: "unauthorized", message: "Sign in to report artwork." }, 401);
  if (!actor.emailVerified) return communityJson({ ok: false, error: "forbidden", message: "Verify your email to report artwork." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return communityJson({ ok: false, error: "invalid_body", message: "Send a valid report." }, 400);
  }
  const body = await readBoundedJson(request);
  if (!body.ok) return communityJson({ ok: false, error: body.reason === "too_large" ? "body_too_large" : "invalid_body", message: "Send a valid report." }, body.reason === "too_large" ? 413 : 400);
  if (!isReportBody(body.value)) return communityJson({ ok: false, error: "invalid_input", message: "Choose a reason and enter no more than 500 characters." }, 400);
  try {
    const { id } = await params;
    // Vercel supplies x-real-ip at the trusted edge. It is hashed by the
    // repository limiter before persistence; invalid or absent values are ignored.
    const rawIp = request.headers.get("x-real-ip")?.trim();
    const trustedIp = rawIp && isIP(rawIp) ? rawIp : undefined;
    const result = await submitCommunityArtworkReport(actor, id, body.value.reason, body.value.details ?? "", trustedIp);
    return communityJson({ ok: true, duplicate: result.duplicate }, result.duplicate ? 200 : 201);
  } catch (error) {
    return communityErrorResponse(error, "This artwork is no longer available to report.");
  }
}

function isReportBody(value: unknown): value is { reason: CommunityReportReason; details?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).every((key) => ["reason", "details"].includes(key))
    && typeof body.reason === "string" && REPORT_REASONS.includes(body.reason as CommunityReportReason)
    && (body.details === undefined || (typeof body.details === "string" && Array.from(body.details.trim()).length <= 500));
}
