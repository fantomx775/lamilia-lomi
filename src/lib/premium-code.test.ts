import { describe, expect, it } from "vitest";

import {
  normalizePremiumCode,
  normalizePremiumCodeForRequest,
  validatePremiumCodeEntries,
} from "./premium-code";

describe("premium code validation", () => {
  it("uses the same normalization for spaces, case, and dash variants", () => {
    expect(normalizePremiumCode(" lomi – book 2026 ")).toBe("LOMI-BOOK2026");
    expect(normalizePremiumCodeForRequest(" lomi – book 2026 ")).toBe("LOMI-BOOK2026");
  });

  it("rejects oversized request values instead of truncating a possible code", () => {
    expect(normalizePremiumCodeForRequest("x".repeat(129))).toBe("");
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
