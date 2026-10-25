import "server-only";

import { createServiceRoleClient } from "../supabase/admin";
import { buildCommunityStoragePath, hashCommunityRateLimitKey } from "./local-store";
import { mapCommunityDatabaseError } from "./errors";
import { COMMUNITY_RULES_VERSION } from "./rules";
import type { CommunityActor } from "./session";
import type {
  CommunityAdminArtwork,
  CommunityAudience,
  CommunityCreateArtworkInput,
  CommunityOwnerArtwork,
  CommunityPage,
  CommunityPublicArtwork,
  CommunityPublicCreator,
} from "./types";

const PUBLIC_ARTWORK_SELECT = "id,product_id,content_type,description,published_at,community_profiles:community_profiles!community_artworks_author_profile_fkey!inner(username,avatar_seed,is_adult,opted_in_at,participation_revoked_at,suspended_at,rules_version),products!inner(id,slug,audience,status,product_translations!inner(locale,title))";
const OWNER_ARTWORK_SELECT = "id,product_id,content_type,description,status,revision,moderation_reason,created_at,updated_at,products(id,slug,audience,status,product_translations(locale,title))";
const ADMIN_ARTWORK_SELECT = `${OWNER_ARTWORK_SELECT},community_profiles(username)`;

type Row = Record<string, unknown>;

export async function listPublicArtworks(input: {
  audience?: CommunityAudience;
  productId?: string;
  limit: number;
  cursor?: string | null;
}): Promise<CommunityPage<CommunityPublicArtwork>> {
  const offset = parseOffset(input.cursor);
  const client = createServiceRoleClient();
  let query = client.from("community_artworks")
    .select(PUBLIC_ARTWORK_SELECT)
    .eq("status", "approved")
    .is("deleted_at", null)
    .not("published_at", "is", null)
    .eq("products.status", "published")
    .eq("products.product_translations.locale", "en")
    .eq("community_profiles.is_adult", true)
    .not("community_profiles.opted_in_at", "is", null)
    .is("community_profiles.participation_revoked_at", null)
    .is("community_profiles.suspended_at", null)
    .eq("community_profiles.rules_version", COMMUNITY_RULES_VERSION);
  if (input.productId) query = query.eq("product_id", input.productId);
  if (input.audience) query = query.eq("products.audience", input.audience);
  const { data, error } = await query
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + input.limit);
  if (error) throw new Error("Community gallery read failed.");
  const rows = (data ?? []) as unknown as Row[];
  return {
    items: rows.slice(0, input.limit).map(mapPublicArtwork),
    nextCursor: rows.length > input.limit ? String(offset + input.limit + 1) : null,
  };
}

export async function getPublicArtwork(id: string): Promise<CommunityPublicArtwork | null> {
  const client = createServiceRoleClient();
  const { data, error } = await client.from("community_artworks")
    .select(PUBLIC_ARTWORK_SELECT)
    .eq("id", id)
    .eq("status", "approved")
    .is("deleted_at", null)
    .not("published_at", "is", null)
    .eq("products.status", "published")
    .eq("products.product_translations.locale", "en")
    .eq("community_profiles.is_adult", true)
    .not("community_profiles.opted_in_at", "is", null)
    .is("community_profiles.participation_revoked_at", null)
    .is("community_profiles.suspended_at", null)
    .eq("community_profiles.rules_version", COMMUNITY_RULES_VERSION)
    .maybeSingle();
  if (error) throw new Error("Community artwork read failed.");
  return data ? mapPublicArtwork(data as unknown as Row) : null;
}

export async function getPublicCreator(username: string, limit: number): Promise<{
  creator: CommunityPublicCreator;
  artworks: CommunityPublicArtwork[];
} | null> {
  const client = createServiceRoleClient();
  const { data: profile, error: profileError } = await client.from("community_profiles")
    .select("user_id,username,avatar_seed")
    .eq("username", username)
    .eq("is_adult", true)
    .not("opted_in_at", "is", null)
    .is("participation_revoked_at", null)
    .is("suspended_at", null)
    .eq("rules_version", COMMUNITY_RULES_VERSION)
    .maybeSingle();
  if (profileError) throw new Error("Community creator read failed.");
  if (!profile) return null;
  const { data, error } = await client.from("community_artworks")
    .select(PUBLIC_ARTWORK_SELECT)
    .eq("status", "approved")
    .is("deleted_at", null)
    .not("published_at", "is", null)
    .eq("author_id", String(profile.user_id))
    .eq("products.status", "published")
    .eq("products.product_translations.locale", "en")
    .eq("community_profiles.is_adult", true)
    .not("community_profiles.opted_in_at", "is", null)
    .is("community_profiles.participation_revoked_at", null)
    .is("community_profiles.suspended_at", null)
    .eq("community_profiles.rules_version", COMMUNITY_RULES_VERSION)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Community creator artwork read failed.");
  return {
    creator: { username: String(profile.username), avatarSeed: String(profile.avatar_seed) },
    artworks: ((data ?? []) as unknown as Row[]).map(mapPublicArtwork),
  };
}

