import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
  getBackendMode: vi.fn(),
  getRequiredSupabaseEnv: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./config", () => ({
  getBackendMode: mocks.getBackendMode,
  getRequiredSupabaseEnv: mocks.getRequiredSupabaseEnv,
}));
vi.mock("./supabase/admin", () => ({ createServiceRoleClient: mocks.createServiceRoleClient }));

import { cleanupPersistedMedia } from "./media-storage";

const productId = "11111111-1111-4111-8111-111111111111";

function asset(id: string, storagePath: string) {
  return {
    id,
    productId,
    kind: "cover" as const,
    bucket: "public-media",
    path: `/api/media/${id}`,
    storagePath,
    filename: `${id}.jpg`,
    contentType: "image/jpeg",
    sortOrder: 1,
    isPublic: true,
  };
}

describe("persisted media cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBackendMode.mockReturnValue("supabase");
  });

  it("deletes an old object only after the next metadata set no longer references it", async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    mocks.createServiceRoleClient.mockReturnValue({ storage: { from: vi.fn(() => ({ remove })) } });

    await cleanupPersistedMedia({
      previous: [asset("old", `products/${productId}/cover/old.jpg`)],
      next: [asset("new", `products/${productId}/cover/new.jpg`)],
    });

    expect(remove).toHaveBeenCalledWith([`products/${productId}/cover/old.jpg`]);
  });

  it("keeps metadata cleanup non-fatal when Storage deletion fails", async () => {
    const remove = vi.fn().mockResolvedValue({ error: { message: "temporary failure" } });
    mocks.createServiceRoleClient.mockReturnValue({ storage: { from: vi.fn(() => ({ remove })) } });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(cleanupPersistedMedia({
      previous: [asset("old", `products/${productId}/cover/old.jpg`)],
      next: [],
    })).resolves.toBeUndefined();

    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
