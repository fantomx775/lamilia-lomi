import { describe, expect, it } from "vitest";

import { communityArtworkDimensions, communityArtworkMediaSrcSet } from "./media-urls";

const id = "11111111-1111-4111-8111-111111111111";
const mediaUrl = `/api/community/artworks/${id}/media`;

describe("community artwork responsive media URLs", () => {
  it("labels each derivative with its actual width and removes duplicate candidates", () => {
    expect(communityArtworkMediaSrcSet(id, { width: 320, height: 240 }))
      .toBe(`${mediaUrl}?width=480 320w`);
    expect(communityArtworkMediaSrcSet(id, { width: 700, height: 900 }))
      .toBe(`${mediaUrl}?width=480 480w, ${mediaUrl}?width=960 700w`);
    expect(communityArtworkMediaSrcSet(id, { width: 2048, height: 2048 }))
      .toBe(`${mediaUrl}?width=480 480w, ${mediaUrl}?width=960 960w, ${mediaUrl}?width=2048 2048w`);
  });

  it("omits srcset when dimensions are missing or invalid, preserving the src fallback", () => {
    expect(communityArtworkMediaSrcSet(id)).toBeUndefined();
    expect(communityArtworkMediaSrcSet(id, null)).toBeUndefined();
    expect(communityArtworkMediaSrcSet(id, { width: 0, height: 240 })).toBeUndefined();
    expect(communityArtworkMediaSrcSet(id, { width: 2049, height: 240 })).toBeUndefined();
    expect(communityArtworkMediaSrcSet(id, { width: 480, height: 2049 })).toBeUndefined();
    expect(communityArtworkMediaSrcSet(id, { width: 1.5, height: 1 })).toBeUndefined();
  });

  it("accepts only bounded integer dimensions from the normalized image", () => {
    expect(communityArtworkDimensions(1536, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(communityArtworkDimensions("1536", 2048)).toBeNull();
    expect(communityArtworkDimensions(2048, 2048.5)).toBeNull();
    expect(communityArtworkDimensions(2049, 1)).toBeNull();
  });
});