export async function listOwnerArtworks(actor: CommunityActor, limit: number): Promise<CommunityOwnerArtwork[]> {
  const { data, error } = await createServiceRoleClient().from("community_artworks")
    .select(OWNER_ARTWORK_SELECT)
    .eq("author_id", actor.userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Your community artwork could not be loaded.");
  return ((data ?? []) as unknown as Row[]).map(mapOwnerArtwork);
}

export async function listAdminQueue(actor: CommunityActor, limit: number): Promise<CommunityAdminArtwork[]> {
  if (actor.role !== "admin") throw new Error("Administrator access required.");
  const client = createServiceRoleClient();
  const { data, error } = await client.from("community_artworks")
    .select(ADMIN_ARTWORK_SELECT)
    .eq("status", "pending")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw new Error("Community moderation queue could not be loaded.");
  return ((data ?? []) as unknown as Row[]).map(mapAdminArtwork);
}

export async function getOwnerProfile(actor: CommunityActor) {
  const { data, error } = await createServiceRoleClient().from("community_profiles")
    .select("username,avatar_seed,is_adult,adult_attested_at,opted_in_at,participation_revoked_at,rules_version,accepted_at,suspended_at")
    .eq("user_id", actor.userId)
    .maybeSingle();
  if (error) throw new Error("Community profile could not be loaded.");
  if (!data) return null;
  return {
    username: String(data.username),
    avatarSeed: String(data.avatar_seed),
    isAdult: data.is_adult === true,
    adultAttestedAt: nullableString(data.adult_attested_at),
    optedInAt: nullableString(data.opted_in_at),
    participationRevokedAt: nullableString(data.participation_revoked_at),
    rulesVersion: String(data.rules_version),
    acceptedAt: String(data.accepted_at),
    suspendedAt: nullableString(data.suspended_at),
  };
}

export async function joinCommunity(actor: CommunityActor, input: { username: string; adultAttested: boolean }) {
  return rpc("community_join", {
    p_actor_user_id: actor.userId,
    p_username: input.username,
    p_adult_attested: input.adultAttested,
    p_rules_version: COMMUNITY_RULES_VERSION,
  });
}

export async function changeUsername(actor: CommunityActor, username: string) {
  return rpc("community_change_username", { p_actor_user_id: actor.userId, p_username: username });
}

export async function leaveCommunity(actor: CommunityActor) {
  return rpc("community_revoke_participation", { p_actor_user_id: actor.userId });
}

export async function createPendingArtwork(actor: CommunityActor, input: CommunityCreateArtworkInput) {
  return rpc("community_create_pending_artwork", {
    p_actor_user_id: actor.userId,
    p_product_id: input.productId,
    p_storage_path: buildCommunityStoragePath(actor.userId, input.idempotencyKey),
    p_storage_provider: input.storageProvider,
    p_content_type: input.contentType,
    p_size_bytes: input.sizeBytes,
    p_description: input.description ?? "",
    p_idempotency_key: input.idempotencyKey,
  });
}

export async function editArtworkDescription(actor: CommunityActor, id: string, revision: number, description: string) {
  return rpc("community_edit_artwork_description", {
    p_actor_user_id: actor.userId, p_artwork_id: id,
    p_expected_revision: revision, p_description: description,
  });
}

export async function deleteArtwork(actor: CommunityActor, id: string, revision: number) {
  return rpc("community_delete_artwork", {
    p_actor_user_id: actor.userId, p_artwork_id: id, p_expected_revision: revision,
  });
}

export async function moderateArtwork(
  actor: CommunityActor,
  id: string,
  revision: number,
  action: "approve" | "reject" | "remove" | "restore",
  reason?: string,
) {
  return rpc("community_moderate_artwork", {
    p_actor_user_id: actor.userId,
    p_artwork_id: id,
    p_expected_revision: revision,
    p_action: action,
    p_reason: reason ?? null,
  });
}

export async function consumeRateLimit(scope: string, identifier: string, maxHits: number, windowSeconds: number) {
  const key = hashCommunityRateLimitKey(scope, identifier);
  return rpc("community_consume_rate_limit", {
    p_bucket_key: key, p_max_hits: maxHits, p_window_seconds: windowSeconds,
  });
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await createServiceRoleClient().rpc(name, args as never);
  if (error) throw mapCommunityDatabaseError(error.code ?? "");
  return data;
}

function mapPublicArtwork(row: Row): CommunityPublicArtwork {
  const product = one(row.products);
  const profile = one(row.community_profiles);
  const translation = list(product.product_translations).find((candidate) => candidate.locale === "en");
  return {
    id: String(row.id),
    product: {
      id: String(product.id),
      slug: String(product.slug),
      title: typeof translation?.title === "string" ? translation.title : String(product.slug),
      audience: product.audience as CommunityAudience,
    },
    creator: { username: String(profile.username), avatarSeed: String(profile.avatar_seed) },
    contentType: row.content_type as CommunityPublicArtwork["contentType"],
    description: String(row.description ?? ""),
    publishedAt: String(row.published_at),
  };
}

function mapOwnerArtwork(row: Row): CommunityOwnerArtwork {
  const product = one(row.products);
  const translation = list(product.product_translations).find((candidate) => candidate.locale === "en");
  return {
    id: String(row.id),
    product: {
      id: String(product.id), slug: String(product.slug),
      title: typeof translation?.title === "string" ? translation.title : String(product.slug),
      audience: product.audience as CommunityAudience,
    },
    contentType: row.content_type as CommunityOwnerArtwork["contentType"],
    description: String(row.description ?? ""),
    status: row.status as CommunityOwnerArtwork["status"],
    revision: Number(row.revision),
    rejectionReason: ["rejected", "removed"].includes(String(row.status)) ? nullableString(row.moderation_reason) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapAdminArtwork(row: Row): CommunityAdminArtwork {
  const profile = one(row.community_profiles);
  return {
    ...mapOwnerArtwork(row),
    creatorUsername: typeof profile.username === "string" ? profile.username : null,
    publishedAt: nullableString(row.published_at),
  };
}

function one(value: unknown): Row {
  if (Array.isArray(value)) return (value[0] ?? {}) as Row;
  return (value && typeof value === "object" ? value : {}) as Row;
}

function list(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object") : [];
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseOffset(cursor: string | null | undefined) {
  if (!cursor) return 0;
  if (!/^\d{1,8}$/.test(cursor)) return 0;
  return Math.min(Number(cursor), 1_000_000);
}
