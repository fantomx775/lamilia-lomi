import { communityErrorResponse, communityJson } from "@/lib/community/http";
import { listCommunityReports } from "@/lib/community/repository";
import type { CommunityReportStatus } from "@/lib/community/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const STATUSES = ["open", "reviewed", "resolved", "dismissed", "all"] as const;

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
