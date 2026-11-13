import "server-only";

import { getCommunityFlags } from "@/lib/community-flags";
import { getBackendMode } from "@/lib/config";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { isAvatarId, type AvatarView } from "./avatar-contract";
import { CommunityRateLimitError, mapCommunityDatabaseError } from "./errors";
import { hashCommunityRateLimitKey } from "./local-store";
import { COMMUNITY_RULES_VERSION } from "./rules";

const BUCKET = "community-avatars";

export function supportsCommunityAvatars() {
  return getBackendMode() === "supabase";
}

async function avatarRpc(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  const { data, error } = await createServiceRoleClient(signal ? { requestSignal: signal } : undefined).rpc(name, args);
  if (error) throw mapCommunityDatabaseError(error.code ?? "");
  return data;
}

export async function getOwnerAvatarView(userId: string): Promise<AvatarView> {
  const { data, error } = await createServiceRoleClient().from("community_profile_avatars")
    .select("id,status").eq("user_id", userId).neq("status", "uploading");
  if (error) throw new Error("Profile photo could not be loaded.");
  return {
    approvedId: data.find((row) => row.status === "approved")?.id ?? null,
    pending: data.some((row) => row.status === "pending"),
    rejected: data.some((row) => row.status === "rejected"),
  };
}

export async function consumeAvatarUploadRateLimit(userId: string) {
  const accepted = await avatarRpc("community_consume_rate_limit", {
    p_bucket_key: hashCommunityRateLimitKey("avatar", userId), p_window_seconds: 3600, p_max_hits: 6,
  });
  if (!accepted) throw new CommunityRateLimitError("Too many photo attempts. Try again later.");
}

export async function uploadCommunityAvatar(userId: string, bytes: Uint8Array) {
  const id: unknown = await avatarRpc("community_avatar_reserve", { p_user: userId });
  if (typeof id !== "string" || !isAvatarId(id)) throw new Error("Could not reserve a profile photo.");
  const { error } = await createServiceRoleClient({ storageRequestTimeoutMs: 45_000 })
    .storage.from(BUCKET).upload(id, bytes, { contentType: "image/webp", cacheControl: "0", upsert: false });
  if (error) {
    await createServiceRoleClient().from("community_profile_avatars").delete()
      .eq("id", id).eq("user_id", userId).eq("status", "uploading");
    throw new Error("Could not save the profile photo.");
  }
  await avatarRpc("community_avatar_finalize", { p_user: userId, p_id: id });
}

export async function removeCommunityAvatar(userId: string) {
  await avatarRpc("community_avatar_remove", { p_user: userId });
}

function activeAvatarProfiles() {
  return createServiceRoleClient().from("community_profile_avatars")
    .select("id,user_id,created_at,status,community_profiles!inner(username)")
    .eq("community_profiles.is_adult", true)
    .not("community_profiles.opted_in_at", "is", null)
    .is("community_profiles.participation_revoked_at", null)
    .is("community_profiles.suspended_at", null)
    .eq("community_profiles.rules_version", COMMUNITY_RULES_VERSION);
}

export async function getCommunityPublicAvatarUrls(usernames: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(usernames)].slice(0, 100);
  if (!unique.length || !supportsCommunityAvatars() || !getCommunityFlags().publicEnabled) return {};
  const rows = await avatarRpc("community_public_avatar_ids", { p_usernames: unique }) as { username: string; avatar_id: string }[];
  return Object.fromEntries(rows.map((row) => [row.username, `/api/community/avatars/${row.avatar_id}`]));
}

export async function getCommunityPublicAvatarUrl(username: string) {
  return (await getCommunityPublicAvatarUrls([username]))[username];
}

export async function readCommunityAvatar(id: string, access: "public" | "owner" | "admin", userId?: string) {
  const query = activeAvatarProfiles().eq("id", id);
  if (access !== "admin") query.eq("status", "approved");
  if (access === "owner") {
    if (!userId) return null;
    query.eq("user_id", userId);
  }
  if (access === "admin") query.in("status", ["approved", "pending"]);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  const { data: blob, error: storageError } = await createServiceRoleClient({ storageRequestTimeoutMs: 15_000 })
    .storage.from(BUCKET).download(id);
  if (storageError || !blob) return null;
  const [latest, verified] = await Promise.all([
    query.maybeSingle(),
    avatarRpc("community_avatar_owner_is_verified", { p_user: data.user_id }),
  ]);
  if (latest.error || !latest.data || verified !== true) return null;
  return new Response(blob, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Vary": "Cookie",
    },
  });
}

export async function listCommunityAvatarModeration(page: number, status: "reported" | "approved", username?: string) {
  const pageSize = 24;
  // Filter reported photos in SQL, avoiding an unbounded preliminary report-ID fetch.
  const projection = status === "reported"
    ? "id,user_id,created_at,status,community_profiles!inner(username),community_avatar_reports!inner(reason,details,created_at)"
    : "id,user_id,created_at,status,community_profiles!inner(username),community_avatar_reports(reason,details,created_at)";
  const query = activeAvatarProfiles().select(projection).eq("status", "approved").order("created_at", { ascending: true })
    .order("id", { ascending: true }).range(page * pageSize, (page + 1) * pageSize);
  if (username) query.eq("community_profiles.username", username);
  const { data, error } = await query;
  if (error) throw new Error("Could not load the photo moderation queue.");
  return {
    items: data.slice(0, pageSize).map((row) => {
      const profile = Array.isArray(row.community_profiles) ? row.community_profiles[0] : row.community_profiles;
      return { id: String(row.id), username: String(profile?.username), createdAt: String(row.created_at), reports: row.community_avatar_reports ?? [] };
    }),
    hasNext: data.length > pageSize,
  };
}

export async function reviewCommunityAvatar(adminId: string, id: string, decision: "removed") {
  await avatarRpc("community_avatar_review", { p_admin: adminId, p_id: id, p_decision: decision });
}

export async function removeCommunityAvatarObject(id: string, signal?: AbortSignal) {
  if (!isAvatarId(id)) throw new Error("Invalid avatar cleanup key.");
  const { error } = await createServiceRoleClient({ storageRequestTimeoutMs: 15_000, requestSignal: signal })
    .storage.from(BUCKET).remove([id]);
  if (error) throw new Error("Profile photo deletion will retry.");
}

export async function submitCommunityAvatarReport(userId: string, id: string, reason: string, details: string) {
  if (!isAvatarId(id)) throw new Error("Invalid profile photo.");
  const accepted = await avatarRpc("community_consume_rate_limit", {
    p_bucket_key: hashCommunityRateLimitKey("avatar-report", userId), p_window_seconds: 3600, p_max_hits: 10,
  });
  if (!accepted) throw new CommunityRateLimitError("Too many reports. Try again later.");
  return { duplicate: await avatarRpc("community_avatar_report", {
    p_actor: userId, p_id: id, p_reason: reason, p_details: details,
  }) === true };
}
