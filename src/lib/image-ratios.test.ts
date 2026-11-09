import { describe, expect, it } from "vitest";

import { getGalleryTrimRatio, imageRatioRequirement, validateImageDimensions } from "./image-ratios";

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

  it.each([[600, 600], [600, 900], [600, 750]])("accepts a cover at %s by %s pixels", (width, height) => {
    expect(validateImageDimensions("cover", { width, height })).toEqual({ ok: true });
    expect(validateImageDimensions("cover", { width, height: height - 1 })).toMatchObject({
      ok: false,
      error: expect.stringContaining("za mały"),
    });
  });

  it("supports square and portrait gallery assets and rejects unsupported ratios", () => {
    expect(validateImageDimensions("gallery", { width: 900, height: 900 })).toEqual({ ok: true });
    expect(validateImageDimensions("gallery", { width: 850, height: 1100 })).toEqual({ ok: true });
    expect(validateImageDimensions("gallery", { width: 900, height: 1200 })).toMatchObject({ ok: false });
  });

  it.each([
    [8.5, 11, 8.625, 11.25, 8.75, 11.25],
    [8.5, 8.5, 8.625, 8.75, 8.75, 8.75],
    [6, 9, 6.125, 9.25, 6.25, 9.25],
    [8, 10, 8.125, 10.25, 8.25, 10.25],
  ])("accepts %s by %s pages with either bleed or no bleed", (trimWidth, trimHeight, kdpWidth, kdpHeight, bleedWidth, bleedHeight) => {
    for (const [width, height] of [[trimWidth, trimHeight], [kdpWidth, kdpHeight], [bleedWidth, bleedHeight]]) {
      const dimensions = { width: width * 200, height: height * 200 };
      expect(validateImageDimensions("gallery", dimensions)).toEqual({ ok: true });
      expect(getGalleryTrimRatio(dimensions)).toBe(trimWidth / trimHeight);
    }
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
