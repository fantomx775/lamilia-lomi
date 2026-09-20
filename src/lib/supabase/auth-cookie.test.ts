import { describe, expect, it } from "vitest";

import { hasSupabaseAuthCookie } from "./auth-cookie";

describe("Supabase auth cookie detection", () => {
  it("recognizes the default and chunked SSR session cookie names", () => {
    expect(hasSupabaseAuthCookie([{ name: "sb-projectref-auth-token" }])).toBe(true);
    expect(hasSupabaseAuthCookie([{ name: "sb-projectref-auth-token.0" }])).toBe(true);
  });

  it("ignores locale, consent, and unrelated Supabase cookies", () => {
    expect(
      hasSupabaseAuthCookie([
        { name: "ll_locale" },
        { name: "ll_cookie_consent" },
        { name: "sb-projectref-auth-token-code-verifier" },
      ]),
    ).toBe(false);
  });
});
