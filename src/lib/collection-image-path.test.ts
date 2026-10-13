import { describe, expect, it } from "vitest";

import { createCollectionImagePath, isSafeCollectionImagePath } from "./collection-image-path";

const collectionId = "11111111-1111-4111-8111-111111111111";
const imageId = "22222222-2222-4222-8222-222222222222";

describe("collection image paths", () => {
  it("normalizes the stored extension to the validated image content type", () => {
    const path = createCollectionImagePath(collectionId, imageId, "cover.jfif", "image/jpeg");

    expect(path).toBe(`collections/${collectionId}/image/${imageId}-cover.jpg`);
    expect(isSafeCollectionImagePath(path, collectionId)).toBe(true);
  });

  it("rejects unsupported image content types", () => {
    expect(() => createCollectionImagePath(collectionId, imageId, "cover.gif", "image/gif")).toThrow(
      "Invalid collection image content type.",
    );
  });
});
