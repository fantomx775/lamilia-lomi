import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getAdminContentSnapshot: vi.fn(),
  getBackendMode: vi.fn(),
  from: vi.fn(),
  insertedTagTranslations: undefined as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config", () => ({ getBackendMode: mocks.getBackendMode }));
vi.mock("@/lib/content-repository", () => ({
  getAdminContentSnapshot: mocks.getAdminContentSnapshot,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { saveTagForRequest } from "./supabase-content-admin";

describe("Supabase content admin mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBackendMode.mockReturnValue("supabase");
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
    mocks.createClient.mockResolvedValue({ from: mocks.from });
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
});
