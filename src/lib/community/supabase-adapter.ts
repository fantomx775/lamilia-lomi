import "server-only";

import { createServiceRoleClient } from "../supabase/admin";
import { buildCommunityStoragePath, hashCommunityRateLimitKey } from "./local-store";
import { CommunityAuthorizationError, mapCommunityDatabaseError } from "./errors";
import { COMMUNITY_RULES_VERSION } from "./rules";
import { decodeCommunityPopularCursor, decodeCommunityTimestampCursor, encodeCommunityPopularCursor, encodeCommunityTimestampCursor } from "./cursor";
import type { CommunityActor } from "./session";
import type {
  CommunityAdminArtwork,
  CommunityAdminProductOption,
  CommunityArtworkStatus,
  CommunityAudience,
  CommunityCreateArtworkInput,
  CommunityOwnerArtwork,
  CommunityPage,
  CommunityModerationCounts,
  CommunityModerationHistoryItem,
  CommunityPublicArtwork,
  CommunityPublicCreator,
  CommunityStorageProvider,
} from "./types";
import type { CommunityUploadReservationInput } from "./local-store";

const PUBLIC_ARTWORK_SELECT = "id,product_id,content_type,description,published_at,likes_count,community_profiles:community_profiles!community_artworks_author_profile_fkey!inner(username,avatar_seed,is_adult,opted_in_at,participation_revoked_at,suspended_at,rules_version),products!inner(id,slug,audience,status,product_translations!inner(locale,title))";
const OWNER_ARTWORK_SELECT = "id,product_id,content_type,description,status,revision,moderation_reason,created_at,updated_at,products(id,slug,audience,status,product_translations(locale,title))";
const ADMIN_ARTWORK_SELECT = `${OWNER_ARTWORK_SELECT},community_profiles(username)`;

type Row = Record<string, unknown>;

export async function listPublicArtworks(input: {
  audience?: CommunityAudience;
  productId?: string;
  limit: number;
  cursor?: string | null;
  sort?: "latest" | "popular";
  viewerUserId?: string;
}): Promise<CommunityPage<CommunityPublicArtwork>> {
  const sort = input.sort ?? "latest";
  const latestCursor = sort === "latest" ? decodeCommunityTimestampCursor(input.cursor) : null;
  const popularCursor = sort === "popular" ? decodeCommunityPopularCursor(input.cursor) : null;
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
  if (latestCursor) query = query.or(`published_at.lt.${latestCursor.timestamp},and(published_at.eq.${latestCursor.timestamp},id.lt.${latestCursor.id})`);
  if (popularCursor) query = query.or(`likes_count.lt.${popularCursor.likesCount},and(likes_count.eq.${popularCursor.likesCount},published_at.lt.${popularCursor.timestamp}),and(likes_count.eq.${popularCursor.likesCount},published_at.eq.${popularCursor.timestamp},id.lt.${popularCursor.id})`);
  query = sort === "popular"
    ? query.order("likes_count", { ascending: false }).order("published_at", { ascending: false }).order("id", { ascending: false })
    : query.order("published_at", { ascending: false }).order("id", { ascending: false });
  const { data, error } = await query.limit(input.limit + 1);
  if (error) throw new Error("Community gallery read failed.");
  const rows = (data ?? []) as unknown as Row[];
  const pageRows = rows.slice(0, input.limit);
  const likedIds = await getLikedArtworkIds(input.viewerUserId, pageRows);
  const items = pageRows.map((row) => mapPublicArtwork(row, likedIds.has(String(row.id))));
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > input.limit && last
      ? sort === "popular"
        ? encodeCommunityPopularCursor(last.likesCount, last.publishedAt, last.id)
        : encodeCommunityTimestampCursor(last.publishedAt, last.id)
      : null,
  };
}

export async function listPublicProductOptions(limit = 200) {
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 200) : 200;
  const { data, error } = await createServiceRoleClient().from("products")
    .select("id,slug,audience,product_translations!inner(locale,title)")
    .eq("status", "published")
    .eq("product_translations.locale", "en")
    .order("slug", { ascending: true })
    .limit(safeLimit);
  if (error) throw new Error("Community book filters could not be loaded.");
  return ((data ?? []) as unknown as Row[]).map((row) => {
    const translation = list(row.product_translations).find((candidate) => candidate.locale === "en");
    return {
      id: String(row.id), slug: String(row.slug),
      title: typeof translation?.title === "string" ? translation.title : String(row.slug),
      audience: row.audience as CommunityAudience,
    };
  });
}

export async function getPublicArtwork(id: string, viewerUserId?: string): Promise<CommunityPublicArtwork | null> {
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
  if (!data) return null;
  const row = data as unknown as Row;
  const likedIds = await getLikedArtworkIds(viewerUserId, [row]);
  return mapPublicArtwork(row, likedIds.has(id));
}

