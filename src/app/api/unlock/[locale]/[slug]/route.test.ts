import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  getCanonicalAppUrl: () => new URL("https://canonical.lamilialomi.example"),
  getBackendMode: () => mocks.getBackendMode(),
}));

const mocks = vi.hoisted(() => ({
  getBackendMode: vi.fn(),
  getLocalizedProductViewByIdForRequest: vi.fn(),
  getLocalizedProductViewForRequest: vi.fn(),
  getUnlockIntent: vi.fn(),
  setUnlockIntent: vi.fn(),
  clearUnlockIntent: vi.fn(),
  redeemPremiumCodeForRequest: vi.fn(),
}));

vi.mock("@/lib/premium-request", () => ({ redeemPremiumCodeForRequest: mocks.redeemPremiumCodeForRequest }));

vi.mock("@/lib/products-request", () => ({
  getLocalizedProductViewByIdForRequest: mocks.getLocalizedProductViewByIdForRequest,
  getLocalizedProductViewForRequest: mocks.getLocalizedProductViewForRequest,
}));

vi.mock("@/lib/unlock-intent", () => ({
  getUnlockIntent: mocks.getUnlockIntent,
  setUnlockIntent: mocks.setUnlockIntent,
  clearUnlockIntent: mocks.clearUnlockIntent,
}));

import { GET, POST } from "./route";

describe("QR unlock origin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBackendMode.mockReturnValue("local");
    mocks.getLocalizedProductViewForRequest.mockResolvedValue({
      slug: "moon-garden-coloring-book",
    });
    mocks.getLocalizedProductViewByIdForRequest.mockResolvedValue({
      slug: "moon-garden-coloring-book",
    });
    mocks.getUnlockIntent.mockResolvedValue(null);
    mocks.setUnlockIntent.mockResolvedValue(undefined);
    mocks.clearUnlockIntent.mockResolvedValue(undefined);
    mocks.redeemPremiumCodeForRequest.mockResolvedValue({ ok: false, status: "auth_required" });
  });

  it.each([
    ["x-forwarded-host", "evil.example"],
    ["x-forwarded-proto", "http"],
    ["host", "//evil.example/path"],
  ])("ignores forged %s when constructing the redirect", async (header, value) => {
    const response = await GET(
      new Request("https://edge.example/api/unlock/en/moon-garden-coloring-book", {
        headers: { [header]: value },
      }),
      { params: Promise.resolve({ locale: "en", slug: "moon-garden-coloring-book" }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://canonical.lamilialomi.example/en/products/moon-garden-coloring-book#premium",
    );
    expect(response.headers.get("location")).not.toContain("evil.example");
  });

  it("stores a scanned code in the intent and redirects to a URL without the code", async () => {
    const response = await GET(
      new Request(
        "https://edge.example/api/unlock/en/moon-garden-coloring-book?code=LOMI-BOOK-2026",
      ),
      { params: Promise.resolve({ locale: "en", slug: "moon-garden-coloring-book" }) },
    );

    expect(mocks.setUnlockIntent).toHaveBeenCalledWith({
      locale: "en",
      productSlug: "moon-garden-coloring-book",
      returnTo: "/en/products/moon-garden-coloring-book",
      code: "LOMI-BOOK-2026",
    });
    expect(response.headers.get("location")).toBe(
      "https://canonical.lamilialomi.example/en/products/moon-garden-coloring-book#premium",
    );
    expect(response.headers.get("location")).not.toContain("LOMI-BOOK-2026");
  });

  it("resolves printed QR links by stable product id after a slug change", async () => {
    mocks.getLocalizedProductViewByIdForRequest.mockResolvedValue({
      slug: "updated-book-slug",
    });

    const response = await GET(
      new Request(
        "https://edge.example/api/unlock/en/old-book-slug?productId=11111111-1111-4111-8111-111111111111&code=LL-PRINTED-CODE",
      ),
      { params: Promise.resolve({ locale: "en", slug: "old-book-slug" }) },
    );

    expect(mocks.getLocalizedProductViewByIdForRequest).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "en",
    );
    expect(mocks.setUnlockIntent).toHaveBeenCalledWith({
      locale: "en",
      productSlug: "updated-book-slug",
      returnTo: "/en/products/updated-book-slug",
      code: "LL-PRINTED-CODE",
    });
    expect(response.headers.get("location")).toBe(
      "https://canonical.lamilialomi.example/en/products/updated-book-slug#premium",
    );
  });

  it("redeems a signed-in reader automatically and removes the intent", async () => {
    mocks.getLocalizedProductViewByIdForRequest.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", slug: "new-title" });
    mocks.redeemPremiumCodeForRequest.mockResolvedValue({ ok: true, status: "success" });
    const response = await POST(new Request("https://edge.example/api/unlock/en/11111111-1111-4111-8111-111111111111", {
      method: "POST", headers: { origin: "https://edge.example", "content-type": "application/x-www-form-urlencoded" }, body: "code=SHARED-BOOK-CODE",
    }), { params: Promise.resolve({ locale: "en", slug: "11111111-1111-4111-8111-111111111111" }) });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://canonical.lamilialomi.example/en/products/new-title#premium");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.redeemPremiumCodeForRequest).toHaveBeenCalledWith({ productId: "11111111-1111-4111-8111-111111111111", productSlug: "new-title", code: "SHARED-BOOK-CODE" });
    expect(mocks.clearUnlockIntent).toHaveBeenCalled();
  });

  it("rejects cross-origin POSTs before reading or storing a code", async () => {
    const response = await POST(new Request("https://edge.example/api/unlock/en/book", { method: "POST", headers: { origin: "https://evil.example" }, body: "code=SECRET" }), { params: Promise.resolve({ locale: "en", slug: "book" }) });
    expect(response.status).toBe(403);
    expect(mocks.setUnlockIntent).not.toHaveBeenCalled();
  });

  it("rejects an opaque null Origin", async () => {
    const response = await POST(new Request("https://edge.example/api/unlock/en/book", { method: "POST", headers: { origin: "null", "content-type": "application/x-www-form-urlencoded" }, body: "code=SECRET" }), { params: Promise.resolve({ locale: "en", slug: "book" }) });
    expect(response.status).toBe(403);
    expect(mocks.setUnlockIntent).not.toHaveBeenCalled();
  });

  it("requires the configured canonical origin with the Supabase backend", async () => {
    mocks.getBackendMode.mockReturnValue("supabase");
    const response = await POST(new Request("https://internal.example/api/unlock/en/book", { method: "POST", headers: { origin: "https://internal.example", "content-type": "application/x-www-form-urlencoded" }, body: "code=SECRET" }), { params: Promise.resolve({ locale: "en", slug: "book" }) });
    expect(response.status).toBe(403);
    expect(mocks.setUnlockIntent).not.toHaveBeenCalled();
  });
});
