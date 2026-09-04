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
    expect(sanitizeReturnTo("/pl/products/moon-garden?code=secret&step=verify", "pl")).toBe(
      "/pl/products/moon-garden?step=verify",
    );
    expect(
      sanitizeReturnTo(
        "/pl/products/moon-garden?token=secret&access_token=other&step=verify",
        "pl",
      ),
    ).toBe("/pl/products/moon-garden?step=verify");
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "%2F%2Fevil.example%2Fphish",
    "/en/products/moon-garden",
    "\\\\evil.example\\phish",
    "/pl/products/moon-garden?returnTo=https%3A%2F%2Fevil.example%2Fphish",
  ])("rejects unsafe return target %s", (value) => {
    expect(sanitizeReturnTo(value, "pl")).toBe("/pl/library");
  });

  it("rejects nested external targets even when the outer locale is valid", () => {
    expect(sanitizeReturnTo("/pl/products/moon-garden?returnTo=https%3A%2F%2Fevil.example", "pl")).toBe(
      "/pl/library",
    );
    expect(sanitizeReturnTo("/pl/products/moon-garden?next=%2F%2Fevil.example", "pl")).toBe(
      "/pl/products/moon-garden?next=%2F%2Fevil.example",
    );
    expect(sanitizeReturnTo("/en/products/moon-garden", "pl")).toBe("/pl/library");
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
