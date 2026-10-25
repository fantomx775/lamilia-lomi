import "server-only";

import { getBackendMode } from "../config";
import { getDemoSession, getSupabaseAuthContext } from "../session.server";
import { deriveLocalCommunityUserId, type LocalCommunityActor } from "./local-store";

export type CommunityActor = LocalCommunityActor & { backend: "local" | "supabase" };

/** Resolves identity from a signed local cookie or Supabase's verified getUser call. */
export async function getCommunityActorForRequest(): Promise<CommunityActor | null> {
  if (getBackendMode() === "local") {
    const session = await getDemoSession();
    if (!session) return null;
    return {
      backend: "local",
      userId: session.userId ?? deriveLocalCommunityUserId(session.email),
      emailVerified: session.emailVerified,
      role: session.role,
      unlockedProductIds: session.unlockedProductIds,
    };
  }

  const context = await getSupabaseAuthContext();
  if (!context.user) return null;
  const { data: profile, error } = await context.supabase!
    .from("profiles")
    .select("role")
    .eq("id", context.user.id)
    .maybeSingle();
  if (error) throw new Error("Could not validate the community account role.");
  return {
    backend: "supabase",
    userId: context.user.id,
    emailVerified: Boolean(context.user.email_confirmed_at),
    role: profile?.role === "admin" ? "admin" : "user",
    unlockedProductIds: [],
  };
}

export async function assertCommunityActor(role?: "user" | "admin") {
  const actor = await getCommunityActorForRequest();
  if (!actor || !actor.emailVerified) throw new Error("A verified account is required.");
  if (role && actor.role !== role) throw new Error("Community authorization denied.");
  return actor;
}
