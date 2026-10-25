import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeCommunityArtworkImage } from "./image";

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

describe("real community image decoder security boundaries", () => {
  it("normalizes EXIF orientation before stripping metadata", async () => {
    const input = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#ab8e70" } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(input).metadata()).orientation).toBe(6);
    const normalized = await normalizeCommunityArtworkImage(input, "image/jpeg");
    expect(normalized.width).toBe(60);
    expect(normalized.height).toBe(80);
    const metadata = await sharp(normalized.bytes).metadata();
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  it("bounds the output dimensions even for a compact large-dimension image", async () => {
    const input = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#809988" } }).png().toBuffer();
    expect(input.byteLength).toBeLessThan(4 * 1024 * 1024);
    const normalized = await normalizeCommunityArtworkImage(input, "image/png");
    expect(normalized.width).toBe(2048);
    expect(normalized.height).toBeLessThanOrEqual(1366);
  });

  it("rejects a valid-checksum pixel-bomb header without allocating its advertised canvas", async () => {
    const input = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#809988" } }).png().toBuffer();
    input.writeUInt32BE(100_000, 16);
    input.writeUInt32BE(100_000, 20);
    input.writeUInt32BE(crc32(input.subarray(12, 29)), 29);
    await expect(normalizeCommunityArtworkImage(input, "image/png")).rejects.toThrow();
  });

  it("rejects actual multi-frame WebP rather than treating the first frame as a standalone artwork", async () => {
    const raw = Buffer.concat([Buffer.alloc(20 * 20 * 3, 40), Buffer.alloc(20 * 20 * 3, 210)]);
    const input = await sharp(raw, { raw: { width: 20, height: 40, channels: 3, pageHeight: 20 } })
      .webp({ loop: 0, delay: [100, 100] }).toBuffer();
    expect((await sharp(input, { animated: true }).metadata()).pages).toBe(2);
    await expect(normalizeCommunityArtworkImage(input, "image/webp")).rejects.toThrow(/Animated|multi-page/);
  });

  it("rejects unsupported loaders hidden behind an allowed MIME and truncated PNG content", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>');
    await expect(normalizeCommunityArtworkImage(svg, "image/png")).rejects.toThrow();
    const input = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#809988" } }).png().toBuffer();
    await expect(normalizeCommunityArtworkImage(input.subarray(0, 36), "image/png")).rejects.toThrow();
  });
});
