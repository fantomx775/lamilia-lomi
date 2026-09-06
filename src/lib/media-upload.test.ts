import { describe, expect, it } from "vitest";

import { MEDIA_UPLOAD_SPECS, filenameWithCollisionSuffix, mediaBucketForKind, validateMediaFile } from "./media-upload";

describe("media upload rules", () => {
  it("keeps each asset kind in its intended storage class", () => {
    expect(mediaBucketForKind("cover")).toBe("public-media");
    expect(mediaBucketForKind("video")).toBe("public-videos");
    expect(mediaBucketForKind("premium_download")).toBe("premium-files");
    expect(MEDIA_UPLOAD_SPECS.premium_download.multiple).toBe(true);
  });

  it("accepts supported files and rejects unsafe types or oversized files", () => {
    expect(validateMediaFile("cover", { name: "cover.jpg", size: 100, type: "image/jpeg" })).toEqual({ ok: true, contentType: "image/jpeg" });
    expect(validateMediaFile("public_download", { name: "guide.pdf", size: 100, type: "" })).toEqual({ ok: true, contentType: "application/pdf" });
    expect(validateMediaFile("premium_download", { name: "script.exe", size: 100, type: "application/x-msdownload" })).toMatchObject({ ok: false });
    expect(validateMediaFile("video", { name: "large.mp4", size: 51 * 1024 * 1024, type: "video/mp4" })).toMatchObject({ ok: false });
  });

  it("adds deterministic suffixes without losing the extension", () => {
    expect(filenameWithCollisionSuffix("my-awesome-book.pdf", 0)).toBe("my-awesome-book.pdf");
    expect(filenameWithCollisionSuffix("my-awesome-book.pdf", 1)).toBe("my-awesome-book_1.pdf");
    expect(filenameWithCollisionSuffix("cover", 2)).toBe("cover_2");
  });
});
