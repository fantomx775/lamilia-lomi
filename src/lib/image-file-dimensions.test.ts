import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { readImageDimensionsFromBytes } from "./image-file-dimensions";

describe("image file dimensions", () => {
  it("fully decodes supported raster formats and reads their dimensions", async () => {
    const createImage = (format: "png" | "jpeg" | "webp") => sharp({
      create: { width: 800, height: 800, channels: 4, background: { r: 50, g: 60, b: 70, alpha: 1 } },
    })[format]().toBuffer();

    await expect(readImageDimensionsFromBytes(new Uint8Array(await createImage("png"))))
      .resolves.toEqual({ width: 800, height: 800, contentType: "image/png" });
    await expect(readImageDimensionsFromBytes(new Uint8Array(await createImage("jpeg"))))
      .resolves.toEqual({ width: 800, height: 800, contentType: "image/jpeg" });
    await expect(readImageDimensionsFromBytes(new Uint8Array(await createImage("webp"))))
      .resolves.toEqual({ width: 800, height: 800, contentType: "image/webp" });
  });

  it("rejects a PNG signature and IHDR without image data", async () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    bytes.set([0x00, 0x00, 0x03, 0x20, 0x00, 0x00, 0x03, 0x20], 16);

    await expect(readImageDimensionsFromBytes(bytes)).resolves.toBeNull();
    await expect(readImageDimensionsFromBytes(new Uint8Array([0xff, 0xd8, 0xff]))).resolves.toBeNull();
    await expect(readImageDimensionsFromBytes(new Uint8Array([1, 2, 3]))).resolves.toBeNull();
  });
});
