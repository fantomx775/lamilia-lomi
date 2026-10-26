import { communityErrorResponse, communityJson, isSameOriginCommunityRequest, readBoundedJson } from "@/lib/community/http";
import { listCommunityReports, updateCommunityReport } from "@/lib/community/repository";
import type { CommunityReportStatus } from "@/lib/community/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const STATUSES = ["open", "reviewed", "resolved", "dismissed", "all"] as const;
const ACTIONS = ["reviewed", "resolve", "dismiss"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const allowed = new Set(["status", "limit", "cursor"]);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key)) || [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)) {
    return communityJson({ ok: false, error: "invalid_input", message: "Check the report filters." }, 400);
  }
  const status = url.searchParams.get("status") ?? "open";
  const limitText = url.searchParams.get("limit") ?? "30";
  const limit = Number(limitText);
  const cursor = url.searchParams.get("cursor");
  if (!STATUSES.includes(status as typeof STATUSES[number]) || !/^(?:[1-9]|[1-4]\d|50)$/.test(limitText) || (cursor !== null && cursor.length > 256)) {
    return communityJson({ ok: false, error: "invalid_input", message: "Check the report filters." }, 400);
  }
  try {
    return communityJson({ ok: true, ...(await listCommunityReports({ status: status as CommunityReportStatus | "all", limit, cursor })) });
  } catch (error) {
    return communityErrorResponse(error, "Report access could not be verified.");
  }
}

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
