import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getBackendMode: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config", () => ({ getBackendMode: mocks.getBackendMode }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
  getCurrentAccessToken: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createServiceRoleClient: vi.fn() }));

import { getAboutPageSettingsForRequest } from "./content-repository";
import { saveAboutPageSettingsForRequest } from "./supabase-content-admin";

describe("About page settings persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBackendMode.mockReturnValue("supabase");
  });

  it("returns the saved settings on a later read", async () => {
    let storedRow = {
      id: "global",
      about_intro: "",
      favorite_coloring_book_ids: ["", "", ""],
      favorite_picture_book_ids: ["", "", ""],
    };
    const products = [
      { id: "coloring-1", product_type: "coloring-book", status: "published" },
      { id: "coloring-2", product_type: "coloring-book", status: "published" },
      { id: "coloring-3", product_type: "coloring-book", status: "published" },
      { id: "picture-1", product_type: "picture-book", status: "published" },
      { id: "picture-2", product_type: "picture-book", status: "published" },
      { id: "picture-3", product_type: "picture-book", status: "published" },
    ];
    const from = vi.fn(() => {
      let updateValues: {
        about_intro: string;
        favorite_coloring_book_ids: string[];
        favorite_picture_book_ids: string[];
      } | null = null;
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        update: vi.fn((values: typeof updateValues) => {
          updateValues = values;
          return query;
        }),
        maybeSingle: vi.fn(async () => {
          if (updateValues) {
            storedRow = { ...storedRow, ...updateValues };
            return { data: { id: "global" }, error: null };
          }
          return { data: structuredClone(storedRow), error: null };
        }),
        in: vi.fn((_: string, ids: string[]) => Promise.resolve({
          data: products.filter((product) => ids.includes(product.id)),
          error: null,
        })),
      };

      return query;
    });
    mocks.createClient.mockResolvedValue({ from });

    const form = new FormData();
    form.set("aboutIntro", "The books we love.");
    ["coloring-1", "coloring-2", "coloring-3"].forEach((id) => form.append("favoriteColoringBookIds", id));
    ["picture-1", "picture-2", "picture-3"].forEach((id) => form.append("favoritePictureBookIds", id));

    await expect(saveAboutPageSettingsForRequest(form)).resolves.toEqual({
      ok: true,
      id: "global",
    });
    await expect(getAboutPageSettingsForRequest()).resolves.toEqual({
      intro: "The books we love.",
      favoriteColoringBookIds: ["coloring-1", "coloring-2", "coloring-3"],
      favoritePictureBookIds: ["picture-1", "picture-2", "picture-3"],
    });
  });
});
