import { hasLocalMatch } from "next/dist/shared/lib/match-local-pattern";
import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("Next Image public-media boundary", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it.each([`/api/media/${id}?v=${id}`, `/api/category-media/${id}?v=${id}`, "/assets/covers/book.webp", "/uploads/book.webp"])
    ("permits optimization of the existing public route %s", (source) => {
      expect(hasLocalMatch(nextConfig.images?.localPatterns, source)).toBe(true);
    });

  it.each([`/api/community/artworks/${id}/media`, `/api/community/artworks/${id}/media?v=${id}`, "/api/admin/collection-image?path=private"])
    ("keeps private media outside the optimizer: %s", (source) => {
      expect(hasLocalMatch(nextConfig.images?.localPatterns, source)).toBe(false);
    });
});
