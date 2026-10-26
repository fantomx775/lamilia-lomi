import "server-only";

import { communityJson } from "./http";
import { getCommunityActorForRequest } from "./session";
import type { CommunityActor } from "./session";

export async function getCommunityAdminAccess(): Promise<{ actor: CommunityActor; response?: never } | { actor?: never; response: Response }> {
  try {
    const actor = await getCommunityActorForRequest();
    if (!actor) return { response: communityJson({ ok: false, error: "unauthorized", message: "Zaloguj się, aby otworzyć moderację." }, 401) };
    if (!actor.emailVerified || actor.role !== "admin") {
      return { response: communityJson({ ok: false, error: "forbidden", message: "Ta sekcja jest dostępna tylko dla administratorów." }, 403) };
    }
    return { actor };
  } catch {
    return { response: communityJson({ ok: false, error: "unavailable", message: "Nie można teraz sprawdzić uprawnień." }, 503) };
  }
}
