import { CommunityValidationError } from "@/lib/community/errors";
import { communityErrorResponse, communityJson } from "@/lib/community/http";
import { getCommunityModerationArtwork } from "@/lib/community/repository";
import { getCommunityAdminAccess } from "@/lib/community/admin-http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Context = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: Context) {
  try {
    const access = await getCommunityAdminAccess();
    if (access.response) return access.response;
    const { id } = await params;
    if (!uuid.test(id)) throw new CommunityValidationError("Invalid artwork ID.");
    const result = await getCommunityModerationArtwork(id);
    if (!result) return communityJson({ ok: false, error: "not_found", message: "Ta praca nie jest już dostępna." }, 404);
    return communityJson({ ok: true, ...result });
  } catch (error) {
    return communityErrorResponse(error, "Moderation data changed. Refresh the queue.");
  }
}
