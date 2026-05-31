import { describe, expect, it } from "vitest";

import { createDemoSession } from "./auth";
import { getLocalizedProductView } from "./products";
import {
  canDownloadPremiumAsset,
  createSignedDownloadUrl,
  normalizePremiumCode,
  validatePremiumCode,
} from "./premium";

describe("premium access behavior", () => {
  it("normalizes friendly premium code input", () => {
    expect(normalizePremiumCode(" lomi book 2026 ")).toBe("LOMIBOOK2026");
    expect(normalizePremiumCode("lomi-book-2026")).toBe("LOMI-BOOK-2026");
  });

  it("accepts valid product codes case-insensitively", () => {
    const result = validatePremiumCode({
      productSlug: "moon-garden-coloring-book",
      code: "lomi-book-2026",
    });

    expect(result).toMatchObject({
      ok: true,
      productId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("rejects invalid premium code without creating access", () => {
    expect(
      validatePremiumCode({
        productSlug: "moon-garden-coloring-book",
        code: "NOT-REAL",
      }),
    ).toEqual({ ok: false, reason: "invalid_code" });
  });

  it("denies guests, unverified users, and locked users before signed URL creation", () => {
    const product = getLocalizedProductView("moon-garden-coloring-book", "en")!;
    const asset = product.premiumAssets[0];
    const locked = createDemoSession({
      email: "locked@lamilialomi.test",
      emailVerified: true,
      unlockedProductIds: [],
    });
    const unverified = createDemoSession({
      email: "unverified@lamilialomi.test",
      emailVerified: false,
      unlockedProductIds: [product.id],
    });

    expect(canDownloadPremiumAsset({ asset, session: null })).toEqual({
      allowed: false,
      reason: "guest",
    });
    expect(canDownloadPremiumAsset({ asset, session: unverified })).toEqual({
      allowed: false,
      reason: "unverified",
    });
    expect(canDownloadPremiumAsset({ asset, session: locked })).toEqual({
      allowed: false,
      reason: "locked",
    });
  });

  it("creates signed URL only for verified users with matching unlock", () => {
    const product = getLocalizedProductView("moon-garden-coloring-book", "en")!;
    const asset = product.premiumAssets[0];
    const session = createDemoSession({
      email: "demo@lamilialomi.test",
      emailVerified: true,
      unlockedProductIds: [product.id],
    });

    const signedUrl = createSignedDownloadUrl({
      asset,
      session,
      now: new Date("2026-05-31T10:00:00.000Z"),
    });

    expect(signedUrl.ok).toBe(true);
    expect(signedUrl.ok && signedUrl.url).toContain("token=");
  });
});
