import { clearDemoSession } from "@/lib/session.server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { getBackendMode } from "@/lib/config";
import { consumeCommunityRateLimit, deleteLocalCommunityAccount } from "@/lib/community/repository";
import { getCommunityActorForRequest } from "@/lib/community/session";
import { bodyErrorResponse, communityJson, communityErrorResponse, isSameOriginCommunityRequest, readBoundedJson } from "@/lib/community/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  if (!isSameOriginCommunityRequest(request)) {
    return communityJson({ ok: false, error: "invalid_request", message: "Refresh the page and try again." }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return communityJson({ ok: false, error: "invalid_body", message: "Send the account deletion confirmation." }, 400);
  }
  const body = await readBoundedJson(request);
  if (!body.ok) return bodyErrorResponse(body.reason);
  if (!isDeleteConfirmation(body.value)) {
    return communityJson({ ok: false, error: "invalid_input", message: "Type DELETE to confirm account deletion." }, 400);
  }

  try {
    const actor = await getCommunityActorForRequest();
    if (!actor) return communityJson({ ok: false, error: "unauthorized", message: "Log in before deleting your account." }, 401);
    if (!actor.emailVerified) return communityJson({ ok: false, error: "email_unverified", message: "Verify your email before deleting your account." }, 403);
    if (!await consumeCommunityRateLimit("account-deletion", actor.userId, 1, 24 * 60 * 60)) {
      return communityJson({ ok: false, error: "rate_limited", message: "Account deletion was recently requested. Try again later." }, 429);
    }

    if (getBackendMode() === "local") {
      await deleteLocalCommunityAccount(actor.userId);
    } else {
      const { error } = await createServiceRoleClient().auth.admin.deleteUser(actor.userId);
      if (error) return communityJson({ ok: false, error: "deletion_unavailable", message: "We could not delete the account right now. Try again later." }, 503);
    }

    await clearDemoSession();
    return communityJson({ ok: true, cleanupQueued: true, message: "Your account was deleted. Private community media has been queued for cleanup." }, 200);
  } catch {
    return communityErrorResponse(new Error("Account deletion is temporarily unavailable."));
  }
}

function isDeleteConfirmation(value: unknown): value is { confirmation: "DELETE" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).length === 1 && body.confirmation === "DELETE";
}
