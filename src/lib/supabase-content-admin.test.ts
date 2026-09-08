import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentAccessToken: vi.fn(),
  createServiceRoleClient: vi.fn(),
  getAdminContentSnapshot: vi.fn(),
  getBackendMode: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  insertedTagTranslations: undefined as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config", () => ({ getBackendMode: mocks.getBackendMode }));
vi.mock("@/lib/content-repository", () => ({
  getAdminContentSnapshot: mocks.getAdminContentSnapshot,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
  getCurrentAccessToken: mocks.getCurrentAccessToken,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
}));

import { saveProductForRequest, saveTagForRequest } from "./supabase-content-admin";

describe("Supabase content admin mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getCurrentAccessToken.mockResolvedValue(null);
    mocks.getAdminContentSnapshot.mockResolvedValue({
      products: [],
      categories: [],
      tags: [],
      staticPages: [],
    });

    const resolvedQuery = () => Promise.resolve({ error: null });
    mocks.from.mockImplementation(() => ({
      upsert: vi.fn(() => resolvedQuery()),
      delete: vi.fn(() => ({ eq: vi.fn(() => resolvedQuery()) })),
      insert: vi.fn((rows) => {
        mocks.insertedTagTranslations = rows;
        return resolvedQuery();
      }),
    }));
    mocks.createClient.mockResolvedValue({ from: mocks.from, rpc: mocks.rpc });
  });

  it("persists the last visible tag name and description when the drawer has mirrored fields", async () => {
    const form = new FormData();
    form.append("name_en", "Old name");
    form.append("description_en", "Old description");
    form.append("name_en", "New name");
    form.append("description_en", "New description");
    form.set("slug", "new-name");

    await expect(saveTagForRequest(form)).resolves.toMatchObject({ ok: true });

    expect(mocks.insertedTagTranslations).toEqual([
      {
        tag_id: expect.any(String),
        locale: "en",
        name: "New name",
        description: "New description",
      },
    ]);
  });

  it("returns a stable application error when Supabase rejects a duplicate premium code", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        constraint: "premium_codes_normalized_code_key",
        message: "duplicate key value violates unique constraint",
      },
    });

    const form = new FormData();
    form.set("id", "11111111-1111-4111-8111-111111111111");
    form.set("slug", "duplicate-code-product");
    form.set("status", "draft");
    form.set("audience", "kids");
    form.set("productType", "coloring-book");
    form.set("title_en", "Duplicate code product");
    form.set("premiumCodeId", "22222222-2222-4222-8222-222222222222");
    form.set("premiumCode", "MOON-123");
    form.set("premiumCodeActive", "22222222-2222-4222-8222-222222222222");

    await expect(saveProductForRequest(form)).resolves.toEqual({
      ok: false,
      errors: ["admin.conflict.premium_code_duplicate"],
    });
  });
});
