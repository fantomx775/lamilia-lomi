import { describe, expect, it } from "vitest";

import { isUnlocalizedAuthPath, shouldBypassLocaleRouting } from "./proxy-paths";

describe("proxy paths", () => {
  it("keeps the Supabase callback on its unlocalized route", () => {
    expect(isUnlocalizedAuthPath("/auth/callback")).toBe(true);
    expect(shouldBypassLocaleRouting("/auth/callback")).toBe(true);
    expect(shouldBypassLocaleRouting("/en/auth/callback")).toBe(false);
  });
});
