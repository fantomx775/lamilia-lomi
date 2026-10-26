import "server-only";

import { getBackendMode } from "../config";
import { getCommunityFlags } from "../community-flags";
import { getContentSnapshot } from "../content-store";
import { assertCommunityActor, getCommunityActorForRequest } from "./session";
import type { CommunityActor } from "./session";
import {
  CommunityLocalStore,
  hashCommunityRateLimitKey,
} from "./local-store";
import type { CommunityUploadCleanupCandidate, CommunityUploadReservationInput } from "./local-store";
import * as supabase from "./supabase-adapter";
import { CommunityAuthorizationError, CommunityRateLimitError, CommunityValidationError } from "./errors";
import { COMMUNITY_RULES_VERSION } from "./rules";
import { encodeCommunityTimestampCursor, decodeCommunityTimestampCursor } from "./cursor";
import type {
  CommunityAudience,
  CommunityAdminProductOption,
  CommunityArtworkStatus,
  CommunityArtworkSort,
  CommunityCreateArtworkInput,
  CommunityHeartAccess,
  CommunityPage,
  CommunityReportReason,
  CommunityReportStatus,
  CommunityProfileInput,
  CommunityPublicArtwork,
  CommunityPublicProductOption,
} from "./types";
import { removeCommunityArtworkImage } from "./storage";

const localStore = new CommunityLocalStore();
const MAX_PAGE_SIZE = 100;

export { hashCommunityRateLimitKey };
export * from "./types";
export * from "./errors";

export async function listCommunityPublicArtworks(input: {
  audience?: CommunityAudience;
  productId?: string;
  limit?: number;
  cursor?: string | null;
  sort?: CommunityArtworkSort;
  viewer?: CommunityActor;
} = {}): Promise<CommunityPage<CommunityPublicArtwork>> {
  if (!getCommunityFlags().publicEnabled) return { items: [], nextCursor: null };
  const limit = boundedLimit(input.limit);
  if (getBackendMode() === "local") {
    return localStore.listPublicArtworks({ ...input, viewerUserId: input.viewer?.userId, limit, products: getContentSnapshot().products });
  }
  return supabase.listPublicArtworks({ ...input, viewerUserId: input.viewer?.userId, limit });
}

export async function getCommunityPublicArtwork(id: string, viewer?: CommunityActor) {
  if (!getCommunityFlags().publicEnabled || !isUuid(id)) return null;
  if (getBackendMode() === "local") return localStore.getPublicArtwork(id, getContentSnapshot().products, viewer?.userId);
  return supabase.getPublicArtwork(id, viewer?.userId);
}

export async function listCommunityPublicProductOptions(): Promise<CommunityPublicProductOption[]> {
  if (!getCommunityFlags().publicEnabled) return [];
  if (getBackendMode() === "local") {
    return localStore.listPublicProductOptions(getContentSnapshot().products, 200);
  }
  return supabase.listPublicProductOptions(200);
}

export async function getCommunityPublicCreator(username: string, viewer?: CommunityActor) {
  if (!getCommunityFlags().publicEnabled) return null;
  if (getBackendMode() === "local") {
    try {
      return await localStore.getPublicCreator(username, getContentSnapshot().products, 24, viewer?.userId);
    } catch {
      return null;
    }
  }
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const result = await supabase.getPublicCreator(normalized, 24, viewer?.userId);
  return result ? { username: result.creator.username, avatarSeed: result.creator.avatarSeed, artworks: result.artworks } : null;
}

/** Resolves safe public interaction state from the verified session and private profile. */
export async function getCommunityHeartContext(): Promise<{ access: CommunityHeartAccess; actor?: CommunityActor }> {
  const actor = await getCommunityActorForRequest();
  if (!actor) return { access: "guest" };
  if (!actor.emailVerified) return { access: "verify" };
  const profile = actor.backend === "local" ? await localStore.getProfile(actor) : await supabase.getOwnerProfile(actor);
  const active = Boolean(profile?.isAdult && profile.adultAttestedAt && profile.optedInAt
    && !profile.participationRevokedAt && !profile.suspendedAt && profile.rulesVersion === COMMUNITY_RULES_VERSION);
  return active ? { access: "member", actor } : { access: "join" };
}

