import { describe, expect, it } from "vitest";

import { imageRatioRequirement, validateImageDimensions } from "./image-ratios";

describe("image ratio requirements", () => {
  it("accepts square category images at a useful display size", () => {
    expect(validateImageDimensions("category", { width: 800, height: 800 })).toEqual({ ok: true });
    expect(imageRatioRequirement("category")).toContain("1:1");
  });

  it("accepts portrait covers close to 8.5:11 without cropping them", () => {
    expect(validateImageDimensions("cover", { width: 850, height: 1100 })).toEqual({ ok: true });
    expect(validateImageDimensions("cover", { width: 600, height: 776 })).toEqual({ ok: true });
    expect(imageRatioRequirement("cover")).toContain("8.5:11");
  });

  it("supports square and portrait gallery assets and rejects unsupported ratios", () => {
    expect(validateImageDimensions("gallery", { width: 900, height: 900 })).toEqual({ ok: true });
    expect(validateImageDimensions("gallery", { width: 850, height: 1100 })).toEqual({ ok: true });
    expect(validateImageDimensions("gallery", { width: 900, height: 1200 })).toMatchObject({ ok: false });
  });

  it("returns a clear message for unusable dimensions and too-small images", () => {
    expect(validateImageDimensions("cover", { width: 0, height: 0 })).toMatchObject({
      ok: false,
      error: expect.stringContaining("wymiarów obrazu"),
    });
    expect(validateImageDimensions("category", { width: 300, height: 300 })).toMatchObject({
      ok: false,
      error: expect.stringContaining("za mały"),
    });
  });
});
