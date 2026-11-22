import { describe, expect, it } from "vitest";
import { catalogGridClass, safeCatalogReturn } from "./catalog-navigation";

describe("catalog result context", () => {
  it("preserves search, all filters and a safe result-card anchor", () => {
    expect(safeCatalogReturn("/en/products?q=flowers&audience=kids&type=coloring-book&category=nature&tag=quiet&sort=az#catalog-product-book-1", "en")).toBe("/en/products?q=flowers&audience=kids&type=coloring-book&category=nature&tag=quiet&sort=az#catalog-product-book-1");
  });
  it.each([undefined, "https://evil.test/en/products", "//evil.test/en/products", "/en/products/other", "/en/products/../login", "/en/products%2f..%2flogin", "javascript:alert(1)", "/en/products\\evil.test"])("rejects foreign or non-catalog return %s", (value) => {
    expect(safeCatalogReturn(value, "en")).toBe("/en/products");
  });
  it("does not propagate secrets, arbitrary query targets or unvalidated fragments", () => {
    expect(safeCatalogReturn("/en/products?q=flowers&code=private&returnTo=https://evil.test#premium", "en")).toBe("/en/products?q=flowers");
  });
  it.each([3, 4, 5] as const)("shares the final responsive geometry for %s desktop columns", (columns) => {
    expect(catalogGridClass(columns)).toContain(`xl:grid-cols-${columns}`);
    expect(catalogGridClass(columns)).toContain("lg:grid-cols-3");
    expect(catalogGridClass(columns)).toContain("sm:grid-cols-2");
  });
});
