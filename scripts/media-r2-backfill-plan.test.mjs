import { describe, expect, it } from "vitest";

import { planProductImageBackfill } from "./media-r2-backfill-plan.mjs";

function imageRow(overrides = {}) {
  return {
    id: "asset-1",
    product_id: "product-1",
    kind: "gallery",
    bucket: "public-media",
    path: "products/product-1/gallery/asset-1.jpg",
    storage_provider: "supabase",
    is_active: true,
    is_public: true,
    products: { status: "published" },
    ...overrides,
  };
}

describe("planProductImageBackfill", () => {
  it.each(["published", "draft", "archived"])(
    "keeps a %s product image private unless it is currently publicly eligible",
    (status) => {
      const plan = planProductImageBackfill(imageRow({ products: { status } }));

      expect(plan.disposition).toBe("migrate");
      expect(plan.publicEligible).toBe(status === "published");
      expect(plan.targetProvider).toBe(status === "published" ? "r2_public" : "r2_private");
    },
  );

  it("keeps inactive published images private", () => {
    expect(planProductImageBackfill(imageRow({ is_active: false }))).toMatchObject({
      disposition: "migrate",
      publicEligible: false,
      targetProvider: "r2_private",
    });
  });

  it.each(["r2_private", "r2_public_pending", "r2_public"])(
    "supports a retry when an eligible asset already uses %s",
    (storage_provider) => {
      expect(planProductImageBackfill(imageRow({ storage_provider }))).toMatchObject({
        disposition: "migrate",
        publicEligible: true,
        targetProvider: "r2_public",
      });
    },
  );

  it.each(["r2_private", "r2_public_pending", "r2_public"])(
    "plans a resumed %s asset as private after its product is archived",
    (storage_provider) => {
      expect(planProductImageBackfill(imageRow({
        storage_provider,
        products: { status: "archived" },
      }))).toMatchObject({
        disposition: "migrate",
        publicEligible: false,
        targetProvider: "r2_private",
      });
    },
  );

  it.each([
    ["non-public legacy rows", { is_public: false }, "legacy_private_visibility_not_supported_by_r2_constraint"],
    ["unfinished revocations", { storage_provider: "r2_public_revoking" }, "revocation_in_progress"],
    ["invalid paths", { path: "products/other/gallery/asset-1.jpg" }, "invalid_product_image_path"],
    ["dot-segment paths", { path: "products/product-1/gallery/.." }, "invalid_product_image_path"],
    ["unsupported buckets", { bucket: "premium-files" }, "unsupported_bucket"],
  ])("reports %s without making them public", (_description, overrides, reason) => {
    expect(planProductImageBackfill(imageRow(overrides))).toMatchObject({
      disposition: "skip",
      publicEligible: false,
      reason,
    });
  });
});
