import { describe, expect, it } from "vitest";

import {
  productSlugFromReturnTo,
  sanitizeReturnTo,
  switchLocalePath,
} from "./return-to";

describe("return target safety", () => {
  it("allows same-locale internal paths and preserves safe query state", () => {
    expect(sanitizeReturnTo("/pl/products/moon-garden?step=verify", "pl")).toBe(
      "/pl/products/moon-garden?step=verify",
    );
    expect(productSlugFromReturnTo("/pl/products/moon-garden", "pl")).toBe(
      "moon-garden",
    );
    expect(
      productSlugFromReturnTo("/pl/products/moon-garden?step=verify", "pl"),
    ).toBe("moon-garden");
    expect(sanitizeReturnTo("/pl/products/moon-garden?code=secret&step=verify", "pl")).toBe(
      "/pl/products/moon-garden?step=verify",
    );
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "/en/products/moon-garden",
    "\\\\evil.example\\phish",
  ])("rejects unsafe return target %s", (value) => {
    expect(sanitizeReturnTo(value, "pl")).toBe("/pl/library");
  });

  it("switches only an allowlisted locale prefix", () => {
    expect(
      switchLocalePath("/en/products/moon-garden?step=verify", "en", "de"),
    ).toBe("/de/products/moon-garden?step=verify");
    expect(switchLocalePath("https://evil.example/phish", "en", "de")).toBe(
      "/de/library",
    );
    expect(switchLocalePath("/admin/products", "en", "de")).toBe(
      "/admin/products",
    );
  });
});
