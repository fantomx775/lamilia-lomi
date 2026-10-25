import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { normalizeCommunityArtworkImage } from "./image";

async function jpegWithPrivateMetadata() {
  return sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 180, g: 90, b: 70 } },
  }).withMetadata({
    exif: { IFD0: { Artist: "Private Name" }, IFD3: { GPSLatitude: "1/1 2/1 3/1", GPSLongitude: "4/1 5/1 6/1" } },
  }).jpeg().toBuffer();
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function withHugePngDimensions(png: Buffer, width: number, height: number) {
  const result = Buffer.from(png);
  result.writeUInt32BE(width, 16);
  result.writeUInt32BE(height, 20);
  result.writeUInt32BE(crc32(result.subarray(12, 29)), 29);
  return result;
}

describe("community artwork normalization", () => {
  it("decodes, resizes and strips metadata into WebP", async () => {
    const original = await jpegWithPrivateMetadata();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const normalized = await normalizeCommunityArtworkImage(original, "image/jpeg");
    const metadata = await sharp(normalized.bytes).metadata();

    expect(normalized.contentType).toBe("image/webp");
    expect(normalized.width).toBe(64);
    expect(normalized.height).toBe(48);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
    expect(normalized.originalSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(normalized.normalizedSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a declared MIME type that does not match decoded bytes", async () => {
    const original = await jpegWithPrivateMetadata();
    await expect(normalizeCommunityArtworkImage(original, "image/png")).rejects.toThrow(/does not match/);
  });

  it("rejects corrupt content, unsupported types and files larger than 4 MiB", async () => {
    await expect(normalizeCommunityArtworkImage(new Uint8Array([1, 2, 3]), "image/jpeg")).rejects.toThrow(/does not match its file type/);
    await expect(normalizeCommunityArtworkImage(new Uint8Array([1]), "image/svg+xml")).rejects.toThrow(/JPG, PNG, or WebP/);
    await expect(normalizeCommunityArtworkImage(new Uint8Array(4 * 1024 * 1024 + 1), "image/jpeg")).rejects.toThrow(/4 MiB/);
  });

  it("rejects animated images and declared pixel bombs before full decode", async () => {
    const first = await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).png().toBuffer();
    const second = await sharp({ create: { width: 4, height: 4, channels: 3, background: "blue" } }).png().toBuffer();
    const animated = await sharp([first, second], { join: { animated: true } }).webp({ delay: 100, loop: 0 }).toBuffer();
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBeGreaterThan(1);
    await expect(normalizeCommunityArtworkImage(animated, "image/webp")).rejects.toThrow(/Animated or multi-page/);

    const huge = withHugePngDimensions(first, 8_000, 8_000);
    await expect(normalizeCommunityArtworkImage(huge, "image/png")).rejects.toThrow(/too large to process/);
  });
});
