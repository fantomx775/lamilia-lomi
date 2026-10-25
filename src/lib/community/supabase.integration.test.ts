import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as adapter from "./supabase-adapter";
import { getCommunityPublicArtwork, listCommunityPublicArtworks } from "./repository";
import type { CommunityActor } from "./session";

/** Explicitly opt in; never use deployed/customer resources as test fixtures. */
describe.skipIf(process.env.RUN_COMMUNITY_SUPABASE_TESTS !== "1")("community real local Auth/PostgREST repository", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let signedIn: SupabaseClient;
  let member: CommunityActor;
  let admin: CommunityActor;
  let other: CommunityActor;
  let artworkId: string;
  const userIds: string[] = [];
  const productId = randomUUID();
  const token = randomUUID().replaceAll("-", "").slice(0, 12);
  const username = `cc_${token}`;
  const productSlug = `cc-integration-${token}`;
  const password = `Cc-${randomUUID()}-9!`;

  beforeAll(async () => {
    const status = JSON.parse(readFileSync(
      "/tmp/lamilia-p0-preflight/local-supabase-status.json", "utf8",
    )) as Record<string, string>;
    if (status.API_URL !== "http://127.0.0.1:55421") {
      throw new Error("Community integration tests require the isolated Lamilia API on port 55421.");
    }
    vi.stubEnv("LAMILIA_BACKEND", "supabase");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://localhost:3443");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", status.API_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", status.ANON_KEY);
    vi.stubEnv("SUPABASE_SECRET_KEY", status.SERVICE_ROLE_KEY);
    vi.stubEnv("COLORING_CLUB_PUBLIC_ENABLED", "true");
    const options = { auth: { autoRefreshToken: false, persistSession: false } };
    service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
    anon = createClient(status.API_URL, status.ANON_KEY, options);
    signedIn = createClient(status.API_URL, status.ANON_KEY, options);

    async function createActor(kind: "member" | "admin" | "other"): Promise<CommunityActor> {
      const { data, error } = await service.auth.admin.createUser({
        email: `cc-${kind}-${token}@example.test`, password, email_confirm: true,
        app_metadata: kind === "admin" ? { role: "admin" } : {},
        // A genuine user-editable role spoof must not confer administrator access.
        user_metadata: { role: "admin", terms_accepted: true, preferred_locale: "en" },
      });
      if (error || !data.user) throw new Error("Could not create isolated community Auth fixture.");
      userIds.push(data.user.id);
      return { backend: "supabase", userId: data.user.id, emailVerified: true,
        role: kind === "admin" ? "admin" : "user", unlockedProductIds: [] };
    }
    member = await createActor("member");
    admin = await createActor("admin");
    other = await createActor("other");
    // Moderation authorization uses the current profiles row, rather than an
    // in-memory actor label or JWT metadata. Provision only this test admin.
    const adminRoleResult = await service.from("profiles").update({ role: "admin" }).eq("id", admin.userId);
    if (adminRoleResult.error) throw new Error("Could not provision isolated moderator role.");
    const { error: loginError } = await signedIn.auth.signInWithPassword({
      email: `cc-member-${token}@example.test`, password,
    });
    if (loginError) throw new Error("Could not sign in to isolated community Auth fixture.");
    const productResult = await service.from("products").insert({
      id: productId, slug: productSlug, status: "published", audience: "adults", product_type: "coloring-book",
    });
    if (productResult.error) throw new Error("Could not create isolated community product fixture.");
    const translationResult = await service.from("product_translations").insert({
      product_id: productId, locale: "en", title: "Community integration book",
      short_description: "Isolated fixture", long_description: "Isolated fixture",
    });
    if (translationResult.error) throw new Error("Could not translate isolated community fixture.");
    const unlockResult = await service.from("user_product_unlocks").insert({ user_id: member.userId, product_id: productId });
    if (unlockResult.error) throw new Error("Could not grant isolated fixture unlock.");
  }, 30_000);

  afterAll(async () => {
    try {
      if (userIds.length) {
        // Audit rows are append-only for service_role. Only this known disposable
        // database's superuser removes exactly this run's controlled fixtures.
        if (userIds.some((id) => !/^[0-9a-f-]{36}$/.test(id))) throw new Error("Unsafe cleanup identity.");
        const ids = userIds.map((id) => `'${id}'::uuid`).join(",");
        execFileSync("docker", ["exec", "-i", "supabase_db_lamilia-coloring-club-p0",
          "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
          input: `BEGIN; DELETE FROM public.community_moderation_events WHERE artwork_id IN
            (SELECT id FROM public.community_artworks WHERE author_id IN (${ids}));
            DELETE FROM public.community_artworks WHERE author_id IN (${ids}); COMMIT;`,
          stdio: ["pipe", "pipe", "pipe"],
        });
      }
      if (service) {
        const result = await service.from("products").delete().eq("id", productId);
        if (result.error) throw new Error("Could not remove isolated product fixture.");
        for (const id of userIds) {
          const removed = await service.auth.admin.deleteUser(id);
          if (removed.error) throw new Error("Could not remove isolated Auth fixture.");
        }
      }
    } finally {
      await signedIn?.auth.signOut();
      vi.unstubAllEnvs();
    }
  }, 30_000);

  it("denies anonymous/authenticated raw data and RPC calls, including role spoofing", async () => {
    for (const client of [anon, signedIn]) {
      expect((await client.from("community_profiles").select("*")).error?.code).toBe("42501");
      expect((await client.from("community_artworks").select("*")).error?.code).toBe("42501");
      expect((await client.rpc("community_join", {
        p_actor_user_id: admin.userId, p_username: "spoofed_admin", p_adult_attested: true,
        p_rules_version: "2026-10-25-v1",
      })).error?.code).toBe("42501");
    }
    const profile = await service.from("profiles").select("role").eq("id", member.userId).single();
    expect(profile.error).toBeNull();
    expect(profile.data?.role).toBe("user");
    expect((await signedIn.auth.getUser()).data.user?.id).toBe(member.userId);
  });

  it("joins consistently and reserves only eligible own pending artwork idempotently", async () => {
    // The server repository strips the optional display prefix before this
    // internal adapter; SQL itself enforces lowercase canonical uniqueness.
    await adapter.joinCommunity(member, { username: username.toUpperCase(), adultAttested: true });
    const profile = await adapter.getOwnerProfile(member);
    expect(profile).toMatchObject({ username, isAdult: true });
    expect(profile).not.toHaveProperty("userId");
    await expect(adapter.joinCommunity(other, { username: username.toUpperCase(), adultAttested: true }))
      .rejects.toMatchObject({ name: "CommunityConflictError" });
    await adapter.joinCommunity(other, { username: `other_${token}`, adultAttested: true });
    const input = { productId, idempotencyKey: randomUUID(), storageProvider: "supabase" as const,
      contentType: "image/png" as const, sizeBytes: 120, description: "A private foundation fixture" };
    await expect(adapter.createPendingArtwork(other, input)).rejects.toThrow();
    const ids = await Promise.all([adapter.createPendingArtwork(member, input), adapter.createPendingArtwork(member, input)]);
    expect(ids[0]).toBe(ids[1]);
    artworkId = String(ids[0]);
    expect((await adapter.listOwnerArtworks(member, 24)).map((item) => item.id)).toEqual([artworkId]);
    expect(await adapter.listOwnerArtworks(other, 24)).toEqual([]);
    expect(await adapter.getPublicArtwork(artworkId)).toBeNull();
    const queue = await adapter.listAdminQueue(admin, 24);
    expect(queue.find((item) => item.id === artworkId)?.creatorUsername).toBe(username);
  });

  it("serializes moderation and hides edited, archived and suspended content in actual reads", async () => {
    expect(artworkId).toBeTruthy();
    const decisions = await Promise.allSettled([
      adapter.moderateArtwork(admin, artworkId, 1, "approve"),
      adapter.moderateArtwork(admin, artworkId, 1, "approve"),
    ]);
    expect(decisions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const page = await listCommunityPublicArtworks({ productId, limit: 1 });
    expect(page.items.map((item) => item.id)).toEqual([artworkId]);
    const publicJson = JSON.stringify(page);
    for (const forbidden of [member.userId, "storage_path", "author_id", "moderation_reason", "@example.test"]) {
      expect(publicJson).not.toContain(forbidden);
    }
    vi.stubEnv("COLORING_CLUB_PUBLIC_ENABLED", "false");
    expect(await getCommunityPublicArtwork(artworkId)).toBeNull();
    expect(await listCommunityPublicArtworks({ productId })).toEqual({ items: [], nextCursor: null });
    vi.stubEnv("COLORING_CLUB_PUBLIC_ENABLED", "true");
    expect((await getCommunityPublicArtwork(artworkId))?.creator.username).toBe(username);

    const archived = await service.from("products").update({ status: "archived" }).eq("id", productId);
    expect(archived.error).toBeNull();
    expect(await getCommunityPublicArtwork(artworkId)).toBeNull();
    expect((await service.from("products").update({ status: "published" }).eq("id", productId)).error).toBeNull();
    expect((await service.from("community_profiles").update({ suspended_at: new Date().toISOString() }).eq("user_id", member.userId)).error).toBeNull();
    expect(await getCommunityPublicArtwork(artworkId)).toBeNull();
    expect((await service.from("community_profiles").update({ suspended_at: null }).eq("user_id", member.userId)).error).toBeNull();
    await expect(adapter.editArtworkDescription(other, artworkId, 2, "Other user edit")).rejects.toThrow();
    expect(await adapter.editArtworkDescription(member, artworkId, 2, "Revised description")).toBe(3);
    expect(await getCommunityPublicArtwork(artworkId)).toBeNull();
    await adapter.moderateArtwork(admin, artworkId, 3, "approve");
    await adapter.moderateArtwork(admin, artworkId, 4, "remove", "Fixture removal reason");
    expect(await adapter.editArtworkDescription(member, artworkId, 5, "Still removed")).toBe(6);
    const own = (await adapter.listOwnerArtworks(member, 24))[0];
    expect(own).toMatchObject({ status: "removed", rejectionReason: "Fixture removal reason", revision: 6 });
    expect(await getCommunityPublicArtwork(artworkId)).toBeNull();
  }, 30_000);
});