export async function getPublicCreator(username: string, limit: number, viewerUserId?: string): Promise<{
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
  const rows = (data ?? []) as unknown as Row[];
  const likedIds = await getLikedArtworkIds(viewerUserId, rows);
  return {
    creator: { username: String(profile.username), avatarSeed: String(profile.avatar_seed) },
    artworks: rows.map((row) => mapPublicArtwork(row, likedIds.has(String(row.id)))),
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

export async function getOwnerArtwork(actor: CommunityActor, id: string): Promise<CommunityOwnerArtwork | null> {
  const { data, error } = await createServiceRoleClient().from("community_artworks")
    .select(OWNER_ARTWORK_SELECT)
    .eq("author_id", actor.userId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error("Your community artwork could not be loaded.");
  return data ? mapOwnerArtwork(data as unknown as Row) : null;
}

export async function listAdminArtworks(actor: CommunityActor, input: { status?: CommunityArtworkStatus | "all"; productId?: string; creator?: string; cursor?: string | null; limit: number }): Promise<CommunityPage<CommunityAdminArtwork> & { counts: CommunityModerationCounts }> {
  if (actor.role !== "admin") throw new Error("Administrator access required.");
  const client = createServiceRoleClient();
  const cursor = parseAdminCursor(input.cursor);
  const filterQuery = (status?: CommunityArtworkStatus) => {
    let query = client.from("community_artworks").select(input.creator
      ? "id,community_profiles:community_profiles!community_artworks_author_profile_fkey!inner(username)"
      : "id", { count: "exact", head: true }).is("deleted_at", null);
    if (status) query = query.eq("status", status);
    if (input.productId) query = query.eq("product_id", input.productId);
    if (input.creator) query = query.ilike("community_profiles.username", `${input.creator.replace(/[\\%_]/g, "\\$&")}%`);
    return query;
  };
  const statuses: CommunityArtworkStatus[] = ["pending", "approved", "rejected", "removed"];
  const countResults = await Promise.all(statuses.map((status) => filterQuery(status)));
  if (countResults.some((result) => result.error)) throw new Error("Community moderation counts could not be loaded.");
  const counts = Object.fromEntries(statuses.map((status, index) => [status, countResults[index].count ?? 0])) as CommunityModerationCounts;
  const adminSelect = input.creator
    ? `${OWNER_ARTWORK_SELECT},community_profiles:community_profiles!community_artworks_author_profile_fkey!inner(username)`
    : ADMIN_ARTWORK_SELECT;
  let query = client.from("community_artworks")
    .select(adminSelect)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (input.status && input.status !== "all") query = query.eq("status", input.status);
  if (input.productId) query = query.eq("product_id", input.productId);
  if (input.creator) query = query.ilike("community_profiles.username", `${input.creator.replace(/[\\%_]/g, "\\$&")}%`);
  if (cursor) query = query.or(`created_at.gt.${cursor.timestamp},and(created_at.eq.${cursor.timestamp},id.gt.${cursor.id})`);
  const { data, error } = await query.limit(input.limit + 1);
  if (error) throw new Error("Community moderation queue could not be loaded.");
  const rows = ((data ?? []) as unknown as Row[]);
  const items = rows.slice(0, input.limit).map(mapAdminArtwork);
  const last = items.at(-1);
  return { items, counts, nextCursor: rows.length > input.limit && last ? encodeAdminCursor(last.createdAt, last.id) : null };
}

export async function listAdminQueue(actor: CommunityActor, limit: number): Promise<CommunityAdminArtwork[]> {
  return (await listAdminArtworks(actor, { status: "pending", limit })).items;
}

export async function listAdminProductOptions(actor: CommunityActor, limit = 500): Promise<CommunityAdminProductOption[]> {
  if (actor.role !== "admin") throw new Error("Administrator access required.");
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 500) : 500;
  const { data, error } = await createServiceRoleClient().from("products")
    .select("id,slug,product_translations!inner(locale,title)")
    .eq("product_translations.locale", "en")
    .order("slug", { ascending: true })
    .limit(safeLimit);
  if (error) throw new Error("Community product filters could not be loaded.");
  return ((data ?? []) as unknown as Row[]).map((row) => {
    const translation = list(row.product_translations).find((candidate) => candidate.locale === "en");
    return { id: String(row.id), slug: String(row.slug), title: typeof translation?.title === "string" ? translation.title : String(row.slug) };
  });
}

export async function getAdminArtwork(actor: CommunityActor, id: string): Promise<{ artwork: CommunityAdminArtwork; history: CommunityModerationHistoryItem[] } | null> {
  if (actor.role !== "admin") throw new Error("Administrator access required.");
  const client = createServiceRoleClient();
  const { data, error } = await client.from("community_artworks").select(ADMIN_ARTWORK_SELECT)
    .eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new Error("Community moderation detail could not be loaded.");
  if (!data) return null;
  const { data: events, error: historyError } = await client.from("community_moderation_events")
    .select("id,revision,from_status,to_status,reason,created_at")
    .eq("artwork_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(100);
  if (historyError) throw new Error("Community moderation history could not be loaded.");
  const history = ((events ?? []) as unknown as Row[]).reverse().map((row): CommunityModerationHistoryItem => ({
    id: String(row.id), revision: Number(row.revision),
    fromStatus: nullableString(row.from_status) as CommunityArtworkStatus | null,
    toStatus: String(row.to_status) as CommunityArtworkStatus,
    reason: nullableString(row.reason), createdAt: String(row.created_at), moderatorLabel: "Administrator",
  }));
  return { artwork: mapAdminArtwork(data as unknown as Row), history };
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

export async function reserveArtworkUpload(actor: CommunityActor, input: CommunityUploadReservationInput) {
  const data = await rpc("community_reserve_upload", {
    p_actor_user_id: actor.userId,
    p_lease_token: input.reservationToken,
    p_product_id: input.productId,
    p_idempotency_key: input.idempotencyKey,
    p_upload_fingerprint: input.uploadFingerprint,
    p_storage_provider: input.storageProvider,
    p_original_size_bytes: input.originalSizeBytes,
    p_size_bytes: input.sizeBytes,
    p_content_type: input.contentType,
    p_description: input.description,
  }) as Record<string, unknown>;
  if (data.state === "finalized" && typeof data.artworkId === "string") {
    return { state: "finalized" as const, artworkId: data.artworkId };
  }
  if ((data.state === "reserved" || data.state === "stored") && typeof data.leaseToken === "string"
    && typeof data.storagePath === "string"
    && (data.storageProvider === "local" || data.storageProvider === "supabase" || data.storageProvider === "r2")) {
    return {
      state: data.state as "reserved" | "stored",
      leaseToken: data.leaseToken,
      storagePath: data.storagePath,
      storageProvider: data.storageProvider as CommunityStorageProvider,
    };
  }
  throw new Error("Community upload reservation is unavailable.");
}

export async function assertUploadEligibility(actor: CommunityActor, productId: string) {
  const client = createServiceRoleClient();
  const [profileResult, productResult, unlockResult] = await Promise.all([
    client.from("community_profiles")
      .select("is_adult,adult_attested_at,opted_in_at,participation_revoked_at,suspended_at,rules_version")
      .eq("user_id", actor.userId)
      .maybeSingle(),
    client.from("products").select("id,status").eq("id", productId).maybeSingle(),
    client.from("user_product_unlocks").select("product_id").eq("user_id", actor.userId).eq("product_id", productId).maybeSingle(),
  ]);
  if (profileResult.error || productResult.error || unlockResult.error) {
    throw new Error("Community upload eligibility could not be checked.");
  }
  const profile = profileResult.data;
  if (!profile || profile.is_adult !== true || !profile.adult_attested_at || !profile.opted_in_at
    || profile.participation_revoked_at || profile.suspended_at || profile.rules_version !== COMMUNITY_RULES_VERSION) {
    throw new CommunityAuthorizationError("Active community membership required.");
  }
  if (productResult.data?.status !== "published" || !unlockResult.data) {
    throw new CommunityAuthorizationError("A published, unlocked product is required.");
  }
}

export async function finalizeArtworkUpload(actor: CommunityActor, idempotencyKey: string, leaseToken: string) {
  return rpc("community_finalize_upload", {
    p_actor_user_id: actor.userId,
    p_idempotency_key: idempotencyKey,
    p_lease_token: leaseToken,
  }) as Promise<string>;
}

export async function markArtworkUploadStored(actor: CommunityActor, idempotencyKey: string, leaseToken: string) {
  return rpc("community_mark_upload_stored", {
    p_actor_user_id: actor.userId,
    p_idempotency_key: idempotencyKey,
    p_lease_token: leaseToken,
  });
}

export async function getArtworkUploadReservation(actor: CommunityActor, idempotencyKey: string) {
  const { data, error } = await createServiceRoleClient().from("community_upload_reservations")
    .select("state,artwork_id,lease_token,storage_path,storage_provider,upload_fingerprint")
    .eq("author_id", actor.userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw new Error("Community upload status could not be checked.");
  return data ? {
    state: String(data.state),
    artworkId: nullableString(data.artwork_id),
    leaseToken: String(data.lease_token),
    storagePath: String(data.storage_path),
    storageProvider: String(data.storage_provider) as CommunityStorageProvider,
    uploadFingerprint: String(data.upload_fingerprint),
  } : null;
}

export async function scheduleArtworkUploadCleanup(actor: CommunityActor, idempotencyKey: string, leaseToken: string) {
  return rpc("community_schedule_upload_cleanup", {
    p_actor_user_id: actor.userId,
    p_idempotency_key: idempotencyKey,
    p_lease_token: leaseToken,
  });
}

export async function claimArtworkUploadCleanup(limit = 10) {
  const data = await rpc("community_claim_upload_cleanup", { p_limit: limit });
  return (Array.isArray(data) ? data : []).map((row) => {
    const value = row as Row;
    return {
      authorId: String(value.author_id),
      idempotencyKey: String(value.idempotency_key),
      storagePath: String(value.storage_path),
      storageProvider: String(value.storage_provider) as CommunityStorageProvider,
      leaseToken: String(value.cleanup_token),
    };
  });
}

export async function finishArtworkUploadCleanup(candidate: { authorId: string; idempotencyKey: string; leaseToken: string }) {
  return rpc("community_finish_upload_cleanup", {
    p_actor_user_id: candidate.authorId,
    p_idempotency_key: candidate.idempotencyKey,
    p_cleanup_token: candidate.leaseToken,
  });
}

export async function getArtworkMediaForRequest(id: string, actor?: CommunityActor) {
  const client = createServiceRoleClient();
  let query = client.from("community_artworks")
    .select("author_id,storage_path,storage_provider,content_type,status,deleted_at,published_at,community_profiles!community_artworks_author_profile_fkey!inner(is_adult,opted_in_at,participation_revoked_at,suspended_at,rules_version),products!inner(status)")
    .eq("id", id)
    .is("deleted_at", null);
  if (actor?.role === "admin") {
    // Admin media access is needed for private moderation preview; actor role came from current profiles.role.
  } else if (actor) {
    query = query.eq("author_id", actor.userId);
  } else {
    query = query.eq("status", "approved")
      .not("published_at", "is", null)
      .eq("products.status", "published")
      .eq("community_profiles.is_adult", true)
      .not("community_profiles.opted_in_at", "is", null)
      .is("community_profiles.participation_revoked_at", null)
      .is("community_profiles.suspended_at", null)
      .eq("community_profiles.rules_version", COMMUNITY_RULES_VERSION);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("Community image is unavailable.");
  if (!data || (actor?.role !== "admin" && actor && data.author_id !== actor.userId)) return null;
  return {
    authorId: String(data.author_id),
    storagePath: String(data.storage_path),
    storageProvider: String(data.storage_provider) as CommunityStorageProvider,
    contentType: String(data.content_type) as CommunityPublicArtwork["contentType"],
  };
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

export async function setArtworkLike(actor: CommunityActor, artworkId: string, liked: boolean) {
  const result = await rpc("community_set_artwork_like", {
    p_actor_user_id: actor.userId,
    p_artwork_id: artworkId,
    p_liked: liked,
  });
  if (!result || typeof result !== "object") throw new Error("Community operation failed.");
  const value = result as Record<string, unknown>;
  if (typeof value.available !== "boolean" || typeof value.liked !== "boolean"
    || !Number.isSafeInteger(value.likesCount) || Number(value.likesCount) < 0) {
    throw new Error("Community operation failed.");
  }
  return { available: value.available, liked: value.liked, likesCount: Number(value.likesCount) };
}

async function getLikedArtworkIds(viewerUserId: string | undefined, rows: Row[]) {
  if (!viewerUserId || rows.length === 0) return new Set<string>();
  const ids = rows.map((row) => String(row.id));
  const { data, error } = await createServiceRoleClient().from("community_artwork_likes")
    .select("artwork_id")
    .eq("user_id", viewerUserId)
    .in("artwork_id", ids);
  if (error) throw new Error("Community reaction state could not be loaded.");
  return new Set(((data ?? []) as unknown as Row[]).map((row) => String(row.artwork_id)));
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await createServiceRoleClient().rpc(name, args as never);
  if (error) throw mapCommunityDatabaseError(error.code ?? "");
  return data;
}

function mapPublicArtwork(row: Row, likedByMe = false): CommunityPublicArtwork {
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
    likesCount: Number.isSafeInteger(Number(row.likes_count)) ? Math.max(0, Number(row.likes_count)) : 0,
    likedByMe,
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

function encodeAdminCursor(createdAt: string, id: string) {
  return encodeCommunityTimestampCursor(createdAt, id);
}

function parseAdminCursor(cursor: string | null | undefined) {
  return decodeCommunityTimestampCursor(cursor);
}
