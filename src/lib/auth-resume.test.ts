import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const resumeMocks = vi.hoisted(() => ({
  getProductBySlugForRequest: vi.fn(),
  redeemPremiumCodeForRequest: vi.fn(),
}));

vi.mock("./products-request", () => ({
  getProductBySlugForRequest: resumeMocks.getProductBySlugForRequest,
}));
vi.mock("./premium-request", () => ({
  redeemPremiumCodeForRequest: resumeMocks.redeemPremiumCodeForRequest,
}));

import {
  buildSupabaseAuthCallbackUrl,
  createAuthResumeIntent,
  getAuthResumeRedirect,
  redeemAuthResumeIntent,
  sanitizeInternalReturnTo,
} from "./auth-resume";

describe("Supabase auth resume contract", () => {
  it("builds an app-owned callback URL without a premium code", () => {
    const callback = buildSupabaseAuthCallbackUrl("pl");
    const url = new URL(callback);

    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("locale")).toBe("pl");
    expect(url.searchParams.has("code")).toBe(false);
  });

  it("rejects external and protocol-relative targets", () => {
    expect(sanitizeInternalReturnTo("https://evil.example", "en")).toBe("/en/account");
    expect(sanitizeInternalReturnTo("//evil.example/path", "en")).toBe("/en/account");
  });

  it("rejects wrong-locale targets and removes sensitive query values", () => {
    expect(sanitizeInternalReturnTo("/pl/products/moon?code=secret", "en")).toBe("/en/account");
    expect(sanitizeInternalReturnTo("/en/products/moon?code=secret&view=library", "en")).toBe(
      "/en/products/moon?view=library",
    );
  });

  it("preserves product intent in the HTTP-only contract, not the callback URL", () => {
    const intent = createAuthResumeIntent({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book?code=LOMI-BOOK-2026",
      code: "LOMI-BOOK-2026",
      now: Date.now(),
    });

    expect(intent.productSlug).toBe("moon-garden-coloring-book");
    expect(intent.code).toBe("LOMI-BOOK-2026");
    expect(intent.returnTo).toBe("/en/products/moon-garden-coloring-book");
    expect(getAuthResumeRedirect(intent)).not.toContain("LOMI-BOOK-2026");
  });

  it("derives the product slug from a sanitized product return path", () => {
    const intent = createAuthResumeIntent({
      locale: "en",
      returnTo: "/en/products/moon-garden-coloring-book?code=LOMI-BOOK-2026",
      code: "LOMI-BOOK-2026",
    });

    expect(intent.productSlug).toBe("moon-garden-coloring-book");
  });

  it("redeems the preserved code server-side after confirmation", async () => {
    resumeMocks.getProductBySlugForRequest.mockResolvedValue({ id: "product-id" });
    resumeMocks.redeemPremiumCodeForRequest.mockResolvedValue({ ok: true, status: "success" });

    await redeemAuthResumeIntent({
      productSlug: "moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    });

    expect(resumeMocks.redeemPremiumCodeForRequest).toHaveBeenCalledWith({
      productSlug: "moon-garden-coloring-book",
      productId: "product-id",
      code: "LOMI-BOOK-2026",
    });
  });
});
