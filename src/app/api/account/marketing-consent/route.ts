import { getBackendMode } from "@/lib/config";
import { getDemoSession, setDemoSession } from "@/lib/session.server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { getCommunityActorForRequest } from "@/lib/community/session";
import {
  bodyErrorResponse,
  communityJson,
  isSameOriginCommunityRequest,
  readBoundedJson,
} from "@/lib/community/http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  if (!isSameOriginCommunityRequest(request)) {
    return communityJson({
      ok: false,
      error: "invalid_request",
      message: "Refresh the page and try again.",
    }, 403);
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return communityJson({
      ok: false,
      error: "invalid_body",
      message: "Send a valid marketing preference.",
    }, 400);
  }

  const body = await readBoundedJson(request);
  if (!body.ok) return bodyErrorResponse(body.reason);
  if (!isMarketingConsentBody(body.value)) {
    return communityJson({
      ok: false,
      error: "invalid_input",
      message: "Send only a marketing preference.",
    }, 400);
  }

  try {
    if (getBackendMode() === "local") {
      const session = await getDemoSession();
      if (!session) {
        return communityJson({ ok: false, error: "unauthorized", message: "Log in to update your preference." }, 401);
      }

      await setDemoSession({ ...session, marketingConsent: body.value.marketingConsent });
      return communityJson({ ok: true, marketingConsent: body.value.marketingConsent });
    }

    const actor = await getCommunityActorForRequest();
    if (!actor) {
      return communityJson({ ok: false, error: "unauthorized", message: "Log in to update your preference." }, 401);
    }

    const result = await createServiceRoleClient()
      .from("profiles")
      .update({ marketing_consent: body.value.marketingConsent })
      .eq("id", actor.userId)
      .select("id")
      .maybeSingle();

    if (result.error || !result.data) {
      return communityJson({
        ok: false,
        error: "unavailable",
        message: "We could not save your preference right now. Please try again.",
      }, 503);
    }

    return communityJson({ ok: true, marketingConsent: body.value.marketingConsent });
  } catch (error) {
    console.error("Marketing preference update failed", {
      type: error instanceof Error ? error.name : typeof error,
    });
    return communityJson({
      ok: false,
      error: "unavailable",
      message: "We could not save your preference right now. Please try again.",
    }, 503);
  }
}

function isMarketingConsentBody(value: unknown): value is { marketingConsent: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).length === 1 && typeof body.marketingConsent === "boolean";
}
