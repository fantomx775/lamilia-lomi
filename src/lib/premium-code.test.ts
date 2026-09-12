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

  it("accepts the limit and rejects oversized request values instead of truncating", () => {
    expect(normalizePremiumCodeForRequest("x".repeat(128))).toHaveLength(128);
    expect(normalizePremiumCodeForRequest("x".repeat(129))).toBe("");
    expect(validatePremiumCodeEntries([{ code: "x".repeat(128) }])).toEqual([]);
    expect(validatePremiumCodeEntries([{ code: "x".repeat(129) }])).toEqual([
      { index: 0, reason: "too_long" },
    ]);
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
