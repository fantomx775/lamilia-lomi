import { communityErrorResponse, communityJson, isSameOriginCommunityRequest, readBoundedJson } from "@/lib/community/http";
import { updateCommunityReport } from "@/lib/community/repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ACTIONS = ["reviewed", "resolve", "dismiss"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginCommunityRequest(request)) return communityJson({ ok: false, error: "forbidden", message: "This request could not be verified." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return communityJson({ ok: false, error: "invalid_body", message: "Send a valid report decision." }, 400);
  const body = await readBoundedJson(request);
  if (!body.ok) return communityJson({ ok: false, error: "invalid_body", message: "Send a valid report decision." }, 400);
  if (!isDecision(body.value)) return communityJson({ ok: false, error: "invalid_input", message: "Choose a report decision and current revision." }, 400);
  const { id } = await context.params;
  if (!UUID.test(id)) return communityJson({ ok: false, error: "not_found", message: "This report is unavailable." }, 404);
  try {
    const revision = await updateCommunityReport(id, body.value.revision, body.value.action);
    return communityJson({ ok: true, revision });
  } catch (error) {
    return communityErrorResponse(error, "Another administrator changed this report. Refresh and try again.");
  }
}

function isDecision(value: unknown): value is { revision: number; action: "reviewed" | "resolve" | "dismiss" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).length === 2 && Number.isSafeInteger(body.revision) && Number(body.revision) > 0
    && typeof body.action === "string" && ACTIONS.includes(body.action as typeof ACTIONS[number]);
}
