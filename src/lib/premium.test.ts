import { describe, expect, it } from "vitest";

import { createDemoSession } from "./auth";
import { getLocalizedProductView } from "./products";
import {
  applyProductUnlock,
  canDownloadPremiumAsset,
  createSignedDownloadUrl,
  normalizePremiumCode,
  validatePremiumCode,
  verifySignedDownloadUrl,
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

  it("rejects inactive and wrong-product codes without creating access", () => {
    expect(
      validatePremiumCode({
        productSlug: "mindful-mandalas-for-adults",
        code: "lomi-calm-offline-2026",
      }),
    ).toEqual({ ok: false, reason: "inactive_code" });
    expect(
      validatePremiumCode({
        productSlug: "moon-garden-coloring-book",
        code: "LOMI-CALM-2026",
      }),
    ).toEqual({ ok: false, reason: "invalid_code" });
  });

  it("makes an existing unlock a positive idempotent result", () => {
    const session = createDemoSession({
      email: "reader@example.com",
      emailVerified: true,
      unlockedProductIds: [],
    });
    const first = applyProductUnlock(session, "product-a");
    const second = applyProductUnlock(
      { unlockedProductIds: first.unlockedProductIds },
      "product-a",
    );

    expect(first).toEqual({ alreadyUnlocked: false, unlockedProductIds: ["product-a"] });
    expect(second).toEqual({ alreadyUnlocked: true, unlockedProductIds: ["product-a"] });
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
    const owner = createDemoSession({
      email: "owner@example.com",
      emailVerified: true,
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

    expect(
      canDownloadPremiumAsset({
        asset: {
          ...asset,
          id: "asset-product-b",
          productId: "22222222-2222-4222-8222-222222222222",
        },
        session: owner,
      }),
    ).toEqual({ allowed: false, reason: "locked" });
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
      product: { id: product.id, status: product.status },
      session,
      now: new Date("2026-05-31T10:00:00.000Z"),
    });

    expect(signedUrl.ok).toBe(true);
    expect(signedUrl.ok && signedUrl.url).toContain("token=");
    expect(signedUrl.ok && signedUrl.url).toContain("expires=");
    expect(signedUrl.ok && signedUrl.url).not.toContain("/demo-premium/");

    if (signedUrl.ok) {
      const signed = new URL(signedUrl.url, "http://localhost:3000");
      expect(
        verifySignedDownloadUrl({
          asset,
          product: { id: product.id, status: product.status },
          session,
          token: signed.searchParams.get("token"),
          expires: signed.searchParams.get("expires"),
          now: new Date("2026-05-31T10:05:00.000Z"),
        }).ok,
      ).toBe(true);
      expect(
        verifySignedDownloadUrl({
          asset,
          product: { id: product.id, status: product.status },
          session,
          token: "forged",
          expires: signed.searchParams.get("expires"),
          now: new Date("2026-05-31T10:05:00.000Z"),
        }),
      ).toMatchObject({ ok: false, decision: { reason: "invalid_token" } });
      expect(
        verifySignedDownloadUrl({
          asset,
          product: { id: product.id, status: product.status },
          session,
          token: null,
          expires: null,
          now: new Date("2026-05-31T10:05:00.000Z"),
        }),
      ).toMatchObject({ ok: false, decision: { reason: "invalid_token" } });
      expect(
        verifySignedDownloadUrl({
          asset,
          product: { id: product.id, status: "archived" },
          session,
          token: signed.searchParams.get("token"),
          expires: signed.searchParams.get("expires"),
          now: new Date("2026-05-31T10:05:00.000Z"),
        }),
      ).toMatchObject({ ok: false, decision: { reason: "wrong_asset" } });
    }
  });
});
