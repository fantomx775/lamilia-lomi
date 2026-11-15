import { getCommunityFlags } from "@/lib/community-flags";
import { isAvatarId } from "@/lib/community/avatar-contract";
import { readCommunityAvatar, supportsCommunityAvatars } from "@/lib/community/avatar-repository";
import { communityJson } from "@/lib/community/http";
import { getCommunityActorForRequest } from "@/lib/community/session";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notFound = () => communityJson({ error: "not_found" }, 404);
  if (!isAvatarId(id) || !supportsCommunityAvatars()) return notFound();

  try {
    if (new URL(request.url).searchParams.get("owner") === "1") {
      const actor = await getCommunityActorForRequest();
      if (!actor?.emailVerified) return notFound();
      return await readCommunityAvatar(id, "owner", actor.userId) ?? notFound();
    }
    if (!getCommunityFlags().publicEnabled) return notFound();
    return await readCommunityAvatar(id, "public") ?? notFound();
  } catch {
    return notFound();
  }
}
