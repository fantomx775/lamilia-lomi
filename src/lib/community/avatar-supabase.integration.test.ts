import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadIsolatedCommunityTarget } from "../../../scripts/testing/isolated-community-target.mjs";

vi.mock("server-only", () => ({}));

import { GET as publicMedia } from "@/app/api/community/avatars/[id]/route";
import {
  getCommunityPublicAvatarUrl, getOwnerAvatarView, readCommunityAvatar,
  removeCommunityAvatar, reviewCommunityAvatar, uploadCommunityAvatar, consumeAvatarUploadRateLimit, submitCommunityAvatarReport,
} from "./avatar-repository";
import { normalizeAvatarImage } from "./avatar-image";
import { processCommunityAccountMediaCleanup } from "./repository";

const BUCKET = "community-avatars";
const options = { auth: { persistSession: false, autoRefreshToken: false } };

describe.skipIf(process.env.RUN_COMMUNITY_AVATAR_SUPABASE_TESTS !== "1")("profile photo Auth, database and private Storage lifecycle", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let owner: SupabaseClient;
  let admin: SupabaseClient;
  let stranger: SupabaseClient;
  let ownerId: string;
  let adminId: string;
  let strangerId: string;
  let image: Uint8Array;
  const ids = new Set<string>();
  const objects = new Set<string>();
  const key = randomUUID().slice(0, 8);
  const username = `avatar_${key}`;

  beforeAll(async () => {
    const target = loadIsolatedCommunityTarget();
    vi.stubEnv("LAMILIA_BACKEND", "supabase");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://127.0.0.1:3443");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", target.apiUrl);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", target.publishableKey);
    vi.stubEnv("SUPABASE_SECRET_KEY", target.serviceRoleKey);
    vi.stubEnv("COLORING_CLUB_PUBLIC_ENABLED", "true");
    service = createClient(target.apiUrl, target.serviceRoleKey, options);
    anon = createClient(target.apiUrl, target.publishableKey, options);
    owner = createClient(target.apiUrl, target.publishableKey, options);
    stranger = createClient(target.apiUrl, target.publishableKey, options);
    admin = createClient(target.apiUrl, target.publishableKey, options);

    async function createActor(kind: string, client: SupabaseClient) {
      const email = `avatar-${kind}-${key}@example.test`;
      const password = `A-${randomUUID()}-9!`;
      const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error("Could not create isolated avatar fixture.");
      ids.add(data.user.id);
      const signedIn = await client.auth.signInWithPassword({ email, password });
      if (signedIn.error) throw new Error("Could not authenticate isolated avatar fixture.");
      return data.user.id;
    }

    ownerId = await createActor("owner", owner);
    strangerId = await createActor("stranger", stranger);
    adminId = await createActor("moderator", admin);
    expect((await service.from("profiles").update({ role: "admin" }).eq("id", adminId)).error).toBeNull();
    expect((await service.rpc("community_join", {
      p_actor_user_id: ownerId, p_username: username, p_adult_attested: true, p_rules_version: "2026-10-25-v1",
    })).error).toBeNull();

    image = await normalizeAvatarImage(await sharp({
      create: { width: 260, height: 320, channels: 3, background: "#845f4b" },
    }).jpeg().toBuffer(), "image/jpeg");
  }, 40_000);

  afterAll(async () => {
    try {
      for (const id of ids) expect((await service.auth.admin.deleteUser(id)).error).toBeNull();
      if (objects.size) {
        const objectList = [...objects];
        expect((await service.storage.from(BUCKET).remove(objectList)).error).toBeNull();
        expect((await service.from("community_account_media_cleanup_jobs").delete()
          .in("storage_path", objectList.map((id) => `avatars/${id}`))).error).toBeNull();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  }, 30_000);

  async function upload() {
    await uploadCommunityAvatar(ownerId, image);
    const { data, error } = await service.from("community_profile_avatars").select("id")
      .eq("user_id", ownerId).eq("status", "approved").single();
    expect(error).toBeNull();
    const id = String(data?.id);
    objects.add(id);
    return id;
  }

  function getPublicMedia(id: string) {
    return publicMedia(new Request(`https://127.0.0.1:3443/api/community/avatars/${id}`), { params: Promise.resolve({ id }) });
  }

  it("denies direct access and publishes immediately, replaces safely, reports privately and removes", async () => {
    const first = await upload();
    expect(await getOwnerAvatarView(ownerId)).toEqual({ approvedId: first, pending: false, rejected: false });
    expect(await getCommunityPublicAvatarUrl(username)).toBe(`/api/community/avatars/${first}`);
    expect((await getPublicMedia(first)).status).toBe(200);
    expect((await readCommunityAvatar(first, "owner", ownerId))?.status).toBe(200);
    expect((await readCommunityAvatar(first, "admin"))?.status).toBe(200);

    for (const client of [anon, owner, stranger, admin]) {
      expect((await client.from("community_profile_avatars").select("id")).error).toBeTruthy();
      expect((await client.rpc("community_public_avatar_ids", { p_usernames: [username] })).error).toBeTruthy();
      expect((await client.rpc("community_avatar_report", { p_actor: strangerId, p_id: first, p_reason: "privacy", p_details: "" })).error).toBeTruthy();
      expect((await client.rpc("community_avatar_review", {
        p_admin: adminId, p_id: first, p_decision: "approved",
      })).error).toBeTruthy();
      expect((await client.storage.from(BUCKET).download(first)).error).toBeTruthy();
      expect((await client.storage.from(BUCKET).createSignedUrl(first, 30)).error).toBeTruthy();
    }
    expect((await anon.storage.from(BUCKET).getPublicUrl(first)).data.publicUrl).toContain("/public/");
    const direct = await fetch(anon.storage.from(BUCKET).getPublicUrl(first).data.publicUrl);
    expect(direct.ok).toBe(false);
    await expect(reviewCommunityAvatar(strangerId, first, "removed")).rejects.toMatchObject({ name: "CommunityAuthorizationError" });


    const response = await getPublicMedia(first);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await getCommunityPublicAvatarUrl(username)).toBe(`/api/community/avatars/${first}`);
    expect(await readCommunityAvatar(first, "owner", strangerId)).toBeNull();
    expect((await readCommunityAvatar(first, "owner", ownerId))?.status).toBe(200);

    const second = await upload();
    expect((await getPublicMedia(first)).status).toBe(404);
    expect((await getPublicMedia(second)).status).toBe(200);
    expect(await submitCommunityAvatarReport(strangerId, second, "privacy", "Concern")).toEqual({ duplicate: false });
    expect(await submitCommunityAvatarReport(strangerId, second, "privacy", "Concern")).toEqual({ duplicate: true });
    expect((await stranger.from("community_avatar_reports").select("*")).error).toBeTruthy();
    await reviewCommunityAvatar(adminId, second, "removed");
    expect(await getOwnerAvatarView(ownerId)).toEqual({ approvedId: null, pending: false, rejected: false });
    expect((await getPublicMedia(second)).status).toBe(404);

    vi.stubEnv("COLORING_CLUB_PUBLIC_ENABLED", "false");
    expect((await getPublicMedia(second)).status).toBe(404);
    vi.stubEnv("COLORING_CLUB_PUBLIC_ENABLED", "true");

    const third = await upload();
    const results = await Promise.allSettled([reviewCommunityAvatar(adminId, third, "removed"), removeCommunityAvatar(ownerId)]);
    expect(results[1].status).toBe("fulfilled");
    expect(await getOwnerAvatarView(ownerId)).toEqual({ approvedId: null, pending: false, rejected: false });
    expect((await getPublicMedia(first)).status).toBe(404);
    expect((await getPublicMedia(third)).status).toBe(404);

    await processCommunityAccountMediaCleanup();
    for (const id of [first, second, third]) expect((await service.storage.from(BUCKET).download(id)).error).toBeTruthy();
  }, 35_000);

  it("keeps historical pending and rejected photos private and cleans them up on replacement", async () => {
    const historical: string[] = [];
    for (const status of ["pending", "rejected"]) {
      const reserved = await service.rpc("community_avatar_reserve", { p_user: ownerId });
      expect(reserved.error).toBeNull();
      const id = String(reserved.data);
      objects.add(id);
      historical.push(id);
      expect((await service.storage.from(BUCKET).upload(id, image, { contentType: "image/webp" })).error).toBeNull();
      // A real historical upload is outside the five-minute late-write fence.
      expect((await service.from("community_profile_avatars").update({ created_at: new Date(Date.now() - 600_000).toISOString() }).eq("id", id)).error).toBeNull();
      expect((await service.from("community_profile_avatars").update({ status }).eq("id", id)).error).toBeNull();
      expect((await getPublicMedia(id)).status).toBe(404);
      expect(await readCommunityAvatar(id, "owner", strangerId)).toBeNull();
    }
    expect(await getOwnerAvatarView(ownerId)).toEqual({ approvedId: null, pending: true, rejected: true });
    const published = await upload();
    expect((await getPublicMedia(published)).status).toBe(200);
    expect(await getOwnerAvatarView(ownerId)).toEqual({ approvedId: published, pending: false, rejected: false });
    await processCommunityAccountMediaCleanup();
    for (const id of historical) {
      expect((await getPublicMedia(id)).status).toBe(404);
      expect((await service.storage.from(BUCKET).download(id)).error).toBeTruthy();
    }
  }, 30_000);

  it("fences late finalization and erases objects on account deletion", async () => {
    const reserved = await service.rpc("community_avatar_reserve", { p_user: ownerId });
    expect(reserved.error).toBeNull();
    const staleId = String(reserved.data);
    objects.add(staleId);
    await removeCommunityAvatar(ownerId);
    expect((await service.storage.from(BUCKET).upload(staleId, image, { contentType: "image/webp" })).error).toBeNull();
    expect((await service.rpc("community_avatar_finalize", { p_user: ownerId, p_id: staleId })).error?.code).toBe("40001");
    const fenced = await service.from("community_account_media_cleanup_jobs").select("not_before").eq("storage_path", `avatars/${staleId}`).single();
    expect(fenced.error).toBeNull();
    expect(new Date(fenced.data!.not_before).getTime()).toBeGreaterThan(Date.now());

    const approved = await upload();

    const pending = await upload();
    expect((await service.auth.admin.deleteUser(ownerId)).error).toBeNull();
    ids.delete(ownerId);
    expect((await getPublicMedia(approved)).status).toBe(404);
    expect(await readCommunityAvatar(pending, "admin")).toBeNull();
    await processCommunityAccountMediaCleanup();
    for (const id of [approved, pending]) expect((await service.storage.from(BUCKET).download(id)).error).toBeTruthy();

    for (let count = 0; count < 6; count++) await consumeAvatarUploadRateLimit(strangerId);
    await expect(consumeAvatarUploadRateLimit(strangerId)).rejects.toMatchObject({ name: "CommunityRateLimitError" });
  }, 30_000);

  it("hides and schedules deletion of a soft-deleted account's approved photo", async () => {
    expect((await service.rpc("community_join", {
      p_actor_user_id: strangerId, p_username: `${username}_other`, p_adult_attested: true, p_rules_version: "2026-10-25-v1",
    })).error).toBeNull();
    await uploadCommunityAvatar(strangerId, image);
    const { data, error } = await service.from("community_profile_avatars").select("id")
      .eq("user_id", strangerId).eq("status", "approved").single();
    expect(error).toBeNull();
    const id = String(data?.id);
    objects.add(id);

    expect((await getPublicMedia(id)).status).toBe(200);
    expect((await service.auth.admin.deleteUser(strangerId, true)).error).toBeNull();
    expect((await getPublicMedia(id)).status).toBe(404);
    expect(await getCommunityPublicAvatarUrl(`${username}_other`)).toBeUndefined();
    await processCommunityAccountMediaCleanup();
    expect((await service.storage.from(BUCKET).download(id)).error).toBeTruthy();
  }, 25_000);
});
