import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const resumeMocks = vi.hoisted(() => ({
  cookieValue: undefined as string | undefined,
  getProductBySlugForRequest: vi.fn(),
  redeemPremiumCodeForRequest: vi.fn(),
}));

vi.mock("./products-request", () => ({
  getProductBySlugForRequest: resumeMocks.getProductBySlugForRequest,
}));
vi.mock("./premium-request", () => ({
  redeemPremiumCodeForRequest: resumeMocks.redeemPremiumCodeForRequest,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => resumeMocks.cookieValue ? { value: resumeMocks.cookieValue } : undefined,
    set: (_name: string, value: string) => { resumeMocks.cookieValue = value; },
    delete: () => { resumeMocks.cookieValue = undefined; },
  }),
}));

import {
  authResumeIntentMatchesEmail,
  authResumeIntentMatchesUser,
  authResumeMaxAgeSeconds,
  buildSupabaseAuthCallbackUrl,
  clearAuthResumeIntent,
  createAuthResumeIntent,
  decodeAuthResumeCallbackToken,
  getAccountBoundResumeCode,
  getAuthResumeRedirect,
  readAuthResumeIntent,
  redeemAuthResumeIntent,
  sanitizeInternalReturnTo,
  setAuthResumeIntent,
} from "./auth-resume";