export async function setCommunityArtworkLike(artworkId: string, liked: boolean) {
  if (!getCommunityFlags().publicEnabled) throw new CommunityAuthorizationError("Coloring Club reactions are unavailable.");
  const actor = await getCommunityActorForRequest();
  if (!actor || !actor.emailVerified) throw new CommunityAuthorizationError("A verified account is required.");
  if (!isUuid(artworkId) || typeof liked !== "boolean") throw new CommunityValidationError();
  if (!await consumeCommunityRateLimit("artwork-heart", actor.userId, 120, 60 * 60)) {
    throw new CommunityRateLimitError();
  }
  if (actor.backend === "local") return localStore.setArtworkLike(actor, artworkId, liked, getContentSnapshot().products);
  return supabase.setArtworkLike(actor, artworkId, liked);
}

export async function getMyCommunityProfile() {
  const actor = await getCommunityActorForRequest();
  if (!actor || !actor.emailVerified) return null;
  if (actor.backend === "local") return localStore.getProfile(actor);
  return supabase.getOwnerProfile(actor);
}

export async function joinColoringClub(input: CommunityProfileInput) {
  const actor = await assertCommunityActor();
  const flags = getCommunityFlags();
  if (!flags.publicEnabled && !flags.uploadsEnabled) throw new Error("Coloring Club is unavailable.");
  const normalizedInput = { ...input, username: normalizeUsernameForWrite(input.username) };
  if (actor.backend === "local") return localStore.join(actor, normalizedInput);
  await supabase.joinCommunity(actor, normalizedInput);
  return supabase.getOwnerProfile(actor);
}

export async function changeCommunityUsername(username: string) {
  const actor = await assertCommunityActor();
  const normalized = normalizeUsernameForWrite(username);
  if (actor.backend === "local") return localStore.changeUsername(actor, normalized);
  await supabase.changeUsername(actor, normalized);
  return supabase.getOwnerProfile(actor);
}

export async function leaveColoringClub() {
  const actor = await assertCommunityActor();
  if (actor.backend === "local") return localStore.leave(actor);
  return supabase.leaveCommunity(actor);
}

/** Metadata reservation only; image byte validation/storage is implemented in #81. */
export async function createPendingCommunityArtwork(input: CommunityCreateArtworkInput) {
  if (!getCommunityFlags().uploadsEnabled) throw new Error("Coloring Club uploads are unavailable.");
  const actor = await assertCommunityActor();
  if (actor.backend === "local") {
    return localStore.createPendingArtwork(actor, input, getContentSnapshot().products);
  }
  return supabase.createPendingArtwork(actor, input);
}

export async function reserveCommunityArtworkUpload(input: CommunityUploadReservationInput) {
  if (!getCommunityFlags().uploadsEnabled) throw new CommunityAuthorizationError("Coloring Club uploads are unavailable.");
  const actor = await assertCommunityActor();
  if (actor.backend === "local") return localStore.reserveArtworkUpload(actor, input, getContentSnapshot().products);
  return supabase.reserveArtworkUpload(actor, input);
}

export async function assertCommunityArtworkUploadEligibility(actor: CommunityActor, productId: string) {
  if (!getCommunityFlags().uploadsEnabled) throw new CommunityAuthorizationError("Coloring Club uploads are unavailable.");
  if (!actor.emailVerified) throw new CommunityAuthorizationError("Verified account required.");
  if (actor.backend === "local") return localStore.assertUploadEligibility(actor, productId, getContentSnapshot().products);
  return supabase.assertUploadEligibility(actor, productId);
}

export async function finalizeCommunityArtworkUpload(idempotencyKey: string, leaseToken: string) {
  const actor = await assertCommunityActor();
  if (actor.backend === "local") return localStore.finalizeArtworkUpload(actor, idempotencyKey, leaseToken, getContentSnapshot().products);
  return supabase.finalizeArtworkUpload(actor, idempotencyKey, leaseToken);
}

export async function markCommunityArtworkUploadStored(idempotencyKey: string, leaseToken: string) {
  const actor = await assertCommunityActor();
  if (actor.backend === "local") return localStore.markArtworkUploadStored(actor, idempotencyKey, leaseToken);
  return supabase.markArtworkUploadStored(actor, idempotencyKey, leaseToken);
}

export async function getCommunityUploadReservation(idempotencyKey: string) {
  const actor = await assertCommunityActor();
  if (actor.backend === "local") return localStore.getUploadReservation(actor, idempotencyKey);
  return supabase.getArtworkUploadReservation(actor, idempotencyKey);
}

