import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ actor: {
  backend: "supabase", userId: "a0000000-0000-4000-8000-000000000001",
  emailVerified: true, role: "user", unlockedProductIds: [],
} }));
vi.mock("server-only", () => ({}));
vi.mock("./session", () => ({
  assertCommunityActor: vi.fn(async () => context.actor),
  getCommunityActorForRequest: vi.fn(async () => context.actor),
}));
vi.mock("./supabase-adapter", () => ({
  listPublicArtworks: vi.fn(async () => ({ items: [{ id: "existing-approved-work" }], nextCursor: null })),
  getPublicArtwork: vi.fn(),
  joinCommunity: vi.fn(async () => context.actor.userId),
  getOwnerProfile: vi.fn(async () => ({ username: "garden_user", avatarSeed: "safe-seed", isAdult: true })),
  createPendingArtwork: vi.fn(),
}));

import * as adapter from "./supabase-adapter";
import { createPendingCommunityArtwork, getCommunityPublicArtwork, joinColoringClub, listCommunityPublicArtworks } from "./repository";
import { CommunityValidationError } from "./errors";

describe("community repository flag and profile boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LAMILIA_BACKEND", "supabase");
    vi.stubEnv("COLORING_CLUB_PUBLIC_ENABLED", "false");
    vi.stubEnv("COLORING_CLUB_UPLOADS_ENABLED", "false");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("does not read existing public content while public access is OFF", async () => {
    expect(await listCommunityPublicArtworks()).toEqual({ items: [], nextCursor: null });
    expect(await getCommunityPublicArtwork(context.actor.userId)).toBeNull();
    expect(adapter.listPublicArtworks).not.toHaveBeenCalled();
    expect(adapter.getPublicArtwork).not.toHaveBeenCalled();
  });

  it("blocks metadata submission on the server when uploads are OFF", async () => {
    vi.stubEnv("COLORING_CLUB_PUBLIC_ENABLED", "true");
    await expect(createPendingCommunityArtwork({ productId: "book", idempotencyKey: "unused",
      storageProvider: "supabase", contentType: "image/png", sizeBytes: 100 })).rejects.toThrow("unavailable");
    expect(adapter.createPendingArtwork).not.toHaveBeenCalled();
  });

  it("allows private membership rehearsal without enabling the public gallery", async () => {
    vi.stubEnv("COLORING_CLUB_UPLOADS_ENABLED", "true");
    const profile = await joinColoringClub({ username: " @Garden_User ", adultAttested: true });
    expect(adapter.joinCommunity).toHaveBeenCalledWith(context.actor, { username: "garden_user", adultAttested: true });
    expect(profile).toMatchObject({ username: "garden_user", isAdult: true });
    expect(JSON.stringify(profile)).not.toContain(context.actor.userId);
    expect(await listCommunityPublicArtworks()).toEqual({ items: [], nextCursor: null });
  });

  it("rejects malformed usernames before privileged database writes", async () => {
    vi.stubEnv("COLORING_CLUB_PUBLIC_ENABLED", "true");
    await expect(joinColoringClub({ username: "person@example.test", adultAttested: true })).rejects.toBeInstanceOf(CommunityValidationError);
    expect(adapter.joinCommunity).not.toHaveBeenCalled();
  });
});
