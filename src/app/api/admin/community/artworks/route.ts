import { CommunityValidationError } from "@/lib/community/errors";
import { communityErrorResponse, communityJson } from "@/lib/community/http";
import { listCommunityModerationQueue } from "@/lib/community/repository";
import { getCommunityAdminAccess } from "@/lib/community/admin-http";
import { decodeCommunityTimestampCursor } from "@/lib/community/cursor";
import type { CommunityArtworkStatus } from "@/lib/community/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const statuses = new Set(["pending", "approved", "rejected", "removed", "all"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const access = await getCommunityAdminAccess();
    if (access.response) return access.response;
    const params = new URL(request.url).searchParams;
    const statusValue = params.get("status") ?? "pending";
    const productId = params.get("productId") || undefined;
    const rawCreator = (params.get("creator") ?? "").trim().replace(/^@/, "").toLowerCase();
    const cursor = params.get("cursor") || null;
    const limitValue = params.get("limit");
    const limit = limitValue === null ? 30 : Number(limitValue);
    if (!statuses.has(statusValue) || (productId && !uuid.test(productId))
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 50
      || rawCreator.length > 24 || (rawCreator && !/^[a-z0-9_]+$/.test(rawCreator))
      || (cursor && !isValidCursor(cursor))) {
      throw new CommunityValidationError("Check the moderation filters and try again.");
    }
    const result = await listCommunityModerationQueue({
      status: statusValue as CommunityArtworkStatus | "all",
      productId,
      creator: rawCreator || undefined,
      cursor,
      limit,
    });
    return communityJson({ ok: true, ...result });
  } catch (error) {
    return communityErrorResponse(error, "Moderation data changed. Refresh the queue.");
  }
}

function isValidCursor(cursor: string) {
  return decodeCommunityTimestampCursor(cursor) !== null;
}
