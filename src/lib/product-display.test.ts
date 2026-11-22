import { describe, expect, it } from "vitest";
import { productTypeLabel, publicImageAlt } from "./product-display";

describe("public book labels", () => {
  it("humanizes taxonomy without inventing categories", () => {
    expect(productTypeLabel("picture-book")).toBe("Picture Book");
    expect(productTypeLabel("coloring-book")).toBe("Coloring Book");
  });
  it("replaces upload filenames while retaining meaningful supplied descriptions", () => {
    for (const title of ["L1 (3).png", "Cinderella720p.mp4", "folder/cover.webp", undefined]) {
      expect(publicImageAlt(title, "Inside the book")).toBe("Inside the book");
    }
    expect(publicImageAlt("A garden of stars", "Page preview")).toBe("A garden of stars");
  });
});
