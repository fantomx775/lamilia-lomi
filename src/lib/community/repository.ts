import "server-only";

import { getBackendMode } from "../config";
import { getCommunityFlags } from "../community-flags";
import { getContentSnapshot } from "../content-store";
import { assertCommunityActor, getCommunityActorForRequest } from "./session";
import {
  CommunityLocalStore,
  hashCommunityRateLimitKey,
} from "./local-store";
import * as supabase from "./supabase-adapter";
import { CommunityValidationError } from "./errors";
import type {
  CommunityAudience,
  CommunityCreateArtworkInput,
  CommunityPage,
  CommunityProfileInput,
  CommunityPublicArtwork,
} from "./types";

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
} = {}): Promise<CommunityPage<CommunityPublicArtwork>> {
  if (!getCommunityFlags().publicEnabled) return { items: [], nextCursor: null };
  const limit = boundedLimit(input.limit);
  if (getBackendMode() === "local") {
    return localStore.listPublicArtworks({ ...input, limit, products: getContentSnapshot().products });
  }
  return supabase.listPublicArtworks({ ...input, limit });
}

export async function getCommunityPublicArtwork(id: string) {
  if (!getCommunityFlags().publicEnabled || !isUuid(id)) return null;
  if (getBackendMode() === "local") return localStore.getPublicArtwork(id, getContentSnapshot().products);
  return supabase.getPublicArtwork(id);
}

export async function getCommunityPublicCreator(username: string) {
  if (!getCommunityFlags().publicEnabled) return null;
  if (getBackendMode() === "local") {
    try {
      return await localStore.getPublicCreator(username, getContentSnapshot().products);
    } catch {
      return null;
    }
  }
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const result = await supabase.getPublicCreator(normalized, 24);
  return result ? { username: result.creator.username, avatarSeed: result.creator.avatarSeed, artworks: result.artworks } : null;
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

export async function editMyCommunityArtworkDescription(id: string, revision: number, description: string) {
  const actor = await assertCommunityActor();
  if (!isUuid(id)) throw new Error("Invalid artwork ID.");
  if (actor.backend === "local") return localStore.editDescription(actor, id, revision, description);
  return supabase.editArtworkDescription(actor, id, revision, description);
}

export async function deleteMyCommunityArtwork(id: string, revision: number) {
  const actor = await assertCommunityActor();
  if (!isUuid(id)) throw new Error("Invalid artwork ID.");
  if (actor.backend === "local") return localStore.deleteArtwork(actor, id, revision);
  return supabase.deleteArtwork(actor, id, revision);
}

export async function listMyCommunityArtworks(limit = 50) {
  const actor = await assertCommunityActor();
  const safeLimit = boundedLimit(limit);
  if (actor.backend === "local") return localStore.listMyArtworks(actor, getContentSnapshot().products, safeLimit);
  return supabase.listOwnerArtworks(actor, safeLimit);
}

export async function listCommunityModerationQueue(limit = 50) {
  const actor = await assertCommunityActor("admin");
  const safeLimit = boundedLimit(limit);
  if (actor.backend === "local") return localStore.listAdminQueue(actor, getContentSnapshot().products, safeLimit);
  return supabase.listAdminQueue(actor, safeLimit);
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