describe("Supabase auth resume contract", () => {
  it("builds an app-owned callback URL without a premium code", () => {
    const callback = buildSupabaseAuthCallbackUrl("pl");
    const url = new URL(callback);

    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("locale")).toBe("pl");
    expect(url.searchParams.has("code")).toBe(false);
  });

  it("carries only a sanitized return target through the email callback", () => {
    const callback = new URL(
      buildSupabaseAuthCallbackUrl("en", "/en/products/moon-garden-coloring-book?code=secret"),
    );

    expect(callback.searchParams.get("returnTo")).toBe("/en/products/moon-garden-coloring-book");
    expect(callback.toString()).not.toContain("secret");
    expect(
      new URL(buildSupabaseAuthCallbackUrl("en", "https://evil.example")).searchParams.has("returnTo"),
    ).toBe(false);
  });

  it("encrypts cross-device resume state without exposing the premium code", () => {
    const intent = createAuthResumeIntent({
      locale: "en",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      email: "reader@example.com",
    });
    const callback = new URL(
      buildSupabaseAuthCallbackUrl("en", intent.returnTo, intent),
    );
    const token = callback.searchParams.get("resume");

    expect(token).toBeTruthy();
    expect(callback.searchParams.has("code")).toBe(false);
    expect(callback.toString()).not.toContain("LOMI-BOOK-2026");
    expect(decodeAuthResumeCallbackToken(token)).toMatchObject({
      returnTo: intent.returnTo,
      code: "LOMI-BOOK-2026",
      emailHash: intent.emailHash,
    });

    const [version, iv, tag, ciphertext] = String(token).split(".");
    const changedIv = `${iv[0] === "A" ? "B" : "A"}${iv.slice(1)}`;
    expect(decodeAuthResumeCallbackToken(`${version}.${changedIv}.${tag}.${ciphertext}`)).toBeNull();
  });

  it("expires encrypted callback resume state with the verification link window", () => {
    const now = new Date("2026-10-08T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const intent = createAuthResumeIntent({
        locale: "en",
        returnTo: "/en/account",
        email: "reader@example.com",
      });
      const callback = new URL(buildSupabaseAuthCallbackUrl("en", intent.returnTo, intent));
      const token = callback.searchParams.get("resume");
      vi.setSystemTime(new Date(now.getTime() + authResumeMaxAgeSeconds * 1000 + 1));

      expect(decodeAuthResumeCallbackToken(token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

  it("binds an intent to the expected account without storing the email address", () => {
    const intent = createAuthResumeIntent({
      locale: "en",
      returnTo: "/en/account",
      email: " Reader@Example.com ",
      userId: "user-123",
    });

    expect(intent.userId).toBe("user-123");
    expect(intent.emailHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(intent)).not.toContain("Reader@Example.com");
    expect(authResumeIntentMatchesUser(intent, { id: "user-123", email: "reader@example.com" })).toBe(true);
    expect(authResumeIntentMatchesUser(intent, { id: "other-user", email: "reader@example.com" })).toBe(false);
    expect(authResumeIntentMatchesUser(intent, { id: "user-123", email: "other@example.com" })).toBe(false);
    expect(authResumeIntentMatchesUser({ userId: undefined, emailHash: undefined }, { id: "user-123" })).toBe(false);
  });

  it("only returns a saved code to the matching account and product", () => {
    const intent = createAuthResumeIntent({
      locale: "en",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
      email: "reader@example.com",
      userId: "user-123",
    });

    expect(
      getAccountBoundResumeCode(
        intent,
        { id: "user-123", email: "reader@example.com" },
        "en",
        "moon-garden-coloring-book",
      ),
    ).toBe("LOMI-BOOK-2026");
    expect(
      getAccountBoundResumeCode(
        intent,
        { id: "other-user", email: "other@example.com" },
        "en",
        "moon-garden-coloring-book",
      ),
    ).toBeUndefined();
    expect(
      getAccountBoundResumeCode(
        intent,
        { id: "user-123", email: "reader@example.com" },
        "pl",
        "moon-garden-coloring-book",
      ),
    ).toBeUndefined();
    expect(
      getAccountBoundResumeCode(
        intent,
        { id: "user-123", email: "reader@example.com" },
        "en",
        "another-product",
      ),
    ).toBeUndefined();
    expect(
      getAccountBoundResumeCode(
        intent,
        null,
        "en",
        "moon-garden-coloring-book",
      ),
    ).toBeUndefined();
  });

  it("matches a signed resume identity to an email without storing the email", () => {
    const intent = createAuthResumeIntent({
      locale: "en",
      returnTo: "/en/account",
      email: "Reader@Example.com",
    });

    expect(authResumeIntentMatchesEmail(intent, "reader@example.com")).toBe(true);
    expect(authResumeIntentMatchesEmail(intent, "other@example.com")).toBe(false);
    expect(authResumeIntentMatchesEmail({ emailHash: undefined }, "reader@example.com")).toBe(false);
  });

  it("signs the pending resume cookie and rejects tampering", async () => {
    resumeMocks.cookieValue = undefined;
    await setAuthResumeIntent({
      locale: "en",
      returnTo: "/en/account",
      email: "reader@example.com",
    });

    const signedCookie = String(resumeMocks.cookieValue);
    expect(signedCookie).toContain(".");
    await expect(readAuthResumeIntent()).resolves.toMatchObject({
      returnTo: "/en/account",
      emailHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const [payload, signature] = signedCookie.split(".");
    resumeMocks.cookieValue = `${payload[0] === "A" ? "B" : "A"}${payload.slice(1)}.${signature}`;
    await expect(readAuthResumeIntent()).resolves.toBeNull();
    await clearAuthResumeIntent();
  });

  it("expires the resume intent with the verification link window", async () => {
    const now = new Date("2026-10-08T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    resumeMocks.cookieValue = undefined;

    try {
      await setAuthResumeIntent({
        locale: "en",
        returnTo: "/en/account",
        email: "reader@example.com",
      });
      vi.setSystemTime(new Date(now.getTime() + authResumeMaxAgeSeconds * 1000 + 1));

      await expect(readAuthResumeIntent()).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
      resumeMocks.cookieValue = undefined;
    }
  });

  it("does not carry an explicit product into a non-product return target", () => {
    const intent = createAuthResumeIntent({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/account",
      code: "LOMI-BOOK-2026",
    });

    expect(intent.productSlug).toBeUndefined();
    expect(intent.returnTo).toBe("/en/account");
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
