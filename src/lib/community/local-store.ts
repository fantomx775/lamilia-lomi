import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  CommunityAdminArtwork,
  CommunityAdminReport,
  CommunityAdminProductOption,
  CommunityArtworkStatus,
  CommunityArtworkSort,
  CommunityAudience,
  CommunityCreateArtworkInput,
  CommunityImageContentType,
  CommunityOwnerArtwork,
  CommunityPage,
  CommunityModerationCounts,
  CommunityModerationHistoryItem,
  CommunityPublicArtwork,
  CommunityReportReason,
  CommunityReportStatus,
  CommunityPublicProduct,
  CommunityPublicProductOption,
  CommunityHeartResult,
  CommunityStorageProvider,
} from "./types";
import type { Product } from "../types";
import {
  CommunityAuthorizationError,
  CommunityConflictError,
  CommunityRateLimitError,
  CommunityValidationError,
} from "./errors";
import { COMMUNITY_RULES_VERSION } from "./rules";
import { decodeCommunityPopularCursor, decodeCommunityTimestampCursor, encodeCommunityPopularCursor, encodeCommunityTimestampCursor } from "./cursor";

export {
  CommunityAuthorizationError,
  CommunityConflictError,
  CommunityRateLimitError,
  CommunityValidationError,
} from "./errors";

const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "support", "help", "official", "lamilialomi",
  "api", "club", "creators", "community", "login", "register", "account",
  "library", "artworks", "moderation", "pomoc", "administratorzy", "oficjalnie",
  "spolecznosc", "klub", "tworcy",
]);
const MAX_DESCRIPTION_LENGTH = 240;
const MAX_UPLOAD_SIZE_BYTES = 4 * 1024 * 1024;
const LOCK_RETRY_MS = 15;
const LOCK_TIMEOUT_MS = 3_000;
const STALE_LOCK_MS = 60_000;