export async function scheduleCommunityArtworkUploadCleanup(idempotencyKey: string, leaseToken: string) {
  const actor = await assertCommunityActor();
  if (actor.backend === "local") return localStore.scheduleUploadCleanup(actor, idempotencyKey, leaseToken);
  return supabase.scheduleArtworkUploadCleanup(actor, idempotencyKey, leaseToken);
}

export async function getMyCommunityArtwork(id: string) {
  const actor = await assertCommunityActor();
  if (actor.backend === "local") return localStore.getMyArtwork(actor, id, getContentSnapshot().products);
  return supabase.getOwnerArtwork(actor, id);
}

export async function getCommunityArtworkMedia(id: string) {
  const flags = getCommunityFlags();
  const actor = await getCommunityActorForRequest();
  const trustedActor = actor?.emailVerified ? actor : undefined;
  if (getBackendMode() === "local") {
    const products = getContentSnapshot().products;
    const privateMedia = trustedActor
      ? await localStore.getArtworkMedia(id, products, trustedActor, false)
      : null;
    if (privateMedia) return privateMedia;
    return flags.publicEnabled ? localStore.getArtworkMedia(id, products) : null;
  }
  if (trustedActor) {
    const privateMedia = await supabase.getArtworkMediaForRequest(id, trustedActor);
    if (privateMedia) return privateMedia;
  }
  return flags.publicEnabled ? supabase.getArtworkMediaForRequest(id) : null;
}

export async function editMyCommunityArtworkDescription(id: string, revision: number, description: string) {
  if (!getCommunityFlags().uploadsEnabled) throw new CommunityAuthorizationError("Coloring Club edits are unavailable.");
  const actor = await assertCommunityActor();
  if (!isUuid(id)) throw new Error("Invalid artwork ID.");
  if (actor.backend === "local") return localStore.editDescription(actor, id, revision, description);
  return supabase.editArtworkDescription(actor, id, revision, description);
}

export async function deleteMyCommunityArtwork(id: string, revision: number) {
  const actor = await assertCommunityActor();
  if (!isUuid(id)) throw new Error("Invalid artwork ID.");
  if (actor.backend === "local") {
    const deleted = await localStore.deleteArtwork(actor, id, revision);
    await processCommunityArtworkCleanup(actor);
    return deleted;
  }
  const deleted = await supabase.deleteArtwork(actor, id, revision);
  await processCommunityArtworkCleanup(actor);
  return deleted;
}

export async function listMyCommunityArtworks(limit = 50) {
  const actor = await assertCommunityActor();
  await processCommunityArtworkCleanup(actor);
  const safeLimit = boundedLimit(limit);
  if (actor.backend === "local") return localStore.listMyArtworks(actor, getContentSnapshot().products, safeLimit);
  return supabase.listOwnerArtworks(actor, safeLimit);
}

export async function listCommunityModerationQueue(input: { status?: CommunityArtworkStatus | "all"; productId?: string; creator?: string; cursor?: string | null; limit?: number } = {}) {
  const actor = await assertCommunityActor("admin");
  const safeLimit = input.limit === undefined ? 30 : Math.min(50, boundedLimit(input.limit));
  const normalized = { ...input, limit: safeLimit };
  if (actor.backend === "local") return localStore.listAdminArtworks(actor, getContentSnapshot().products, normalized);
  return supabase.listAdminArtworks(actor, normalized);
}

export async function getCommunityModerationArtwork(id: string) {
  const actor = await assertCommunityActor("admin");
  if (!isUuid(id)) throw new Error("Invalid artwork ID.");
  if (actor.backend === "local") return localStore.getAdminArtwork(actor, id, getContentSnapshot().products);
  return supabase.getAdminArtwork(actor, id);
}

export async function listCommunityModerationProductOptions(): Promise<CommunityAdminProductOption[]> {
  const actor = await assertCommunityActor("admin");
  const limit = 500;
  if (actor.backend === "local") return localStore.listAdminProductOptions(actor, getContentSnapshot().products, limit);
  return supabase.listAdminProductOptions(actor, limit);
}

export async function moderateCommunityArtwork(
  id: string,
  revision: number,
  action: "approve" | "reject" | "remove" | "restore",
  reason?: string,
) {
  const actor = await assertCommunityActor("admin");
  if (!isUuid(id)) throw new Error("Invalid artwork ID.");
  if (actor.backend === "local") return localStore.moderate(actor, id, revision, action, reason, getContentSnapshot().products);
  return supabase.moderateArtwork(actor, id, revision, action, reason);
}

