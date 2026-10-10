import { describe, expect, it } from "vitest";

import { readImageDimensionsFromBytes } from "./image-file-dimensions";

describe("image file dimensions", () => {
  it("reads PNG dimensions from its IHDR header", () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    bytes.set([0x00, 0x00, 0x03, 0x20, 0x00, 0x00, 0x03, 0x20], 16);

    expect(readImageDimensionsFromBytes(bytes)).toEqual({ width: 800, height: 800 });
  });

  it("reads JPEG frame dimensions and safely rejects truncated or unknown data", () => {
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x4c, 0x03, 0x52,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    ]);

    expect(readImageDimensionsFromBytes(bytes)).toEqual({ width: 850, height: 1100 });
    expect(readImageDimensionsFromBytes(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(readImageDimensionsFromBytes(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
