import { describe, expect, it } from "vitest";

import { getAdminDisplayName, getAdminLanguageCodes } from "./admin-list";

describe("admin list display helpers", () => {
  it("prefers English and falls back to another translation", () => {
    expect(
      getAdminDisplayName(
        [
          { locale: "pl", name: "Kolorowanki" },
          { locale: "en", name: "Coloring books" },
        ],
        "coloring-books",
      ),
    ).toBe("Coloring books");

    expect(getAdminDisplayName([{ locale: "pl", name: "Kolorowanki" }], "fallback")).toBe(
      "Kolorowanki",
    );
  });

  it("uses the slug when no translation has a display name", () => {
    expect(getAdminDisplayName([{ locale: "en", name: "   " }], "coloring-books")).toBe(
      "coloring-books",
    );
  });

  it("keeps language availability unique and in source order", () => {
    expect(
      getAdminLanguageCodes([
        { locale: "en" },
        { locale: "pl" },
        { locale: "en" },
      ]),
    ).toEqual(["en", "pl"]);
  });
});
