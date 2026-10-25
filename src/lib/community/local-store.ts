import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type {
  CommunityAdminArtwork,
  CommunityAudience,
  CommunityCreateArtworkInput,
  CommunityImageContentType,
  CommunityOwnerArtwork,
  CommunityPage,
  CommunityPublicArtwork,
  CommunityPublicProduct,
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

type LocalRateBucket = { windowStartedAt: number; hitCount: number };

type LocalSnapshot = {
  version: 1;
  profiles: LocalProfile[];
  artworks: LocalArtwork[];
  moderationEvents: LocalModerationEvent[];
  rateLimitBuckets: Record<string, LocalRateBucket>;
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
  }): Promise<CommunityPage<CommunityPublicArtwork>> {
    const limit = boundedLimit(input.limit);
    const cursor = decodeCursor(input.cursor);
    return this.read((snapshot) => {
      const productsById = new Map(input.products.map((product) => [product.id, product]));
      const profilesById = new Map(snapshot.profiles.map((profile) => [profile.userId, profile]));
      const eligible = snapshot.artworks
        .filter((artwork) => artwork.status === "approved" && !artwork.deletedAt && artwork.publishedAt)
        .map((artwork) => ({ artwork, product: productsById.get(artwork.productId), profile: artwork.authorId ? profilesById.get(artwork.authorId) : undefined }))
        .filter(({ product, profile }) => product?.status === "published" && profile && isActiveProfile(snapshot, profile.userId))
        .filter(({ product }) => !input.audience || product!.audience === input.audience)
        .filter(({ product }) => !input.productId || product!.id === input.productId)
        .filter(({ artwork }) => !cursor || `${artwork.publishedAt}|${artwork.id}` < cursor)
        .sort((left, right) => right.artwork.publishedAt!.localeCompare(left.artwork.publishedAt!) || right.artwork.id.localeCompare(left.artwork.id))
        .slice(0, limit + 1);
      return page(eligible.slice(0, limit).map(({ artwork, product, profile }) => toPublicArtwork(artwork, product!, profile!)), eligible.length > limit ? eligible[limit - 1].artwork : null);
    });
  }

  async getPublicArtwork(artworkId: string, products: Product[]): Promise<CommunityPublicArtwork | null> {
    return this.read((snapshot) => {
      const artwork = snapshot.artworks.find((candidate) => candidate.id === artworkId && candidate.status === "approved" && !candidate.deletedAt);
      if (!artwork?.authorId || !artwork.publishedAt) return null;
      const product = products.find((candidate) => candidate.id === artwork.productId && candidate.status === "published");
      const profile = snapshot.profiles.find((candidate) => candidate.userId === artwork.authorId);
      return product && profile && isActiveProfile(snapshot, profile.userId) ? toPublicArtwork(artwork, product, profile) : null;
    });
  }

  async getPublicCreator(usernameInput: string, products: Product[], limit = 24): Promise<{ username: string; avatarSeed: string; artworks: CommunityPublicArtwork[] } | null> {
    const username = normalizeUsername(usernameInput);
    return this.read((snapshot) => {
      const profile = snapshot.profiles.find((candidate) => candidate.username === username && isActiveProfile(snapshot, candidate.userId));
      if (!profile) return null;
      const productsById = new Map(products.filter((product) => product.status === "published").map((product) => [product.id, product]));
      const artworks = snapshot.artworks.filter((artwork) => artwork.authorId === profile.userId && artwork.status === "approved" && !artwork.deletedAt && artwork.publishedAt)
        .map((artwork) => ({ artwork, product: productsById.get(artwork.productId) }))
        .filter(({ product }) => Boolean(product))
        .sort((a, b) => b.artwork.publishedAt!.localeCompare(a.artwork.publishedAt!))
        .slice(0, boundedLimit(limit))
        .map(({ artwork, product }) => toPublicArtwork(artwork, product!, profile));
      return { username: profile.username, avatarSeed: profile.avatarSeed, artworks };
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

  async listAdminQueue(actor: LocalCommunityActor, products: Product[], limit = 50): Promise<CommunityAdminArtwork[]> {
    assertAdmin(actor);
    return this.read((snapshot) => snapshot.artworks
      .filter((artwork) => artwork.status === "pending" && !artwork.deletedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, boundedLimit(limit))
      .flatMap((artwork) => {
        const product = products.find((candidate) => candidate.id === artwork.productId);
        if (!product) return [];
        const profile = artwork.authorId ? snapshot.profiles.find((candidate) => candidate.userId === artwork.authorId) : undefined;
        return [{ ...toOwnerArtwork(artwork, product), creatorUsername: profile?.username ?? null, publishedAt: artwork.publishedAt }];
      }));
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
  return { version: 1, profiles: [], artworks: [], moderationEvents: [], rateLimitBuckets: {} };
}

function readSnapshot(filePath: string): LocalSnapshot {
  if (!fs.existsSync(filePath)) return initialSnapshot();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<LocalSnapshot>;
    if (parsed.version !== 1 || !Array.isArray(parsed.profiles) || !Array.isArray(parsed.artworks)
      || !Array.isArray(parsed.moderationEvents) || typeof parsed.rateLimitBuckets !== "object" || !parsed.rateLimitBuckets) {
      throw new Error("Unexpected community local-store structure.");
    }
    return parsed as LocalSnapshot;
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

function publicProduct(product: Product): CommunityPublicProduct {
  return {
    id: product.id,
    slug: product.slug,
    title: product.translations.find((translation) => translation.locale === "en")?.title ?? product.slug,
    audience: product.audience,
  };
}

function toPublicArtwork(artwork: LocalArtwork, product: Product, profile: LocalProfile): CommunityPublicArtwork {
  return {
    id: artwork.id,
    product: publicProduct(product),
    creator: { username: profile.username, avatarSeed: profile.avatarSeed },
    contentType: artwork.contentType,
    description: artwork.description,
    publishedAt: artwork.publishedAt!,
  };
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

function encodeCursor(artwork: LocalArtwork) {
  return Buffer.from(`${artwork.publishedAt}|${artwork.id}`).toString("base64url");
}

function decodeCursor(cursor: string | null | undefined) {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    return /^\d{4}-\d\d-\d\dT.+\|[0-9a-f-]{36}$/i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function page<T>(items: T[], extra?: LocalArtwork | null): CommunityPage<T> {
  const item = extra as LocalArtwork | null | undefined;
  return {
    items,
    nextCursor: item?.publishedAt ? encodeCursor(item) : null,
  };
}
