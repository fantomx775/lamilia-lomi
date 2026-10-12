import { describe, expect, it } from "vitest";

import {
  DEFAULT_ABOUT_PAGE_SETTINGS,
  hasDuplicateAboutProductIds,
  normalizeAboutPageSettings,
  parseAboutPageSettingsFormData,
} from "./about-settings";

describe("About page settings", () => {
  it("normalizes persisted settings to three slots per section", () => {
    expect(normalizeAboutPageSettings({
      intro: "A short introduction.",
      favoriteColoringBookIds: [" coloring-1 ", "coloring-2"],
      favoritePictureBookIds: ["picture-1", "picture-2", "picture-3", "ignored"],
    })).toEqual({
      intro: "A short introduction.",
      favoriteColoringBookIds: ["coloring-1", "coloring-2", ""],
      favoritePictureBookIds: ["picture-1", "picture-2", "picture-3"],
    });
  });

  it("parses six distinct ordered IDs and permits empty slots", () => {
    const form = new FormData();
    form.set("aboutIntro", "An introduction.");
    ["coloring-1", "", "coloring-3"].forEach((id) => form.append("favoriteColoringBookIds", id));
    ["picture-1", "picture-2", "picture-3"].forEach((id) => form.append("favoritePictureBookIds", id));

    expect(parseAboutPageSettingsFormData(form)).toEqual({
      intro: "An introduction.",
      favoriteColoringBookIds: ["coloring-1", "", "coloring-3"],
      favoritePictureBookIds: ["picture-1", "picture-2", "picture-3"],
    });
  });

  it("rejects a malformed number of repeated product fields", () => {
    const form = new FormData();
    form.set("aboutIntro", "An introduction.");
    form.append("favoriteColoringBookIds", "coloring-1");
    ["picture-1", "picture-2", "picture-3"].forEach((id) => form.append("favoritePictureBookIds", id));

    expect(parseAboutPageSettingsFormData(form)).toBeNull();
  });

  it("detects duplicates within and across the two sections", () => {
    expect(hasDuplicateAboutProductIds({
      ...DEFAULT_ABOUT_PAGE_SETTINGS,
      favoriteColoringBookIds: ["repeat", "repeat", ""],
    })).toBe(true);
    expect(hasDuplicateAboutProductIds({
      ...DEFAULT_ABOUT_PAGE_SETTINGS,
      favoriteColoringBookIds: ["repeat", "", ""],
      favoritePictureBookIds: ["", "repeat", ""],
    })).toBe(true);
    expect(hasDuplicateAboutProductIds({
      ...DEFAULT_ABOUT_PAGE_SETTINGS,
      favoriteColoringBookIds: ["coloring-1", "coloring-2", "coloring-3"],
      favoritePictureBookIds: ["picture-1", "picture-2", "picture-3"],
    })).toBe(false);
  });

  it.each([
    ["uppercase casing", "AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA"],
    ["braces and omitted hyphens", "{AAAAAAAA111141118111AAAAAAAAAAAA}"],
    ["alternative hyphen placement", "AAAAAAAA11114111-8111-AAAAAAAAAAAA"],
  ])("treats PostgreSQL UUID input variants with %s as the same selected product", (_variant, duplicateId) => {
    expect(hasDuplicateAboutProductIds({
      ...DEFAULT_ABOUT_PAGE_SETTINGS,
      favoriteColoringBookIds: ["aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", duplicateId, ""],
    })).toBe(true);
  });
});
