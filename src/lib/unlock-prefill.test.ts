import { describe, expect, it } from "vitest";

import { selectUnlockPrefillCode } from "./unlock-prefill";

describe("selectUnlockPrefillCode", () => {
  const resumeCode = "ACCOUNT-BOUND-CODE";

  it("prefers the code from the current QR intent for a signed-in Supabase user", () => {
    expect(
      selectUnlockPrefillCode({
        currentIntent: {
          locale: "en",
          productSlug: "moon-garden-coloring-book",
          code: "SCANNED-QR-CODE",
        },
        locale: "en",
        productSlug: "moon-garden-coloring-book",
        backendMode: "supabase",
        hasSupabaseUser: true,
        accountBoundResumeCode: resumeCode,
      }),
    ).toBe("SCANNED-QR-CODE");
  });

  it("uses an account-bound resume code when there is no current QR code", () => {
    expect(
      selectUnlockPrefillCode({
        currentIntent: null,
        locale: "en",
        productSlug: "moon-garden-coloring-book",
        backendMode: "supabase",
        hasSupabaseUser: true,
        accountBoundResumeCode: resumeCode,
      }),
    ).toBe(resumeCode);
  });

  it("does not let an intent for another product or locale override the account-bound resume", () => {
    for (const currentIntent of [
      {
        locale: "en",
        productSlug: "another-book",
        code: "OTHER-PRODUCT-CODE",
      },
      {
        locale: "pl",
        productSlug: "moon-garden-coloring-book",
        code: "OTHER-LOCALE-CODE",
      },
    ]) {
      expect(
        selectUnlockPrefillCode({
          currentIntent,
          locale: "en",
          productSlug: "moon-garden-coloring-book",
          backendMode: "supabase",
          hasSupabaseUser: true,
          accountBoundResumeCode: resumeCode,
        }),
      ).toBe(resumeCode);
    }
  });

  it("keeps matching guest QR prefill behavior", () => {
    expect(
      selectUnlockPrefillCode({
        currentIntent: {
          locale: "en",
          productSlug: "moon-garden-coloring-book",
          code: "SCANNED-QR-CODE",
        },
        locale: "en",
        productSlug: "moon-garden-coloring-book",
        backendMode: "local",
        hasSupabaseUser: false,
      }),
    ).toBe("SCANNED-QR-CODE");
  });
});
