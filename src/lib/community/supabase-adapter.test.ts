import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("../supabase/admin", () => ({
  createServiceRoleClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));

import { finalizeArtworkUpload, listPublicArtworks } from "./supabase-adapter";

function queryChain() {
  const chain = new Proxy({}, {
    get(_target, property) {
      if (property === "then") {
        return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: mocks.rows, error: null }).then(resolve, reject);
      }
      return () => chain;
    },
  });
  return chain;
}

describe("community artwork dimensions in the Supabase adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
    mocks.from.mockImplementation(() => queryChain());
    mocks.rpc.mockResolvedValue({ data: "44444444-4444-4444-8444-444444444444", error: null });
  });

  it("maps validated stored dimensions into the public artwork read model", async () => {
    mocks.rows = [{
      id: "11111111-1111-4111-8111-111111111111",
      product_id: "22222222-2222-4222-8222-222222222222",
      content_type: "image/webp",
      image_width: 320,
      image_height: 240,
      description: "A garden",
      published_at: "2026-11-21T10:00:00.000Z",
      likes_count: 2,
      products: { id: "22222222-2222-4222-8222-222222222222", slug: "garden", title: "Garden", audience: "adults", product_translations: [{ locale: "en", title: "Garden" }] },
      community_profiles: { username: "garden_artist", avatar_seed: "seed" },
    }];

    const result = await listPublicArtworks({ limit: 1 });

    expect(result.items[0]?.imageDimensions).toEqual({ width: 320, height: 240 });
    expect(mocks.from).toHaveBeenCalledWith("community_artworks");
  });

  it("keeps legacy or invalid dimension rows on the existing src fallback", async () => {
    mocks.rows = [{
      id: "11111111-1111-4111-8111-111111111111",
      content_type: "image/webp",
      image_width: null,
      image_height: null,
      description: "Legacy art",
      published_at: "2026-11-21T10:00:00.000Z",
      likes_count: 0,
      products: { id: "22222222-2222-4222-8222-222222222222", slug: "garden", title: "Garden", audience: "adults", product_translations: [{ locale: "en", title: "Garden" }] },
      community_profiles: { username: "garden_artist", avatar_seed: "seed" },
    }];

    const result = await listPublicArtworks({ limit: 1 });

    expect(result.items[0]?.imageDimensions).toBeNull();
  });

  it("passes only the normalized image dimensions to upload finalization", async () => {
    const actor = { backend: "supabase" as const, userId: "33333333-3333-4333-8333-333333333333", emailVerified: true, role: "user" as const, unlockedProductIds: [] };

    await finalizeArtworkUpload(actor, "44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555", { width: 320, height: 240 });

    expect(mocks.rpc).toHaveBeenCalledWith("community_finalize_upload", {
      p_actor_user_id: actor.userId,
      p_idempotency_key: "44444444-4444-4444-8444-444444444444",
      p_lease_token: "55555555-5555-4555-8555-555555555555",
      p_image_width: 320,
      p_image_height: 240,
    });
  });
});