type LocalProfile = {
  userId: string;
  username: string;
  avatarSeed: string;
  isAdult: true;
  adultAttestedAt: string;
  optedInAt: string;
  participationRevokedAt: string | null;
  rulesVersion: string;
  acceptedAt: string;
  suspendedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type LocalArtwork = {
  id: string;
  authorId: string;
  productId: string;
  storagePath: string;
  storageProvider: CommunityStorageProvider;
  contentType: CommunityImageContentType;
  sizeBytes: number;
  description: string;
  status: "pending" | "approved" | "rejected" | "removed";
  revision: number;
  moderationReason: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  unlockVerifiedAt: string | null;
  deletedAt: string | null;
  idempotencyKey: string;
  uploadFingerprint?: string;
};

type LocalUploadReservation = {
  authorId: string;
  idempotencyKey: string;
  productId: string;
  storagePath: string;
  storageProvider: CommunityStorageProvider;
  contentType: CommunityImageContentType;
  originalSizeBytes: number;
  sizeBytes: number;
  description: string;
  uploadFingerprint: string;
  state: "reserved" | "stored" | "finalized" | "cleanup_pending" | "cleaned";
  leaseToken: string;
  leaseExpiresAt: string;
  cleanupToken: string | null;
  artworkId: string | null;
  updatedAt: string;
};

type LocalModerationEvent = {
  id: string;
  artworkId: string;
  actorUserId: string;
  revision: number;
  fromStatus: LocalArtwork["status"];
  toStatus: LocalArtwork["status"];
  reason: string | null;
  createdAt: string;
};

type LocalArtworkLike = { artworkId: string; userId: string; createdAt: string };
type LocalReport = {
  id: string; artworkId: string; reporterUserId: string | null; reason: CommunityReportReason;
  details: string; status: CommunityReportStatus; revision: number; createdAt: string; updatedAt: string;
  resolvedAt: string | null; retentionExpiresAt: string | null;
};
type LocalReportEvent = { id: string; reportId: string; actorUserId: string | null; action: "submitted" | "reviewed" | "resolve" | "dismiss" | "retention_scrubbed"; fromStatus: CommunityReportStatus | null; toStatus: CommunityReportStatus; createdAt: string };

type LocalRateBucket = { windowStartedAt: number; hitCount: number };

type LocalSnapshot = {
  version: 1;
  profiles: LocalProfile[];
  artworks: LocalArtwork[];
  moderationEvents: LocalModerationEvent[];
  artworkLikes: LocalArtworkLike[];
  reports: LocalReport[];
  reportEvents: LocalReportEvent[];
  rateLimitBuckets: Record<string, LocalRateBucket>;
  uploadReservations: LocalUploadReservation[];
};

export type CommunityUploadReservationInput = {
  reservationToken: string;
  productId: string;
  idempotencyKey: string;
  storageProvider: CommunityStorageProvider;
  contentType: CommunityImageContentType;
  originalSizeBytes: number;
  sizeBytes: number;
  description: string;
  uploadFingerprint: string;
};

export type CommunityUploadReservationResult =
  | { state: "reserved"; leaseToken: string; storagePath: string; storageProvider: CommunityStorageProvider }
  | { state: "stored"; leaseToken: string; storagePath: string; storageProvider: CommunityStorageProvider }
  | { state: "finalized"; artworkId: string };

export type CommunityUploadCleanupCandidate = {
  authorId: string;
  idempotencyKey: string;
  leaseToken: string;
  storagePath: string;
  storageProvider: CommunityStorageProvider;
};

export type LocalCommunityActor = {
  userId: string;
  emailVerified: boolean;
  role: "user" | "admin";
  unlockedProductIds: string[];
};

export type LocalStoreOptions = {
  filePath?: string;
  now?: () => Date;
  uuid?: () => string;
};

export class CommunityLocalStore {
  private readonly filePath: string;
  private readonly now: () => Date;
  private readonly uuid: () => string;

  constructor(options: LocalStoreOptions = {}) {
    this.filePath = options.filePath ?? path.join(process.cwd(), "data", "lamilialomi-community.local.json");
    this.now = options.now ?? (() => new Date());
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
  }

  async join(actor: LocalCommunityActor, input: { username: string; adultAttested: boolean }) {
    assertVerified(actor);
    const username = normalizeUsername(input.username);
    if (!input.adultAttested) throw new CommunityAuthorizationError("Adult attestation is required.");
    return this.transact((snapshot) => {
      const existing = snapshot.profiles.find((profile) => profile.userId === actor.userId);
      if (existing?.suspendedAt) throw new CommunityAuthorizationError("Community participation is suspended.");
      assertUsernameAvailable(snapshot, username, actor.userId);
      if (existing && existing.username !== username) {
        throw new CommunityValidationError("Use the rate-limited username change operation.");
      }
      if (existing && isActiveProfile(snapshot, actor.userId)) return toPrivateProfile(existing);
      const now = this.now().toISOString();
      const profile: LocalProfile = {
        userId: actor.userId,
        username,
        avatarSeed: existing?.avatarSeed ?? this.uuid(),
        isAdult: true,
        adultAttestedAt: now,
        optedInAt: now,
        participationRevokedAt: null,
        rulesVersion: COMMUNITY_RULES_VERSION,
        acceptedAt: now,
        suspendedAt: existing?.suspendedAt ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      if (existing) Object.assign(existing, profile);
      else snapshot.profiles.push(profile);
      return toPrivateProfile(profile);
    });
  }

  async changeUsername(actor: LocalCommunityActor, candidate: string) {
    assertVerified(actor);
    const username = normalizeUsername(candidate);
    return this.transact((snapshot) => {
      const profile = snapshot.profiles.find((candidateProfile) => candidateProfile.userId === actor.userId);
      if (!profile || !profile.isAdult || !profile.adultAttestedAt || !profile.optedInAt
        || profile.participationRevokedAt || profile.suspendedAt || profile.rulesVersion !== COMMUNITY_RULES_VERSION) {
        throw new CommunityAuthorizationError("Community membership is unavailable.");
      }
      const rateLimitKey = hashCommunityRateLimitKey("username-change", actor.userId);
      if (!takeRateLimit(snapshot, rateLimitKey, 3, 60 * 60 * 1_000, this.now().getTime())) {
        throw new CommunityRateLimitError("Username changes are rate limited. Try again later.");
      }
      assertUsernameAvailable(snapshot, username, actor.userId);
      profile.username = username;
      profile.updatedAt = this.now().toISOString();
      return toPrivateProfile(profile);
    });
  }

  async leave(actor: LocalCommunityActor) {
    assertVerified(actor);
    return this.transact((snapshot) => {
      const profile = snapshot.profiles.find((candidate) => candidate.userId === actor.userId);
      if (!profile || profile.participationRevokedAt) return false;
      profile.participationRevokedAt = this.now().toISOString();
      profile.updatedAt = profile.participationRevokedAt;
      snapshot.artworkLikes = snapshot.artworkLikes.filter((like) => like.userId !== actor.userId);
      return true;
    });
  }

  async createPendingArtwork(
    actor: LocalCommunityActor,
    input: CommunityCreateArtworkInput,
    products: Product[],
  ) {
    assertEligibleForSubmission(actor);
    validateArtworkInput(input);
    return this.transact((snapshot) => {
      const profile = getActiveProfile(snapshot, actor.userId);
      if (profile.rulesVersion !== COMMUNITY_RULES_VERSION) {
        throw new CommunityAuthorizationError("Current community rules acceptance is required.");
      }
      const product = products.find((candidate) => candidate.id === input.productId);
      if (!product || product.status !== "published" || !actor.unlockedProductIds.includes(product.id)) {
        throw new CommunityAuthorizationError("A published, unlocked product is required.");
      }
      const existing = snapshot.artworks.find((artwork) =>
        artwork.authorId === actor.userId && artwork.idempotencyKey === input.idempotencyKey,
      );
      if (existing) {
        if (existing.productId !== input.productId
          || existing.storageProvider !== input.storageProvider
          || existing.contentType !== input.contentType
          || existing.sizeBytes !== input.sizeBytes
          || existing.description !== (input.description ?? "").trim()) {
          throw new CommunityConflictError("Idempotency key was reused with different artwork metadata.");
        }
        return existing.id;
      }
      const id = this.uuid();
      const storagePath = `community/${actor.userId}/${input.idempotencyKey}`;
      const now = this.now().toISOString();
      snapshot.artworks.push({
        id,
        authorId: actor.userId,
        productId: input.productId,
        storagePath,
        storageProvider: input.storageProvider,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        description: (input.description ?? "").trim(),
        status: "pending",
        revision: 1,
        moderationReason: null,
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
        unlockVerifiedAt: now,
        deletedAt: null,
        idempotencyKey: input.idempotencyKey,
      });
      return id;
    });
  }

  async reserveArtworkUpload(actor: LocalCommunityActor, input: CommunityUploadReservationInput, products: Product[]): Promise<CommunityUploadReservationResult> {
    assertEligibleForSubmission(actor);
    validateUploadReservationInput(input);
    return this.transact((snapshot) => {
      getActiveProfile(snapshot, actor.userId);
      const product = products.find((candidate) => candidate.id === input.productId);
      if (!product || product.status !== "published" || !actor.unlockedProductIds.includes(product.id)) {
        throw new CommunityAuthorizationError("A published, unlocked product is required.");
      }
      const existing = snapshot.uploadReservations.find((item) => item.authorId === actor.userId && item.idempotencyKey === input.idempotencyKey);
      if (existing) {
        if (!sameUploadReservation(existing, input)) throw new CommunityConflictError("This upload key was already used for different artwork.");
        if (existing.state === "finalized" && existing.artworkId) return { state: "finalized", artworkId: existing.artworkId };
        if (existing.state === "cleanup_pending") throw new CommunityConflictError("This upload is being cleaned up. Try again shortly.");
        if (existing.state === "stored") {
          return { state: "stored", leaseToken: existing.leaseToken, storagePath: existing.storagePath, storageProvider: existing.storageProvider };
        }
        if (existing.state === "cleaned") {
          if (snapshot.artworks.some((artwork) => artwork.authorId === actor.userId && artwork.idempotencyKey === input.idempotencyKey)) {
            throw new CommunityConflictError("A deleted artwork cannot reuse its upload key.");
          }
          existing.state = "reserved";
          existing.leaseToken = input.reservationToken;
          existing.leaseExpiresAt = new Date(this.now().getTime() + 10 * 60 * 1_000).toISOString();
          existing.cleanupToken = null;
          existing.updatedAt = this.now().toISOString();
        } else if (existing.leaseToken !== input.reservationToken && Date.parse(existing.leaseExpiresAt) >= this.now().getTime()) {
          throw new CommunityConflictError("This upload is already processing. Retry after it finishes.");
        } else if (existing.leaseToken !== input.reservationToken) {
          existing.leaseToken = input.reservationToken;
          existing.leaseExpiresAt = new Date(this.now().getTime() + 10 * 60 * 1_000).toISOString();
          existing.updatedAt = this.now().toISOString();
        }
        return { state: "reserved", leaseToken: existing.leaseToken, storagePath: existing.storagePath, storageProvider: existing.storageProvider };
      }
      const now = this.now();
      const reservation: LocalUploadReservation = {
        ...input,
        authorId: actor.userId,
        storagePath: buildCommunityStoragePath(actor.userId, input.idempotencyKey),
        state: "reserved",
        leaseToken: input.reservationToken,
        leaseExpiresAt: new Date(now.getTime() + 10 * 60 * 1_000).toISOString(),
        cleanupToken: null,
        artworkId: null,
        updatedAt: now.toISOString(),
      };
      snapshot.uploadReservations.push(reservation);
      return { state: "reserved", leaseToken: reservation.leaseToken, storagePath: reservation.storagePath, storageProvider: reservation.storageProvider };
    });
  }

  async assertUploadEligibility(actor: LocalCommunityActor, productId: string, products: Product[]) {
    assertEligibleForSubmission(actor);
    return this.read((snapshot) => {
      getActiveProfile(snapshot, actor.userId);
      const product = products.find((candidate) => candidate.id === productId && candidate.status === "published");
      if (!product || !actor.unlockedProductIds.includes(product.id)) {
        throw new CommunityAuthorizationError("A published, unlocked product is required.");
      }
    });
  }

  async finalizeArtworkUpload(actor: LocalCommunityActor, idempotencyKey: string, leaseToken: string, products: Product[]) {
    assertEligibleForSubmission(actor);
    return this.transact((snapshot) => {
      const reservation = snapshot.uploadReservations.find((item) => item.authorId === actor.userId && item.idempotencyKey === idempotencyKey);
      if (!reservation) throw new CommunityConflictError("Upload reservation is no longer available.");
      if (reservation.state === "finalized" && reservation.artworkId) return reservation.artworkId;
      if (reservation.state !== "stored" || reservation.leaseToken !== leaseToken) {
        throw new CommunityConflictError("Upload reservation has changed. Retry the upload.");
      }
      getActiveProfile(snapshot, actor.userId);
      const product = products.find((candidate) => candidate.id === reservation.productId);
      if (!product || product.status !== "published" || !actor.unlockedProductIds.includes(product.id)) {
        throw new CommunityAuthorizationError("A published, unlocked product is required.");
      }
      const now = this.now().toISOString();
      const artwork: LocalArtwork = {
        id: this.uuid(), authorId: actor.userId, productId: reservation.productId,
        storagePath: reservation.storagePath, storageProvider: reservation.storageProvider,
        contentType: reservation.contentType, sizeBytes: reservation.sizeBytes,
        description: reservation.description, status: "pending", revision: 1,
        moderationReason: null, createdAt: now, updatedAt: now, publishedAt: null,
        unlockVerifiedAt: now, deletedAt: null, idempotencyKey,
        uploadFingerprint: reservation.uploadFingerprint,
      };
      snapshot.artworks.push(artwork);
      reservation.state = "finalized";
      reservation.artworkId = artwork.id;
      reservation.updatedAt = now;
      return artwork.id;
    });
  }

  async markArtworkUploadStored(actor: LocalCommunityActor, idempotencyKey: string, leaseToken: string) {
    assertEligibleForSubmission(actor);
    return this.transact((snapshot) => {
      getActiveProfile(snapshot, actor.userId);
      const reservation = snapshot.uploadReservations.find((item) => item.authorId === actor.userId && item.idempotencyKey === idempotencyKey);
      if (!reservation) throw new CommunityConflictError("Upload reservation is no longer available.");
      if (["stored", "finalized"].includes(reservation.state) && reservation.leaseToken === leaseToken) return true;
      if (reservation.state !== "reserved" || reservation.leaseToken !== leaseToken
        || Date.parse(reservation.leaseExpiresAt) < this.now().getTime()) {
        throw new CommunityConflictError("Upload reservation has changed. Retry the upload.");
      }
      reservation.state = "stored";
      reservation.updatedAt = this.now().toISOString();
      return true;
    });
  }

  async scheduleArtworkCleanup(actor: LocalCommunityActor, artworkId: string) {
    assertVerified(actor);
    return this.transact((snapshot) => {
      const reservation = snapshot.uploadReservations.find((item) => item.authorId === actor.userId && item.artworkId === artworkId);
      if (!reservation || reservation.state !== "finalized") return false;
      reservation.state = "cleanup_pending";
      reservation.cleanupToken = this.uuid();
      reservation.updatedAt = this.now().toISOString();
      return true;
    });
  }

  async scheduleUploadCleanup(actor: LocalCommunityActor, idempotencyKey: string, leaseToken: string) {
    assertVerified(actor);
    return this.transact((snapshot) => {
      const reservation = snapshot.uploadReservations.find((item) => item.authorId === actor.userId
        && item.idempotencyKey === idempotencyKey && item.leaseToken === leaseToken && ["reserved", "stored"].includes(item.state));
      if (!reservation) return false;
      reservation.state = "cleanup_pending";
      reservation.cleanupToken = this.uuid();
      reservation.updatedAt = this.now().toISOString();
      return true;
    });
  }

  async claimUploadCleanup(actor?: LocalCommunityActor, limit = 10): Promise<CommunityUploadCleanupCandidate[]> {
    if (actor) assertVerified(actor);
    return this.transact((snapshot) => {
      const now = this.now().getTime();
      const candidates = snapshot.uploadReservations.filter((item) =>
        (!actor || item.authorId === actor.userId)
        && (item.state === "cleanup_pending" || ((item.state === "reserved" || item.state === "stored") && Date.parse(item.leaseExpiresAt) < now - 24 * 60 * 60 * 1_000)),
      ).slice(0, boundedLimit(limit));
      return candidates.map((item) => {
        item.state = "cleanup_pending";
        item.cleanupToken = this.uuid();
        item.updatedAt = this.now().toISOString();
        return {
          authorId: item.authorId, idempotencyKey: item.idempotencyKey,
          leaseToken: item.cleanupToken, storagePath: item.storagePath, storageProvider: item.storageProvider,
        };
      });
    });
  }

  async finishUploadCleanup(candidate: CommunityUploadCleanupCandidate) {
    return this.transact((snapshot) => {
      const reservation = snapshot.uploadReservations.find((item) => item.authorId === candidate.authorId
        && item.idempotencyKey === candidate.idempotencyKey && item.state === "cleanup_pending"
        && item.cleanupToken === candidate.leaseToken);
      if (!reservation) return false;
      reservation.state = "cleaned";
      reservation.cleanupToken = null;
      reservation.updatedAt = this.now().toISOString();
      return true;
    });
  }

  async getArtworkMedia(artworkId: string, products: Product[], actor?: LocalCommunityActor, allowPublic = true) {
    if (actor && !actor.emailVerified) actor = undefined;
    return this.read((snapshot) => {
      const artwork = snapshot.artworks.find((candidate) => candidate.id === artworkId && !candidate.deletedAt);
      if (!artwork?.authorId) return null;
      const isOwnerOrAdmin = Boolean(actor && (actor.userId === artwork.authorId || actor.role === "admin"));
      if (!isOwnerOrAdmin) {
        if (!allowPublic) return null;
        const product = products.find((candidate) => candidate.id === artwork.productId && candidate.status === "published");
        const profile = snapshot.profiles.find((candidate) => candidate.userId === artwork.authorId);
        if (!product || !profile || artwork.status !== "approved" || !artwork.publishedAt || !isActiveProfile(snapshot, profile.userId)) return null;
      }
      return { authorId: artwork.authorId, storagePath: artwork.storagePath, storageProvider: artwork.storageProvider, contentType: artwork.contentType };
    });
  }

  async editDescription(actor: LocalCommunityActor, artworkId: string, expectedRevision: number, description: string) {
    assertVerified(actor);
    validateDescription(description);
    return this.transact((snapshot) => {
      const artwork = snapshot.artworks.find((candidate) => candidate.id === artworkId
        && candidate.authorId === actor.userId && candidate.deletedAt === null
        && candidate.revision === expectedRevision
        && ["pending", "approved", "rejected", "removed"].includes(candidate.status));
      if (!artwork) throw new CommunityConflictError();
      if (!isActiveProfile(snapshot, actor.userId)) throw new CommunityAuthorizationError("Active community membership required.");
      if (artwork.status === "approved" || artwork.status === "rejected") {
        artwork.status = "pending";
        artwork.publishedAt = null;
      }
      artwork.description = description.trim();
      if (artwork.status === "pending") artwork.moderationReason = null;
      artwork.revision += 1;
      artwork.updatedAt = this.now().toISOString();
      return artwork.revision;
    });
  }

  async deleteArtwork(actor: LocalCommunityActor, artworkId: string, expectedRevision: number) {
    assertVerified(actor);
    return this.transact((snapshot) => {
      const artwork = snapshot.artworks.find((candidate) => candidate.id === artworkId
        && candidate.authorId === actor.userId && candidate.deletedAt === null
        && candidate.revision === expectedRevision);
      if (!artwork) throw new CommunityConflictError();
      artwork.deletedAt = this.now().toISOString();
      artwork.moderationReason = null;
      artwork.revision += 1;
      artwork.updatedAt = artwork.deletedAt;
      const reservation = snapshot.uploadReservations.find((item) => item.authorId === actor.userId && item.artworkId === artwork.id);
      if (reservation) {
        reservation.state = "cleanup_pending";
        reservation.cleanupToken = this.uuid();
        reservation.updatedAt = artwork.deletedAt;
      }
      return true;
    });
  }

  async moderate(
    actor: LocalCommunityActor,
    artworkId: string,
    expectedRevision: number,
    action: "approve" | "reject" | "remove" | "restore",
    reason?: string,
    products: Product[] = [],
  ) {
    assertAdmin(actor);
    if (["reject", "remove"].includes(action) && !reason?.trim()) {
      throw new CommunityValidationError("A moderation reason is required.");
    }
    if (reason && reason.trim().length > 500) throw new CommunityValidationError("Moderation reason is too long.");
    return this.transact((snapshot) => {
      const artwork = snapshot.artworks.find((candidate) => candidate.id === artworkId
        && candidate.deletedAt === null && candidate.revision === expectedRevision);
      if (!artwork) throw new CommunityConflictError();
      const transitions = {
        approve: ["pending", "approved"],
        reject: ["pending", "rejected"],
        remove: ["approved", "removed"],
        restore: ["removed", "pending"],
      } as const;
      const [fromStatus, toStatus] = transitions[action];
      if (artwork.status !== fromStatus) throw new CommunityConflictError("Moderation transition is no longer valid.");
      if (action === "approve") {
        const product = products.find((candidate) => candidate.id === artwork.productId);
        const profile = artwork.authorId ? snapshot.profiles.find((candidate) => candidate.userId === artwork.authorId) : undefined;
        if (!product || product.status !== "published") {
          throw new CommunityAuthorizationError("A published product is required for approval.");
        }
        if (!artwork.unlockVerifiedAt || !profile || !isActiveProfile(snapshot, profile.userId)) {
          throw new CommunityAuthorizationError("An active eligible author with a product unlock is required for approval.");
        }
      }
      const now = this.now().toISOString();
      artwork.status = toStatus;
      artwork.moderationReason = ["reject", "remove"].includes(action) ? reason!.trim() : null;
      artwork.publishedAt = action === "approve" ? now : null;
      artwork.revision += 1;
      artwork.updatedAt = now;
      snapshot.moderationEvents.push({
        id: this.uuid(), artworkId, actorUserId: actor.userId,
        revision: artwork.revision, fromStatus, toStatus,
        reason: artwork.moderationReason, createdAt: now,
      });
      return artwork.revision;
    });
  }

  async listPublicArtworks(input: {
    products: Product[];
    audience?: CommunityAudience;
    productId?: string;
    limit?: number;
    cursor?: string | null;
    sort?: CommunityArtworkSort;
    viewerUserId?: string;
  }): Promise<CommunityPage<CommunityPublicArtwork>> {
    const limit = boundedLimit(input.limit);
    const sort = input.sort ?? "latest";
    const latestCursor = sort === "latest" ? decodeCommunityTimestampCursor(input.cursor) : null;
    const popularCursor = sort === "popular" ? decodeCommunityPopularCursor(input.cursor) : null;
    return this.read((snapshot) => {
      const productsById = new Map(input.products.map((product) => [product.id, product]));
      const profilesById = new Map(snapshot.profiles.map((profile) => [profile.userId, profile]));
      const likesByArtwork = countArtworkLikes(snapshot.artworkLikes);
      const eligible = snapshot.artworks
        .filter((artwork) => artwork.status === "approved" && !artwork.deletedAt && artwork.publishedAt)
        .map((artwork) => ({ artwork, product: productsById.get(artwork.productId), profile: artwork.authorId ? profilesById.get(artwork.authorId) : undefined }))
        .filter(({ product, profile }) => product?.status === "published" && profile && isActiveProfile(snapshot, profile.userId))
        .filter(({ product }) => !input.audience || product!.audience === input.audience)
        .filter(({ product }) => !input.productId || product!.id === input.productId)
        .map((item) => ({ ...item, likesCount: likesByArtwork.get(item.artwork.id) ?? 0 }))
        .filter(({ artwork }) => sort !== "latest" || !latestCursor || artwork.publishedAt! < latestCursor.timestamp || (artwork.publishedAt === latestCursor.timestamp && artwork.id < latestCursor.id))
        .filter(({ artwork, likesCount }) => sort !== "popular" || !popularCursor || likesCount < popularCursor.likesCount
          || (likesCount === popularCursor.likesCount && artwork.publishedAt! < popularCursor.timestamp)
          || (likesCount === popularCursor.likesCount && artwork.publishedAt === popularCursor.timestamp && artwork.id < popularCursor.id))
        .sort((left, right) => sort === "popular"
          ? right.likesCount - left.likesCount || right.artwork.publishedAt!.localeCompare(left.artwork.publishedAt!) || right.artwork.id.localeCompare(left.artwork.id)
          : right.artwork.publishedAt!.localeCompare(left.artwork.publishedAt!) || right.artwork.id.localeCompare(left.artwork.id))
        .slice(0, limit + 1);
      const pageItems = eligible.slice(0, limit);
      const items = pageItems.map(({ artwork, product, profile, likesCount }) => toPublicArtwork(artwork, product!, profile!, likesCount, input.viewerUserId ? snapshot.artworkLikes.some((like) => like.artworkId === artwork.id && like.userId === input.viewerUserId) : false));
      const last = pageItems.at(-1);
      return { items, nextCursor: eligible.length > limit && last?.artwork.publishedAt
        ? sort === "popular"
          ? encodeCommunityPopularCursor(last.likesCount, last.artwork.publishedAt, last.artwork.id)
          : encodeCommunityTimestampCursor(last.artwork.publishedAt, last.artwork.id)
        : null };
    });
  }

  listPublicProductOptions(products: Product[], limit = 200): CommunityPublicProductOption[] {
    return products.filter((product) => product.status === "published")
      .map((product) => ({ id: product.id, slug: product.slug, title: product.translations.find((translation) => translation.locale === "en")?.title ?? product.slug, audience: product.audience }))
      .sort((a, b) => a.title.localeCompare(b.title, "en"))
      .slice(0, boundedLimit(limit));
  }

  async getPublicArtwork(artworkId: string, products: Product[], viewerUserId?: string): Promise<CommunityPublicArtwork | null> {
    return this.read((snapshot) => {
      const artwork = snapshot.artworks.find((candidate) => candidate.id === artworkId && candidate.status === "approved" && !candidate.deletedAt);
      if (!artwork?.authorId || !artwork.publishedAt) return null;
      const product = products.find((candidate) => candidate.id === artwork.productId && candidate.status === "published");
      const profile = snapshot.profiles.find((candidate) => candidate.userId === artwork.authorId);
      return product && profile && isActiveProfile(snapshot, profile.userId) ? toPublicArtwork(
        artwork, product, profile,
        snapshot.artworkLikes.filter((like) => like.artworkId === artwork.id).length,
        Boolean(viewerUserId && snapshot.artworkLikes.some((like) => like.artworkId === artwork.id && like.userId === viewerUserId)),
      ) : null;
    });
  }

  async getPublicCreator(usernameInput: string, products: Product[], limit = 24, viewerUserId?: string): Promise<{ username: string; avatarSeed: string; artworks: CommunityPublicArtwork[] } | null> {
    const username = normalizeUsername(usernameInput);
    return this.read((snapshot) => {
      const profile = snapshot.profiles.find((candidate) => candidate.username === username && isActiveProfile(snapshot, candidate.userId));
      if (!profile) return null;
      const productsById = new Map(products.filter((product) => product.status === "published").map((product) => [product.id, product]));
      const likesByArtwork = countArtworkLikes(snapshot.artworkLikes);
      const artworks = snapshot.artworks.filter((artwork) => artwork.authorId === profile.userId && artwork.status === "approved" && !artwork.deletedAt && artwork.publishedAt)
        .map((artwork) => ({ artwork, product: productsById.get(artwork.productId) }))
        .filter(({ product }) => Boolean(product))
        .sort((a, b) => b.artwork.publishedAt!.localeCompare(a.artwork.publishedAt!))
        .slice(0, boundedLimit(limit))
        .map(({ artwork, product }) => toPublicArtwork(
          artwork, product!, profile, likesByArtwork.get(artwork.id) ?? 0,
          Boolean(viewerUserId && snapshot.artworkLikes.some((like) => like.artworkId === artwork.id && like.userId === viewerUserId)),
        ));
      return { username: profile.username, avatarSeed: profile.avatarSeed, artworks };
    });
  }

  async setArtworkLike(actor: LocalCommunityActor, artworkId: string, liked: boolean, products: Product[]): Promise<CommunityHeartResult> {
    assertVerified(actor);
    return this.transact((snapshot) => {
      getActiveProfile(snapshot, actor.userId);
      const artwork = snapshot.artworks.find((candidate) => candidate.id === artworkId && candidate.status === "approved" && !candidate.deletedAt && candidate.publishedAt);
      const product = artwork && products.find((candidate) => candidate.id === artwork.productId && candidate.status === "published");
      const author = artwork?.authorId && snapshot.profiles.find((profile) => profile.userId === artwork.authorId);
      if (!artwork || !product || !author || !isActiveProfile(snapshot, author.userId)) return { available: false, liked: false, likesCount: 0 };
      const existingIndex = snapshot.artworkLikes.findIndex((entry) => entry.artworkId === artworkId && entry.userId === actor.userId);
      if (liked && existingIndex < 0) snapshot.artworkLikes.push({ artworkId, userId: actor.userId, createdAt: this.now().toISOString() });
      if (!liked && existingIndex >= 0) snapshot.artworkLikes.splice(existingIndex, 1);
      const current = snapshot.artworkLikes.some((entry) => entry.artworkId === artworkId && entry.userId === actor.userId);
      return { available: true, liked: current, likesCount: snapshot.artworkLikes.filter((entry) => entry.artworkId === artworkId).length };
    });
  }

  async listMyArtworks(actor: LocalCommunityActor, products: Product[], limit = 24): Promise<CommunityOwnerArtwork[]> {
    assertVerified(actor);
    return this.read((snapshot) => snapshot.artworks
      .filter((artwork) => artwork.authorId === actor.userId && !artwork.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, boundedLimit(limit))
      .flatMap((artwork) => {
        const product = products.find((candidate) => candidate.id === artwork.productId);
        return product ? [toOwnerArtwork(artwork, product)] : [];
      }));
  }

  async getMyArtwork(actor: LocalCommunityActor, artworkId: string, products: Product[]) {
    assertVerified(actor);
    const items = await this.listMyArtworks(actor, products, 100);
    return items.find((item) => item.id === artworkId) ?? null;
  }

  async getUploadReservation(actor: LocalCommunityActor, idempotencyKey: string) {
    assertVerified(actor);
    return this.read((snapshot) => {
      const reservation = snapshot.uploadReservations.find((item) => item.authorId === actor.userId && item.idempotencyKey === idempotencyKey);
      return reservation ? {
        state: reservation.state,
        artworkId: reservation.artworkId,
        leaseToken: reservation.leaseToken,
        storagePath: reservation.storagePath,
        storageProvider: reservation.storageProvider,
        uploadFingerprint: reservation.uploadFingerprint,
      } : null;
    });
  }

  async listAdminArtworks(actor: LocalCommunityActor, products: Product[], input: { status?: CommunityArtworkStatus | "all"; productId?: string; creator?: string; cursor?: string | null; limit?: number } = {}): Promise<CommunityPage<CommunityAdminArtwork> & { counts: CommunityModerationCounts }> {
    assertAdmin(actor);
    const limit = boundedLimit(input.limit ?? 50);
    const cursor = decodeAdminCursor(input.cursor);
    return this.read((snapshot) => {
      const profiles = new Map(snapshot.profiles.map((profile) => [profile.userId, profile]));
      const countStatuses: CommunityArtworkStatus[] = ["pending", "approved", "rejected", "removed"];
      const filtered = snapshot.artworks.filter((artwork) => {
        if (artwork.deletedAt) return false;
        if (input.status && input.status !== "all" && artwork.status !== input.status) return false;
        if (input.productId && artwork.productId !== input.productId) return false;
        if (input.creator && !(profiles.get(artwork.authorId)?.username ?? "").startsWith(input.creator)) return false;
        if (cursor && (artwork.createdAt < cursor.createdAt || (artwork.createdAt === cursor.createdAt && artwork.id <= cursor.id))) return false;
        return true;
      }).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const counts = Object.fromEntries(countStatuses.map((status) => [status, snapshot.artworks.filter((artwork) => {
        if (artwork.deletedAt || artwork.status !== status) return false;
        if (input.productId && artwork.productId !== input.productId) return false;
        return !input.creator || (profiles.get(artwork.authorId)?.username ?? "").startsWith(input.creator);
      }).length])) as CommunityModerationCounts;
      const rows = filtered.slice(0, limit + 1);
      const items = rows.slice(0, limit).flatMap((artwork) => {
        const product = products.find((candidate) => candidate.id === artwork.productId);
        if (!product) return [];
        const profile = artwork.authorId ? profiles.get(artwork.authorId) : undefined;
        return [{ ...toOwnerArtwork(artwork, product), creatorUsername: profile?.username ?? null, publishedAt: artwork.publishedAt }];
      });
      const last = items.at(-1);
      return { items, counts, nextCursor: rows.length > limit && last ? encodeAdminCursor(last.createdAt, last.id) : null };
    });
  }

  async listAdminQueue(actor: LocalCommunityActor, products: Product[], limit = 50): Promise<CommunityAdminArtwork[]> {
    return (await this.listAdminArtworks(actor, products, { status: "pending", limit })).items;
  }

  listAdminProductOptions(actor: LocalCommunityActor, products: Product[], limit = 500): CommunityAdminProductOption[] {
    assertAdmin(actor);
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 500) : 500;
    return products.slice(0, safeLimit).map((product) => ({
      id: product.id,
      slug: product.slug,
      title: product.translations.find((translation) => translation.locale === "en")?.title || product.slug,
    }));
  }

  async getAdminArtwork(actor: LocalCommunityActor, artworkId: string, products: Product[]) {
    assertAdmin(actor);
    return this.read((snapshot) => {
      const artwork = snapshot.artworks.find((candidate) => candidate.id === artworkId && !candidate.deletedAt);
      if (!artwork) return null;
      const product = products.find((candidate) => candidate.id === artwork.productId);
      if (!product) return null;
      const profile = artwork.authorId ? snapshot.profiles.find((candidate) => candidate.userId === artwork.authorId) : undefined;
      const history = snapshot.moderationEvents.filter((event) => event.artworkId === artworkId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .slice(0, 100)
        .reverse()
        .map((event): CommunityModerationHistoryItem => ({
          id: event.id, revision: event.revision, fromStatus: event.fromStatus, toStatus: event.toStatus,
          reason: event.reason, createdAt: event.createdAt, moderatorLabel: "Administrator",
        }));
      return { artwork: { ...toOwnerArtwork(artwork, product), creatorUsername: profile?.username ?? null, publishedAt: artwork.publishedAt }, history };
    });
  }

  async submitArtworkReport(actor: LocalCommunityActor, artworkId: string, reason: CommunityReportReason, details: string, products: Product[]) {
    assertVerified(actor);
    if (!/^[0-9a-f-]{36}$/i.test(artworkId) || !["rights", "privacy", "harmful", "other"].includes(reason)
      || typeof details !== "string" || Array.from(details.trim()).length > 500) throw new CommunityValidationError("Invalid report details.");
    return this.transact((snapshot) => {
      const artwork = snapshot.artworks.find((candidate) => candidate.id === artworkId && !candidate.deletedAt && candidate.status === "approved" && candidate.publishedAt);
      const product = artwork && products.find((candidate) => candidate.id === artwork.productId && candidate.status === "published");
      const profile = artwork?.authorId && snapshot.profiles.find((candidate) => candidate.userId === artwork.authorId);
      if (!artwork || !product || !profile || !isActiveProfile(snapshot, profile.userId)) throw new CommunityConflictError("This artwork is no longer available to report.");
      const existing = snapshot.reports.find((report) => report.artworkId === artworkId && report.reporterUserId === actor.userId);
      if (existing) return { duplicate: true };
      const now = this.now().toISOString();
      const report = { id: this.uuid(), artworkId, reporterUserId: actor.userId, reason, details: details.trim(), status: "open" as const, revision: 1, createdAt: now, updatedAt: now, resolvedAt: null, retentionExpiresAt: null };
      snapshot.reports.push(report);
      snapshot.reportEvents.push({ id: this.uuid(), reportId: report.id, actorUserId: actor.userId, action: "submitted", fromStatus: null, toStatus: "open", createdAt: now });
      return { duplicate: false };
    });
  }

  async listAdminReports(actor: LocalCommunityActor, products: Product[], input: { status?: CommunityReportStatus | "all"; cursor?: { timestamp: string; id: string } | null; limit: number }) {
    assertAdmin(actor);
    return this.read((snapshot) => {
      const counts: Record<CommunityReportStatus, number> = { open: 0, reviewed: 0, resolved: 0, dismissed: 0 };
      for (const report of snapshot.reports) counts[report.status] += 1;
      const filtered = snapshot.reports.filter((report) => !input.status || input.status === "all" || report.status === input.status)
        .filter((report) => !input.cursor || report.createdAt < input.cursor.timestamp || (report.createdAt === input.cursor.timestamp && report.id < input.cursor.id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const rows = filtered.slice(0, input.limit + 1);
      const items: CommunityAdminReport[] = rows.slice(0, input.limit).flatMap((report) => {
        const artwork = snapshot.artworks.find((candidate) => candidate.id === report.artworkId);
        const product = artwork && products.find((candidate) => candidate.id === artwork.productId);
        if (!artwork || !product) return [];
        const profile = artwork.authorId ? snapshot.profiles.find((candidate) => candidate.userId === artwork.authorId) : undefined;
        return [{ id: report.id, artworkId: artwork.id, artworkStatus: artwork.status, description: artwork.description,
          creatorUsername: profile?.username ?? null,
          product: { id: product.id, slug: product.slug, title: product.translations.find((translation) => translation.locale === "en")?.title ?? product.slug, audience: product.audience },
          reason: report.reason, details: report.details, status: report.status, revision: report.revision, createdAt: report.createdAt, updatedAt: report.updatedAt,
          overdue: report.status === "open" && this.now().getTime() - new Date(report.createdAt).getTime() > 7 * 24 * 60 * 60 * 1_000 }];
      });
      const last = rows.length > input.limit ? rows[input.limit - 1] : null;
      return { items, nextCursor: last ? { timestamp: last.createdAt, id: last.id } : null, counts };
    });
  }

  async updateReport(actor: LocalCommunityActor, reportId: string, revision: number, action: "reviewed" | "resolve" | "dismiss") {
    assertAdmin(actor);
    return this.transact((snapshot) => {
      const report = snapshot.reports.find((candidate) => candidate.id === reportId);
      if (!report || report.revision !== revision || ["resolved", "dismissed"].includes(report.status)) throw new CommunityConflictError("Report changed or is already resolved.");
      const nextStatus: CommunityReportStatus = action === "reviewed" ? "reviewed" : action === "resolve" ? "resolved" : "dismissed";
      const now = this.now().toISOString();
      snapshot.reportEvents.push({ id: this.uuid(), reportId, actorUserId: actor.userId, action, fromStatus: report.status, toStatus: nextStatus, createdAt: now });
      report.status = nextStatus;
      report.revision += 1;
      report.updatedAt = now;
      report.resolvedAt = nextStatus === "resolved" || nextStatus === "dismissed" ? now : null;
      report.retentionExpiresAt = report.resolvedAt ? new Date(this.now().getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString() : null;
      return report.revision;
    });
  }

  async purgeExpiredReportDetails() {
    return this.transact((snapshot) => {
      const now = this.now();
      let count = 0;
      for (const report of snapshot.reports) {
        if (!report.retentionExpiresAt || new Date(report.retentionExpiresAt) > now || (!report.details && !report.reporterUserId)) continue;
        const previous = report.status;
        for (const event of snapshot.reportEvents) if (event.reportId === report.id) event.actorUserId = null;
        report.reporterUserId = null;
        report.details = "";
        report.revision += 1;
        report.updatedAt = now.toISOString();
        snapshot.reportEvents.push({ id: this.uuid(), reportId: report.id, actorUserId: null, action: "retention_scrubbed", fromStatus: previous, toStatus: previous, createdAt: now.toISOString() });
        count += 1;
      }
      return count;
    });
  }

  async getProfile(actor: LocalCommunityActor) {
    assertVerified(actor);
    return this.read((snapshot) => {
      const profile = snapshot.profiles.find((candidate) => candidate.userId === actor.userId);
      return profile ? toPrivateProfile(profile) : null;
    });
  }

  async consumeRateLimit(keyHash: string, maxHits: number, windowMs: number) {
    if (!/^[a-f0-9]{64}$/.test(keyHash) || !Number.isSafeInteger(maxHits) || maxHits < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
      throw new CommunityValidationError("Invalid rate-limit parameters.");
    }
    return this.transact((snapshot) => {
      const now = this.now().getTime();
      return takeRateLimit(snapshot, keyHash, maxHits, windowMs, now);
    });
  }

  private async read<T>(read: (snapshot: LocalSnapshot) => T): Promise<T> {
    return withFileLock(this.filePath, async () => read(readSnapshot(this.filePath)));
  }

  private async transact<T>(mutation: (snapshot: LocalSnapshot) => T): Promise<T> {
    return withFileLock(this.filePath, async () => {
      const snapshot = readSnapshot(this.filePath);
      const result = mutation(snapshot);
      writeSnapshot(this.filePath, snapshot);
      return result;
    });
  }
}

export function deriveLocalCommunityUserId(email: string) {
  const digest = crypto.createHash("sha256").update(`lamilia-community-local:${email.trim().toLowerCase()}`).digest();
  digest[6] = (digest[6] & 0x0f) | 0x40;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function hashCommunityRateLimitKey(scope: string, identifier: string) {
  return crypto.createHash("sha256").update(`${scope}:${identifier}`).digest("hex");
}

export function buildCommunityStoragePath(actorId: string, idempotencyKey: string) {
  return `community/${actorId}/${idempotencyKey}`;
}

function initialSnapshot(): LocalSnapshot {
  return { version: 1, profiles: [], artworks: [], moderationEvents: [], artworkLikes: [], reports: [], reportEvents: [], rateLimitBuckets: {}, uploadReservations: [] };
}

function readSnapshot(filePath: string): LocalSnapshot {
  if (!fs.existsSync(filePath)) return initialSnapshot();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<LocalSnapshot>;
    if (parsed.version !== 1 || !Array.isArray(parsed.profiles) || !Array.isArray(parsed.artworks)
      || !Array.isArray(parsed.moderationEvents) || typeof parsed.rateLimitBuckets !== "object" || !parsed.rateLimitBuckets
      || (parsed.uploadReservations !== undefined && !Array.isArray(parsed.uploadReservations))
      || (parsed.artworkLikes !== undefined && !Array.isArray(parsed.artworkLikes))) {
      throw new Error("Unexpected community local-store structure.");
    }
    return { ...parsed, uploadReservations: parsed.uploadReservations ?? [], artworkLikes: parsed.artworkLikes ?? [], reports: parsed.reports ?? [], reportEvents: parsed.reportEvents ?? [] } as LocalSnapshot;
  } catch (error) {
    throw new Error(`Community local store is unreadable: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
}

function writeSnapshot(filePath: string, snapshot: LocalSnapshot) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const fd = fs.openSync(tempPath, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tempPath, filePath);
}

async function withFileLock<T>(filePath: string, operation: () => Promise<T> | T): Promise<T> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let acquired = false;
  while (!acquired) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      fs.writeFileSync(path.join(lockPath, "owner"), `${process.pid}\n${Date.now()}\n`, { mode: 0o600, flag: "wx" });
      acquired = true;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      recoverStaleLock(lockPath);
      if (Date.now() >= deadline) throw new Error("Timed out acquiring community local-store lock.");
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
  try {
    return await operation();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

function recoverStaleLock(lockPath: string) {
  try {
    const raw = fs.readFileSync(path.join(lockPath, "owner"), "utf8").split(/\r?\n/);
    const pid = Number(raw[0]);
    const createdAt = Number(raw[1]);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(createdAt) || Date.now() - createdAt < STALE_LOCK_MS) return;
    try { process.kill(pid, 0); } catch (error) {
      if (isProcessMissing(error)) fs.rmSync(lockPath, { recursive: true, force: true });
    }
  } catch {
    // A just-created lock may not have its owner file yet. Let the owner finish.
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function isProcessMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ESRCH";
}

function normalizeUsername(candidate: string) {
  const username = candidate.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new CommunityValidationError("Username must be 3–24 lowercase ASCII letters, digits, or underscores.");
  if (RESERVED_USERNAMES.has(username)) throw new CommunityValidationError("This username is reserved.");
  return username;
}

function assertUsernameAvailable(snapshot: LocalSnapshot, username: string, actorId: string) {
  if (snapshot.profiles.some((profile) => profile.username === username && profile.userId !== actorId)) {
    throw new CommunityConflictError("Username is already taken.");
  }
}

function assertVerified(actor: LocalCommunityActor) {
  if (!actor.emailVerified) throw new CommunityAuthorizationError("Verified account required.");
}

function assertEligibleForSubmission(actor: LocalCommunityActor) {
  assertVerified(actor);
  if (!actor.unlockedProductIds) throw new CommunityAuthorizationError("A published, unlocked product is required.");
}

function assertAdmin(actor: LocalCommunityActor) {
  assertVerified(actor);
  if (actor.role !== "admin") throw new CommunityAuthorizationError("Administrator access required.");
}

function getActiveProfile(snapshot: LocalSnapshot, userId: string) {
  const profile = snapshot.profiles.find((candidate) => candidate.userId === userId);
  if (!profile || !isActiveProfile(snapshot, userId)) throw new CommunityAuthorizationError("Active community membership required.");
  return profile;
}

function isActiveProfile(snapshot: LocalSnapshot, userId: string) {
  const profile = snapshot.profiles.find((candidate) => candidate.userId === userId);
  return Boolean(profile && profile.isAdult && profile.adultAttestedAt && profile.optedInAt
    && !profile.participationRevokedAt && !profile.suspendedAt && profile.rulesVersion === COMMUNITY_RULES_VERSION);
}

function takeRateLimit(snapshot: LocalSnapshot, keyHash: string, maxHits: number, windowMs: number, now: number) {
  for (const [key, item] of Object.entries(snapshot.rateLimitBuckets)) {
    if (now - item.windowStartedAt > 2 * 24 * 60 * 60 * 1_000) delete snapshot.rateLimitBuckets[key];
  }
  const bucket = snapshot.rateLimitBuckets[keyHash];
  if (!bucket || now - bucket.windowStartedAt >= windowMs) {
    snapshot.rateLimitBuckets[keyHash] = { windowStartedAt: now, hitCount: 1 };
    return true;
  }
  bucket.hitCount = Math.min(bucket.hitCount + 1, maxHits + 1);
  return bucket.hitCount <= maxHits;
}

function validateDescription(description: string) {
  if (typeof description !== "string" || Array.from(description.trim()).length > MAX_DESCRIPTION_LENGTH) {
    throw new CommunityValidationError("Description must be 240 characters or fewer.");
  }
}

function validateArtworkInput(input: CommunityCreateArtworkInput) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) {
    throw new CommunityValidationError("A valid idempotency key is required.");
  }
  if (!input.productId || !["local", "supabase", "r2"].includes(input.storageProvider)
    || !["image/jpeg", "image/png", "image/webp"].includes(input.contentType)
    || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    throw new CommunityValidationError("Invalid artwork metadata.");
  }
  validateDescription(input.description ?? "");
}

function validateUploadReservationInput(input: CommunityUploadReservationInput) {
  validateArtworkInput({
    productId: input.productId,
    idempotencyKey: input.idempotencyKey,
    storageProvider: input.storageProvider,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    description: input.description,
  });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.reservationToken)
    || !Number.isSafeInteger(input.originalSizeBytes) || input.originalSizeBytes <= 0 || input.originalSizeBytes > MAX_UPLOAD_SIZE_BYTES
    || !/^[a-f0-9]{64}$/.test(input.uploadFingerprint)) {
    throw new CommunityValidationError("Invalid image upload details.");
  }
}

function sameUploadReservation(reservation: LocalUploadReservation, input: CommunityUploadReservationInput) {
  return reservation.productId === input.productId
    && reservation.uploadFingerprint === input.uploadFingerprint
    && reservation.originalSizeBytes === input.originalSizeBytes
    && reservation.sizeBytes === input.sizeBytes
    && reservation.contentType === input.contentType
    && reservation.storageProvider === input.storageProvider
    && reservation.description === input.description.trim();
}

function publicProduct(product: Product): CommunityPublicProduct {
  return {
    id: product.id,
    slug: product.slug,
    title: product.translations.find((translation) => translation.locale === "en")?.title ?? product.slug,
    audience: product.audience,
  };
}

function toPublicArtwork(artwork: LocalArtwork, product: Product, profile: LocalProfile, likesCount = 0, likedByMe = false): CommunityPublicArtwork {
  return {
    id: artwork.id,
    product: publicProduct(product),
    creator: { username: profile.username, avatarSeed: profile.avatarSeed },
    contentType: artwork.contentType,
    description: artwork.description,
    publishedAt: artwork.publishedAt!,
    likesCount,
    likedByMe,
  };
}

function countArtworkLikes(likes: LocalArtworkLike[]) {
  const counts = new Map<string, number>();
  for (const like of likes) counts.set(like.artworkId, (counts.get(like.artworkId) ?? 0) + 1);
  return counts;
}

function toOwnerArtwork(artwork: LocalArtwork, product: Product): CommunityOwnerArtwork {
  return {
    id: artwork.id,
    product: publicProduct(product),
    contentType: artwork.contentType,
    description: artwork.description,
    status: artwork.status,
    revision: artwork.revision,
    rejectionReason: artwork.status === "rejected" || artwork.status === "removed" ? artwork.moderationReason : null,
    createdAt: artwork.createdAt,
    updatedAt: artwork.updatedAt,
  };
}

function toPrivateProfile(profile: LocalProfile) {
  return {
    username: profile.username,
    avatarSeed: profile.avatarSeed,
    isAdult: profile.isAdult,
    adultAttestedAt: profile.adultAttestedAt,
    optedInAt: profile.optedInAt,
    participationRevokedAt: profile.participationRevokedAt,
    rulesVersion: profile.rulesVersion,
    acceptedAt: profile.acceptedAt,
    suspendedAt: profile.suspendedAt,
  };
}

function boundedLimit(value: number | undefined) {
  if (value === undefined) return 24;
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new CommunityValidationError("Page size must be between 1 and 100.");
  return value;
}

function encodeAdminCursor(createdAt: string, id: string) {
  return encodeCommunityTimestampCursor(createdAt, id);
}

function decodeAdminCursor(cursor: string | null | undefined) {
  const parsed = decodeCommunityTimestampCursor(cursor);
  return parsed ? { createdAt: parsed.timestamp, id: parsed.id } : null;
}
