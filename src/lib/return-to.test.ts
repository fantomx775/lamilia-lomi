import { describe, expect, it } from "vitest";

import {
  productSlugFromReturnTo,
  sanitizeReturnTo,
} from "./return-to";

describe("return target safety", () => {
  it("allows same-locale internal paths and preserves safe query state", () => {
    expect(sanitizeReturnTo("/en/products/moon-garden?step=verify", "en")).toBe(
      "/en/products/moon-garden?step=verify",
    );
    expect(productSlugFromReturnTo("/en/products/moon-garden", "en")).toBe(
      "moon-garden",
    );
    expect(sanitizeReturnTo("/en/products/moon-garden?code=secret&step=verify", "en")).toBe(
      "/en/products/moon-garden?step=verify",
    );
    expect(
      sanitizeReturnTo(
        "/en/products/moon-garden?token=secret&access_token=other&step=verify",
        "en",
      ),
    ).toBe("/en/products/moon-garden?step=verify");
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "%2F%2Fevil.example%2Fphish",
    "/pl/products/moon-garden",
    "\\\\evil.example\\phish",
    "/en/products/%5C%5Cevil.example",
    "/en/products/foo%2Fbar",
    "/en/products/moon-garden?returnTo=https%3A%2F%2Fevil.example%2Fphish",
  ])("rejects unsafe return target %s", (value) => {
    expect(sanitizeReturnTo(value, "en")).toBe("/en/library");
  });

  it("rejects nested external targets even when the outer locale is valid", () => {
    expect(sanitizeReturnTo("/en/products/moon-garden?returnTo=https%3A%2F%2Fevil.example", "en")).toBe(
      "/en/library",
    );
    expect(sanitizeReturnTo("/en/products/moon-garden?next=%2F%2Fevil.example", "en")).toBe(
      "/en/products/moon-garden?next=%2F%2Fevil.example",
    );
    expect(sanitizeReturnTo("/pl/products/moon-garden", "en")).toBe("/en/library");
  });

  it("only extracts canonical product slugs from a safe product path", () => {
    expect(productSlugFromReturnTo("/en/products/moon-garden", "en")).toBe(
      "moon-garden",
    );
    expect(productSlugFromReturnTo("/en/products/Moon-Garden", "en")).toBeUndefined();
    expect(productSlugFromReturnTo("/en/products/moon%2Fgarden", "en")).toBeUndefined();
  });
});
