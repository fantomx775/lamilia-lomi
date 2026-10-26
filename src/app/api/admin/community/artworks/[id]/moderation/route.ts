import { CommunityValidationError } from "@/lib/community/errors";
import {
  bodyErrorResponse,
  communityErrorResponse,
  communityJson,
  isSameOriginCommunityRequest,
  readBoundedJson,
} from "@/lib/community/http";
import { getCommunityModerationArtwork, moderateCommunityArtwork } from "@/lib/community/repository";
import { getCommunityAdminAccess } from "@/lib/community/admin-http";
import type { CommunityModerationAction } from "@/lib/community/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
type Context = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actions = new Set<CommunityModerationAction>(["approve", "reject", "remove", "restore"]);

export async function POST(request: Request, { params }: Context) {
  const access = await getCommunityAdminAccess();
  if (access.response) return access.response;
  if (!isSameOriginCommunityRequest(request)) return communityJson({ ok: false, error: "invalid_request", message: "Odśwież stronę i spróbuj ponownie." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return communityJson({ ok: false, error: "invalid_body", message: "Wyślij prawidłowe żądanie moderacji." }, 400);
  }
  const body = await readBoundedJson(request);
  if (!body.ok) return bodyErrorResponse(body.reason);
  if (!isModerationBody(body.value)) return communityJson({ ok: false, error: "invalid_input", message: "Podaj działanie, powód i aktualną wersję pracy." }, 400);
  try {
    const { id } = await params;
    if (!uuid.test(id)) throw new CommunityValidationError("Invalid artwork ID.");
    await moderateCommunityArtwork(id, body.value.revision, body.value.action, body.value.reason);
    const result = await getCommunityModerationArtwork(id);
    return result
      ? communityJson({ ok: true, ...result })
      : communityJson({ ok: false, error: "not_found", message: "Ta praca nie jest już dostępna." }, 404);
  } catch (error) {
    return communityErrorResponse(error, "Inny administrator zmienił tę pracę. Odśwież dane przed kolejną decyzją.");
  }
}

function isModerationBody(value: unknown): value is { action: CommunityModerationAction; revision: number; reason?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const allowed = new Set(["action", "revision", "reason"]);
  if (Object.keys(body).some((key) => !allowed.has(key)) || !actions.has(body.action as CommunityModerationAction)
    || !Number.isSafeInteger(body.revision) || Number(body.revision) < 1) return false;
  if (body.action === "reject" || body.action === "remove") {
    return typeof body.reason === "string" && body.reason.trim().length >= 1 && body.reason.trim().length <= 500;
  }
  return body.reason === undefined;
}