export async function submitCommunityArtworkReport(actor: CommunityActor, artworkId: string, reason: CommunityReportReason, details: string, trustedIp?: string) {
  if (!getCommunityFlags().publicEnabled) throw new CommunityAuthorizationError("Community reporting is unavailable.");
  if (!actor.emailVerified) throw new CommunityAuthorizationError("Verify your email to report artwork.");
  if (!isUuid(artworkId) || !["rights", "privacy", "harmful", "other"].includes(reason)
    || typeof details !== "string" || Array.from(details.trim()).length > 500) {
    throw new CommunityValidationError("Check the report details and try again.");
  }
  if (!await consumeCommunityRateLimit("artwork-report-account", actor.userId, 5, 60 * 60)) throw new CommunityRateLimitError();
  if (trustedIp && !await consumeCommunityRateLimit("artwork-report-ip", trustedIp, 25, 60 * 60)) throw new CommunityRateLimitError();
  if (actor.backend === "local") return localStore.submitArtworkReport(actor, artworkId, reason, details, getContentSnapshot().products);
  return supabase.submitArtworkReport(actor, artworkId, reason, details);
}

export async function listCommunityReports(input: { status?: CommunityReportStatus | "all"; cursor?: string | null; limit?: number } = {}) {
  const actor = await assertCommunityActor("admin");
  const limit = Math.min(50, boundedLimit(input.limit));
  let cursor = null;
  if (input.cursor) {
    cursor = decodeCommunityTimestampCursor(input.cursor);
    if (!cursor) throw new CommunityValidationError("The report page cursor is invalid.");
  }
  const result = actor.backend === "local"
    ? await localStore.listAdminReports(actor, getContentSnapshot().products, { status: input.status, cursor, limit })
    : await supabase.listReports(actor, { status: input.status, cursor, limit });
  return { ...result, nextCursor: result.nextCursor ? encodeCommunityTimestampCursor(result.nextCursor.timestamp, result.nextCursor.id) : null };
}

export async function updateCommunityReport(id: string, revision: number, action: "reviewed" | "resolve" | "dismiss") {
  const actor = await assertCommunityActor("admin");
  if (!isUuid(id) || !Number.isSafeInteger(revision) || revision < 1) throw new CommunityValidationError();
  return actor.backend === "local"
    ? localStore.updateReport(actor, id, revision, action)
    : supabase.updateReport(actor, id, revision, action);
}

/** Server-only fixed-window limiter. Call with a hashed account/IP identifier. */
export async function consumeCommunityRateLimit(
  scope: string,
  identifier: string,
  maxHits: number,
  windowSeconds: number,
) {
  const key = hashCommunityRateLimitKey(scope, identifier);
  if (getBackendMode() === "local") {
    return localStore.consumeRateLimit(key, maxHits, windowSeconds * 1_000);
  }
  return supabase.consumeRateLimit(scope, identifier, maxHits, windowSeconds);
}

export async function processCommunityArtworkCleanup(actor?: CommunityActor) {
  const candidates: CommunityUploadCleanupCandidate[] = getBackendMode() === "local"
    ? await localStore.claimUploadCleanup(actor?.backend === "local" ? actor : undefined, 10)
    : await supabase.claimArtworkUploadCleanup(10);
  for (const candidate of candidates) await removeAndFinishArtworkCleanup(candidate);
  if (getBackendMode() === "local") await localStore.purgeExpiredReportDetails();
  else await supabase.purgeExpiredReportDetails();
}

export async function cleanupCommunityUploadCandidate(candidate: CommunityUploadCleanupCandidate) {
  await removeAndFinishArtworkCleanup(candidate);
}

async function removeAndFinishArtworkCleanup(candidate: CommunityUploadCleanupCandidate) {
  try {
    await removeCommunityArtworkImage({
      authorId: candidate.authorId,
      storagePath: candidate.storagePath,
      storageProvider: candidate.storageProvider,
    });
    if (getBackendMode() === "local") await localStore.finishUploadCleanup(candidate);
    else await supabase.finishArtworkUploadCleanup(candidate);
  } catch {
    console.error("[community-media] Private artwork cleanup will retry.");
  }
}

function boundedLimit(value: number | undefined) {
  if (value === undefined) return 24;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new Error(`Page size must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
  return value;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeUsername(value: string) {
  const username = value.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{3,24}$/.test(username) ? username : null;
}

function normalizeUsernameForWrite(value: string) {
  const username = value.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new CommunityValidationError("Username must be 3–24 lowercase ASCII letters, digits, or underscores.");
  return username;
}
