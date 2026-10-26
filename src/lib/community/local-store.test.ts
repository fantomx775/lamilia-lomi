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
  it("uses stable published-time and artwork-ID cursors without duplicates", async () => {
    const store = makeStore();
    const product = getPublishedProduct();
    const unlockedMember = { ...member, unlockedProductIds: [product.id] };
    await store.join(unlockedMember, { username: "Garden_User", adultAttested: true });
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const submission = { ...input(product.id), idempotencyKey: `55555555-5555-4555-8555-55555555555${index}` };
      const id = await store.createPendingArtwork(unlockedMember, submission, [product]);
      ids.push(id);
      await store.moderate(admin, id, 1, "approve", undefined, [product]);
    }
    const first = await store.listPublicArtworks({ products: [product], limit: 2 });
    const second = await store.listPublicArtworks({ products: [product], limit: 2, cursor: first.nextCursor });
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual(ids.slice().sort().reverse());
    expect(second.nextCursor).toBeNull();
  });

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
      "contentType", "creator", "description", "id", "likedByMe", "likesCount", "product", "publishedAt",
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

  it("sets hearts idempotently, paginates popular work, and clears a member's reactions on withdrawal", async () => {
    const store = makeStore();
    const product = getPublishedProduct();
    const unlockedMember = { ...member, unlockedProductIds: [product.id] };
    const unlockedOther = { ...otherMember, unlockedProductIds: [product.id] };
    await store.join(unlockedMember, { username: "Garden_User", adultAttested: true });
    await store.join(unlockedOther, { username: "Other_Garden", adultAttested: true });
    const firstId = await store.createPendingArtwork(unlockedMember, input(product.id), [product]);
    const secondId = await store.createPendingArtwork(unlockedOther, { ...input(product.id), idempotencyKey: "55555555-5555-4555-8555-555555555556" }, [product]);
    await store.moderate(admin, firstId, 1, "approve", undefined, [product]);
    await store.moderate(admin, secondId, 1, "approve", undefined, [product]);

    expect(await store.setArtworkLike(member, secondId, true, [product])).toMatchObject({ available: true, liked: true, likesCount: 1 });
    expect(await store.setArtworkLike(member, secondId, true, [product])).toMatchObject({ available: true, liked: true, likesCount: 1 });
    expect(await store.setArtworkLike(otherMember, firstId, true, [product])).toMatchObject({ available: true, liked: true, likesCount: 1 });
    const popular = await store.listPublicArtworks({ products: [product], sort: "popular", limit: 1, viewerUserId: USER_A });
    expect(popular.items[0]).toMatchObject({ id: secondId, likesCount: 1, likedByMe: true });
    expect(popular.nextCursor).toBeTruthy();
    const next = await store.listPublicArtworks({ products: [product], sort: "popular", limit: 1, cursor: popular.nextCursor });
    expect(next.items[0]).toMatchObject({ id: firstId, likesCount: 1, likedByMe: false });

    await store.leave(member);
    expect(await store.getPublicArtwork(secondId, [product], USER_A)).toMatchObject({ likesCount: 0, likedByMe: false });
    await expect(store.setArtworkLike(member, firstId, false, [product])).rejects.toBeInstanceOf(CommunityAuthorizationError);
  });

  it("accepts verified nonmember reports once and keeps reporter identity out of admin DTOs", async () => {
    const store = makeStore();
    const product = getPublishedProduct();
    const unlockedMember = { ...member, unlockedProductIds: [product.id] };
    await store.join(unlockedMember, { username: "Garden_User", adultAttested: true });
    const artworkId = await store.createPendingArtwork(unlockedMember, input(product.id), [product]);
    await store.moderate(admin, artworkId, 1, "approve", undefined, [product]);

    expect(await store.submitArtworkReport(otherMember, artworkId, "privacy", "Please check the background.", [product])).toEqual({ duplicate: false });
    expect(await store.submitArtworkReport(otherMember, artworkId, "other", "A second note.", [product])).toEqual({ duplicate: true });
    const snapshotPath = path.join(tempDirs.at(-1)!, "community.json");
    const beforeReview = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as { reports: Array<{ retentionExpiresAt: string; createdAt: string }> };
    expect(new Date(beforeReview.reports[0]!.retentionExpiresAt).getTime() - new Date(beforeReview.reports[0]!.createdAt).getTime()).toBe(90 * 24 * 60 * 60 * 1_000);
    const reports = await store.listAdminReports(admin, [product], { limit: 10 });
    expect(reports.items).toMatchObject([{ reason: "privacy", details: "Please check the background.", creatorUsername: "garden_user", status: "open" }]);
    expect(JSON.stringify(reports)).not.toMatch(/reporterUserId|userId|email/i);
    const report = reports.items[0];
    expect(report).toBeDefined();
    await store.updateReport(admin, report!.id, report!.revision, "reviewed");
    const afterReview = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as { reports: Array<{ retentionExpiresAt: string }> };
    expect(afterReview.reports[0]!.retentionExpiresAt).toBe(beforeReview.reports[0]!.retentionExpiresAt);
    await expect(store.updateReport(admin, report!.id, report!.revision, "resolve")).rejects.toBeInstanceOf(CommunityConflictError);
    const refreshed = await store.listAdminReports(admin, [product], { status: "reviewed", limit: 10 });
    expect(refreshed.items[0]).toMatchObject({ status: "reviewed", revision: 2 });
  });

  it("scrubs an expired reviewed report without dismissing it and leaves a future report intact", async () => {
    let current = new Date("2026-10-25T12:00:00.000Z");
    const store = makeStore(() => new Date(current));
    const product = getPublishedProduct();
    const unlockedMember = { ...member, unlockedProductIds: [product.id] };
    await store.join(unlockedMember, { username: "Garden_User", adultAttested: true });
    const artworkId = await store.createPendingArtwork(unlockedMember, input(product.id), [product]);
    await store.moderate(admin, artworkId, 1, "approve", undefined, [product]);
    await store.submitArtworkReport(otherMember, artworkId, "privacy", "Expired reviewed details.", [product]);
    await store.submitArtworkReport(member, artworkId, "rights", "Future open details.", [product]);
    const reports = await store.listAdminReports(admin, [product], { limit: 10 });
    const reviewed = reports.items.find((report) => report.reason === "privacy")!;
    await store.updateReport(admin, reviewed.id, reviewed.revision, "reviewed");

    const snapshotPath = path.join(tempDirs.at(-1)!, "community.json");
    const fixture = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
      reports: Array<{ id: string; retentionExpiresAt: string | null }>;
    };
    fixture.reports.find((report) => report.id === reviewed.id)!.retentionExpiresAt = "2026-10-25T11:59:00.000Z";
    fs.writeFileSync(snapshotPath, JSON.stringify(fixture));
    current = new Date("2027-01-22T12:00:00.000Z"); // 89 days later: the second report is still within its 90-day deadline.

    expect(await store.purgeExpiredReportDetails()).toBe(1);
    const after = await store.listAdminReports(admin, [product], { limit: 10 });
    expect(after.items.find((report) => report.id === reviewed.id)).toMatchObject({ status: "reviewed", reason: "privacy", details: "" });
    expect(after.items.find((report) => report.reason === "rights")).toMatchObject({ status: "open", details: "Future open details." });
    expect(await store.purgeExpiredReportDetails()).toBe(0);
  });

  it("scrubs reporter linkage and free text 30 days after a report is resolved", async () => {
    let current = new Date("2026-10-25T12:00:00.000Z");
    const store = makeStore(() => new Date(current));
    const product = getPublishedProduct();
    const unlockedMember = { ...member, unlockedProductIds: [product.id] };
    await store.join(unlockedMember, { username: "Garden_User", adultAttested: true });
    const artworkId = await store.createPendingArtwork(unlockedMember, input(product.id), [product]);
    await store.moderate(admin, artworkId, 1, "approve", undefined, [product]);
    await store.submitArtworkReport(otherMember, artworkId, "privacy", "Private report text.", [product]);
    const report = (await store.listAdminReports(admin, [product], { limit: 10 })).items[0]!;
    await store.updateReport(admin, report.id, report.revision, "resolve");
    // Account deletion may already have anonymized the report row before the
    // moderator resolves it. The later retention run must still scrub event actors.
    const snapshotPath = path.join(tempDirs.at(-1)!, "community.json");
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
      reports: Array<{ reporterUserId: string | null; details: string }>;
    };
    snapshot.reports[0]!.reporterUserId = null;
    snapshot.reports[0]!.details = "";
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
    current = new Date(current.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(await store.purgeExpiredReportDetails()).toBe(1);
    const scrubbedSnapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
      reportEvents: Array<{ actorUserId: string | null }>;
    };
    expect(scrubbedSnapshot.reportEvents.every((event) => event.actorUserId === null)).toBe(true);
    const after = (await store.listAdminReports(admin, [product], { limit: 10 })).items[0];
    expect(after).toMatchObject({ details: "", status: "resolved", revision: 3 });
  });

  it("fences local product deletion against community references and stale saves", async () => {
    const store = makeStore();
    const product = getPublishedProduct();
    const unlockedMember = { ...member, unlockedProductIds: [product.id] };
    await store.join(unlockedMember, { username: "Garden_User", adultAttested: true });
    await store.createPendingArtwork(unlockedMember, input(product.id), [product]);
    expect(await store.beginProductDeletion(product.id)).toBe(false);

    const unusedProductId = "77777777-7777-4777-8777-777777777777";
    expect(await store.beginProductDeletion(unusedProductId)).toBe(true);
    await expect(store.withProductSave(unusedProductId, () => "saved"))
      .rejects.toBeInstanceOf(CommunityConflictError);
  });

  it("queues local account media before removing private community identity", async () => {
    let current = new Date("2026-10-25T12:00:00.000Z");
    const store = makeStore(() => new Date(current));
    const product = getPublishedProduct();
    const unlockedMember = { ...member, unlockedProductIds: [product.id] };
    await store.join(unlockedMember, { username: "Garden_User", adultAttested: true });
    const artworkId = await store.createPendingArtwork(unlockedMember, input(product.id), [product]);
    expect(await store.getArtworkMedia(artworkId, [product], unlockedMember)).not.toBeNull();

    expect(await store.deleteAccount(USER_A)).toBe(1);
    expect(await store.getArtworkMedia(artworkId, [product], unlockedMember)).toBeNull();
    expect(await store.getProfile(unlockedMember)).toBeNull();
    const deletedAccountSnapshot = JSON.parse(fs.readFileSync(path.join(tempDirs.at(-1)!, "community.json"), "utf8")) as {
      moderationEvents: Array<{ artworkId: string; actorUserId: string | null; toStatus: string; reason: string | null }>;
    };
    expect(deletedAccountSnapshot.moderationEvents.at(-1)).toMatchObject({
      artworkId, actorUserId: null, toStatus: "removed", reason: null,
    });
    expect(await store.claimAccountMediaCleanup()).toEqual([]);

    current = new Date(current.getTime() + 13 * 60 * 1_000);
    const [candidate] = await store.claimAccountMediaCleanup();
    expect(candidate).toMatchObject({ storagePath: `community/${USER_A}/${ID_KEY}`, storageProvider: "local" });
    expect(await store.finishAccountMediaCleanup(candidate!, "deleted")).toBe(true);
    expect(await store.claimAccountMediaCleanup()).toEqual([]);
  });

  it("filters and paginates the admin queue with safe status history", async () => {
    const store = makeStore();
    const product = getPublishedProduct();
    const unlocked = { ...member, unlockedProductIds: [product.id] };
    await store.join(unlocked, { username: "garden_user", adultAttested: true });
    const firstId = await store.createPendingArtwork(unlocked, input(product.id), [product]);
    const secondId = await store.createPendingArtwork(unlocked, { ...input(product.id), idempotencyKey: "55555555-5555-4555-8555-555555555555" }, [product]);
    const firstPage = await store.listAdminArtworks(admin, [product], { status: "pending", creator: "garden_", limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]).toMatchObject({ id: firstId, creatorUsername: "garden_user" });
    expect(firstPage.counts.pending).toBe(2);
    expect(firstPage.nextCursor).toBeTruthy();
    const nextPage = await store.listAdminArtworks(admin, [product], { status: "pending", creator: "garden_", limit: 1, cursor: firstPage.nextCursor });
    expect(nextPage.items.map((item) => item.id)).toEqual([secondId]);
    await store.moderate(admin, firstId, 1, "reject", "Please remove personal details.", [product]);
    const detail = await store.getAdminArtwork(admin, firstId, [product]);
    expect(detail?.artwork).toMatchObject({ status: "rejected", revision: 2, creatorUsername: "garden_user", rejectionReason: "Please remove personal details." });
    expect(detail?.history).toMatchObject([{ revision: 2, fromStatus: "pending", toStatus: "rejected", reason: "Please remove personal details.", moderatorLabel: "Administrator" }]);
    expect(JSON.stringify(detail)).not.toMatch(/actorUserId|authorId|userId|email|storagePath/i);
    expect((await store.listAdminArtworks(admin, [product], { status: "pending" })).items).toHaveLength(1);
    expect((await store.listAdminArtworks(admin, [product], { status: "rejected" })).counts.rejected).toBe(1);
  });

  it("returns only a bounded product ID, slug, and English title projection to admins", async () => {
    const store = makeStore();
    const products = getSeedContentSnapshot().products;
    const options = store.listAdminProductOptions(admin, products, 1);
    expect(options).toHaveLength(1);
    expect(Object.keys(options[0]).sort()).toEqual(["id", "slug", "title"]);
    expect(() => store.listAdminProductOptions(member, products, 1)).toThrow(CommunityAuthorizationError);
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
