import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getSeedContentSnapshot } from "../local-content";
import {
  CommunityAuthorizationError,
  CommunityConflictError,
  CommunityLocalStore,
  CommunityRateLimitError,
  CommunityValidationError,
  hashCommunityRateLimitKey,
  type LocalCommunityActor,
} from "./local-store";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const ID_KEY = "44444444-4444-4444-8444-444444444444";
const member: LocalCommunityActor = {
  userId: USER_A, emailVerified: true, role: "user", unlockedProductIds: [],
};
const otherMember: LocalCommunityActor = {
  userId: USER_B, emailVerified: true, role: "user", unlockedProductIds: [],
};
const admin: LocalCommunityActor = {
  userId: ADMIN, emailVerified: true, role: "admin", unlockedProductIds: [],
};

const tempDirs: string[] = [];
afterEach(() => {
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function makeStore(now = () => new Date("2026-10-25T12:00:00.000Z")) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lamilia-community-test-"));
  tempDirs.push(directory);
  let id = 0;
  return new CommunityLocalStore({
    filePath: path.join(directory, "community.json"),
    now,
    uuid: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++id).padStart(12, "0")}`,
  });
}

function getPublishedProduct() {
  const product = getSeedContentSnapshot().products.find((candidate) => candidate.status === "published");
  if (!product) throw new Error("Seed content requires a published product.");
  return product;
}

function input(productId: string) {
  return {
    productId,
    idempotencyKey: ID_KEY,
    storageProvider: "local" as const,
    contentType: "image/png" as const,
    sizeBytes: 123_456,
    description: "  A flower garden  ",
  };
}

describe("Coloring Club local adapter", () => {
  it("keeps approved public DTOs allow-listed and applies status/revision transitions", async () => {
    const store = makeStore();
    const product = getPublishedProduct();
    const unlockedMember = { ...member, unlockedProductIds: [product.id] };
    await store.join(unlockedMember, { username: "@Garden_User", adultAttested: true });
    const artworkId = await store.createPendingArtwork(unlockedMember, input(product.id), [product]);

    expect(await store.getPublicArtwork(artworkId, [product])).toBeNull();
    expect(await store.listMyArtworks(unlockedMember, [product])).toMatchObject([
      { id: artworkId, status: "pending", description: "A flower garden", revision: 1 },
    ]);

    await store.moderate(admin, artworkId, 1, "approve", undefined, [product]);
    const publicArtwork = await store.getPublicArtwork(artworkId, [product]);
    expect(publicArtwork).toMatchObject({
      id: artworkId,
      description: "A flower garden",
      creator: { username: "garden_user" },
      product: { id: product.id, slug: product.slug },
    });
    expect(Object.keys(publicArtwork ?? {}).sort()).toEqual([
      "contentType", "creator", "description", "id", "product", "publishedAt",
    ]);
    expect(JSON.stringify(publicArtwork)).not.toMatch(/authorId|userId|email|storagePath|reason/i);

    await store.editDescription(unlockedMember, artworkId, 2, "Updated caption");
    expect(await store.getPublicArtwork(artworkId, [product])).toBeNull();
    expect(await store.listMyArtworks(unlockedMember, [product])).toMatchObject([
      { status: "pending", revision: 3, description: "Updated caption" },
    ]);
    await store.moderate(admin, artworkId, 3, "approve", undefined, [product]);
    await store.moderate(admin, artworkId, 4, "remove", "Please remove identifying details.", [product]);
    expect(await store.getPublicArtwork(artworkId, [product])).toBeNull();
    await store.editDescription(unlockedMember, artworkId, 5, "Edited but still private");
    expect(await store.listMyArtworks(unlockedMember, [product])).toMatchObject([
      { status: "removed", revision: 6, rejectionReason: "Please remove identifying details." },
    ]);
    await expect(store.moderate(admin, artworkId, 5, "restore", undefined, [product])).rejects.toBeInstanceOf(CommunityConflictError);
    await store.deleteArtwork(unlockedMember, artworkId, 6);
    expect(await store.listMyArtworks(unlockedMember, [product])).toEqual([]);
  });

  it("requires verified adult opt-in and an unlocked published product", async () => {
    const store = makeStore();
    const product = getPublishedProduct();
    await expect(store.join({ ...member, emailVerified: false }, { username: "garden_user", adultAttested: true }))
      .rejects.toBeInstanceOf(CommunityAuthorizationError);
    await expect(store.join(member, { username: "admin", adultAttested: true }))
      .rejects.toBeInstanceOf(CommunityValidationError);
    await expect(store.join(member, { username: "garden_user", adultAttested: false }))
      .rejects.toBeInstanceOf(CommunityAuthorizationError);
    await store.join(member, { username: "garden_user", adultAttested: true });
    await expect(store.createPendingArtwork(member, input(product.id), [product]))
      .rejects.toBeInstanceOf(CommunityAuthorizationError);
    const unlocked = { ...member, unlockedProductIds: [product.id] };
    const archived = { ...product, status: "archived" as const };
    await expect(store.createPendingArtwork(unlocked, input(product.id), [archived]))
      .rejects.toBeInstanceOf(CommunityAuthorizationError);
  });

  it("deduplicates identical idempotent submissions and rejects key reuse with new metadata", async () => {
    const store = makeStore();
    const product = getPublishedProduct();
    const unlocked = { ...member, unlockedProductIds: [product.id] };
    await store.join(unlocked, { username: "garden_user", adultAttested: true });
    const artworkId = await store.createPendingArtwork(unlocked, input(product.id), [product]);
    expect(await store.createPendingArtwork(unlocked, input(product.id), [product])).toBe(artworkId);
    await expect(store.createPendingArtwork(unlocked, { ...input(product.id), description: "different" }, [product]))
      .rejects.toBeInstanceOf(CommunityConflictError);
  });

  it("makes join idempotent and routes username changes through their own limiter", async () => {
    let currentTime = new Date("2026-10-25T12:00:00.000Z");
    const store = makeStore(() => currentTime);
    const first = await store.join(member, { username: "garden_user", adultAttested: true });
    const repeated = await store.join(member, { username: "@Garden_User", adultAttested: true });
    expect(repeated.acceptedAt).toBe(first.acceptedAt);
    await expect(store.join(member, { username: "another_name", adultAttested: true }))
      .rejects.toBeInstanceOf(CommunityValidationError);
    await store.changeUsername(member, "another_name");
    await store.changeUsername(member, "third_name");
    await store.changeUsername(member, "fourth_name");
    await expect(store.changeUsername(member, "fifth_name"))
      .rejects.toBeInstanceOf(CommunityRateLimitError);
    await store.leave(member);
    await expect(store.changeUsername(member, "after_leave"))
      .rejects.toBeInstanceOf(CommunityAuthorizationError);
    currentTime = new Date("2026-10-26T12:00:00.000Z");
    const rejoined = await store.join(member, { username: "fourth_name", adultAttested: true });
    expect(rejoined.adultAttestedAt).toBe(currentTime.toISOString());
  });

  it("reserves one private upload per idempotency key and finalizes atomically", async () => {
    const store = makeStore();
    const product = getPublishedProduct();
    const unlocked = { ...member, unlockedProductIds: [product.id] };
    await store.join(unlocked, { username: "garden_user", adultAttested: true });
    const input = {
      reservationToken: "55555555-5555-4555-8555-555555555555",
      productId: product.id,
      idempotencyKey: ID_KEY,
      storageProvider: "local" as const,
      contentType: "image/webp" as const,
      originalSizeBytes: 1_024,
      sizeBytes: 512,
      description: "My flower",
      uploadFingerprint: "a".repeat(64),
    };
    const reservation = await store.reserveArtworkUpload(unlocked, input, [product]);
    expect(reservation).toMatchObject({ state: "reserved", storagePath: `community/${USER_A}/${ID_KEY}` });
    await expect(store.reserveArtworkUpload(unlocked, { ...input, reservationToken: "66666666-6666-4666-8666-666666666666" }, [product]))
      .rejects.toBeInstanceOf(CommunityConflictError);
    await expect(store.reserveArtworkUpload(unlocked, { ...input, uploadFingerprint: "b".repeat(64) }, [product]))
      .rejects.toBeInstanceOf(CommunityConflictError);
    if (reservation.state !== "reserved") throw new Error("Expected a new reservation.");
    await expect(store.finalizeArtworkUpload(unlocked, ID_KEY, reservation.leaseToken, [product]))
      .rejects.toBeInstanceOf(CommunityConflictError);
    await store.markArtworkUploadStored(unlocked, ID_KEY, reservation.leaseToken);
    const artworkId = await store.finalizeArtworkUpload(unlocked, ID_KEY, reservation.leaseToken, [product]);
    expect(await store.finalizeArtworkUpload(unlocked, ID_KEY, reservation.leaseToken, [product])).toBe(artworkId);
    expect(await store.getMyArtwork(unlocked, artworkId, [product])).toMatchObject({ id: artworkId, status: "pending", revision: 1 });
    await store.deleteArtwork(unlocked, artworkId, 1);
    const [cleanup] = await store.claimUploadCleanup(unlocked);
    expect(cleanup).toMatchObject({ authorId: USER_A, idempotencyKey: ID_KEY, storagePath: `community/${USER_A}/${ID_KEY}` });
    expect(await store.finishUploadCleanup(cleanup)).toBe(true);
  });

  it("rechecks published product and current author eligibility before approval", async () => {
    const product = getPublishedProduct();
    const cases = [
      { products: [{ ...product, status: "archived" as const }], profileChange: null },
      { products: [product], profileChange: { suspendedAt: "2026-10-25T12:00:00.000Z" } },
      { products: [product], profileChange: { participationRevokedAt: "2026-10-25T12:00:00.000Z" } },
      { products: [product], profileChange: { rulesVersion: "old-rules" } },
    ];
    for (const testCase of cases) {
      const store = makeStore();
      const unlocked = { ...member, unlockedProductIds: [product.id] };
      await store.join(unlocked, { username: "garden_user", adultAttested: true });
      const artworkId = await store.createPendingArtwork(unlocked, input(product.id), [product]);
      if (testCase.profileChange) {
        const snapshot = JSON.parse(fs.readFileSync(path.join((store as unknown as { filePath: string }).filePath), "utf8"));
        Object.assign(snapshot.profiles[0], testCase.profileChange);
        fs.writeFileSync((store as unknown as { filePath: string }).filePath, JSON.stringify(snapshot));
      }
      await expect(store.moderate(admin, artworkId, 1, "approve", undefined, testCase.products))
        .rejects.toBeInstanceOf(CommunityAuthorizationError);
      expect(await store.getPublicArtwork(artworkId, [product])).toBeNull();
    }
  });

  it("serializes concurrent username reservations and fixed-window rate limits", async () => {
    let currentTime = new Date("2026-10-25T12:00:00.000Z");
    const store = makeStore(() => currentTime);
    const results = await Promise.allSettled([
      store.join(member, { username: "same_name", adultAttested: true }),
      store.join(otherMember, { username: "same_name", adultAttested: true }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const key = hashCommunityRateLimitKey("upload", USER_A);
    expect(await store.consumeRateLimit(key, 2, 60_000)).toBe(true);
    expect(await store.consumeRateLimit(key, 2, 60_000)).toBe(true);
    expect(await store.consumeRateLimit(key, 2, 60_000)).toBe(false);
    currentTime = new Date("2026-10-25T12:01:01.000Z");
    expect(await store.consumeRateLimit(key, 2, 60_000)).toBe(true);
  });

  it("does not expose pending/rejected/removed items to another signed-in member", async () => {
    const store = makeStore();
    const product = getPublishedProduct();
    const unlocked = { ...member, unlockedProductIds: [product.id] };
    await store.join(unlocked, { username: "garden_user", adultAttested: true });
    const artworkId = await store.createPendingArtwork(unlocked, input(product.id), [product]);
    expect(await store.getPublicArtwork(artworkId, [product])).toBeNull();
    expect(await store.listMyArtworks(otherMember, [product])).toEqual([]);
    await expect(store.editDescription(otherMember, artworkId, 1, "cross-user edit"))
      .rejects.toBeInstanceOf(CommunityConflictError);
    await store.moderate(admin, artworkId, 1, "reject", "Please revise the caption.", [product]);
    expect(await store.getPublicArtwork(artworkId, [product])).toBeNull();
  });
});
