import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeAvatarImage } from "./avatar-image";
import { AVATAR_EDGE, AVATAR_MAX_BYTES } from "./avatar-contract";

describe("avatar image security boundary", () => {
  it("decodes, crops and reencodes while dropping private camera metadata", async () => {
    const input = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#8a7b6c" } })
      .jpeg().withExif({ IFD0: { Artist: "Private identity" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "52/1 0/1 0/1" } }).toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const output = await normalizeAvatarImage(input, "image/jpeg");
    const metadata = await sharp(output).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: AVATAR_EDGE, height: AVATAR_EDGE });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(output.includes(Buffer.from("Private identity"))).toBe(false);
  });

  it("rejects images beyond the decoded pixel limit", async () => {
    const oversized = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "white" } }).png().toBuffer();
    await expect(normalizeAvatarImage(oversized, "image/png")).rejects.toMatchObject({ name: "CommunityValidationError" });
  });

  it("rejects unsupported formats, false MIME, corrupt bytes and oversized files", async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "white" } }).png().toBuffer();
    for (const [bytes, mime] of [[png, "image/jpeg"], [png, "image/svg+xml"], [Buffer.from("invalid"), "image/png"], [new Uint8Array(AVATAR_MAX_BYTES + 1), "image/png"]] as const) {
      await expect(normalizeAvatarImage(bytes, mime)).rejects.toMatchObject({ name: "CommunityValidationError" });
    }
  });
});
