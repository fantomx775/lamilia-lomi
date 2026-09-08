import { describe, expect, it } from "vitest";

import { normalizePremiumCode, validatePremiumCodeEntries } from "./premium-code";

describe("premium code validation", () => {
  it("uses the same normalization for spaces, case, and dash variants", () => {
    expect(normalizePremiumCode(" lomi – book 2026 ")).toBe("LOMI-BOOK2026");
  });

  it("reports empty and duplicate rows without dropping them silently", () => {
    expect(validatePremiumCodeEntries([
      { code: "   " },
      { code: "LOMI-BOOK" },
      { code: "lomi – book" },
      { code: "removed", removed: true },
    ])).toEqual([
      { index: 0, reason: "required" },
      { index: 1, reason: "duplicate" },
      { index: 2, reason: "duplicate" },
    ]);
  });
});
