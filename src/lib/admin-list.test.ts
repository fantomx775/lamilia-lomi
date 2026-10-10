import { describe, expect, it } from "vitest";

import { getAdminDisplayName } from "./admin-list";

describe("admin list display helpers", () => {
  it("uses English and otherwise falls back to the stable slug", () => {
    expect(
      getAdminDisplayName(
        [
          { locale: "pl", name: "Kolorowanki" },
          { locale: "en", name: "Coloring books" },
        ],
        "coloring-books",
      ),
    ).toBe("Coloring books");

    expect(getAdminDisplayName([{ locale: "pl", name: "Kolorowanki" }], "fallback")).toBe("fallback");
  });

  it("uses the slug when no translation has a display name", () => {
    expect(getAdminDisplayName([{ locale: "en", name: "   " }], "coloring-books")).toBe(
      "coloring-books",
    );
  });

});
