import { describe, expect, it } from "vitest";

import { getCommunityAvatarPresentation } from "./avatar";

describe("generated community avatar", () => {
  it("is deterministic and derived only from username and generated seed", () => {
    expect(getCommunityAvatarPresentation("@garden_user", "seed-1"))
      .toEqual(getCommunityAvatarPresentation("@garden_user", "seed-1"));
    expect(getCommunityAvatarPresentation("@garden_user", "seed-1").initials).toBe("GU");
    expect(["var(--color-sage)", "var(--color-blush)", "var(--color-bg-alt)", "#e7dce7"])
      .toContain(getCommunityAvatarPresentation("@garden_user", "seed-2").color);
  });

  it("uses safe fallback initials", () => {
    expect(getCommunityAvatarPresentation("@__", "seed").initials).toBe("__");
  });
});
