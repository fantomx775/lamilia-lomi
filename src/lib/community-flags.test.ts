import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getCommunityFlags, isCommunityFeatureEnabled } from "./community-flags";

describe("Coloring Club server-side feature flags", () => {
  it("fails closed when variables are missing or not exactly true", () => {
    expect(getCommunityFlags({})).toEqual({ publicEnabled: false, uploadsEnabled: false });
    for (const value of ["", "false", "TRUE", "1", " true "]) {
      expect(isCommunityFeatureEnabled("COLORING_CLUB_PUBLIC_ENABLED", {
        COLORING_CLUB_PUBLIC_ENABLED: value,
      })).toBe(false);
    }
  });

  it("enables each capability only with its explicit true value", () => {
    expect(getCommunityFlags({
      COLORING_CLUB_PUBLIC_ENABLED: "true",
      COLORING_CLUB_UPLOADS_ENABLED: "true",
    })).toEqual({ publicEnabled: true, uploadsEnabled: true });
    expect(getCommunityFlags({ COLORING_CLUB_PUBLIC_ENABLED: "true" })).toEqual({
      publicEnabled: true,
      uploadsEnabled: false,
    });
  });
});
