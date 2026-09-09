import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAssetByIdForRequest: vi.fn(),
  authorizePremiumDownloadForRequest: vi.fn(),
  getBackendMode: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config", () => ({ getBackendMode: mocks.getBackendMode }));
vi.mock("@/lib/products-request", () => ({
  getAssetByIdForRequest: mocks.getAssetByIdForRequest,
}));
vi.mock("@/lib/premium-request", () => ({
  authorizePremiumDownloadForRequest: mocks.authorizePremiumDownloadForRequest,
}));
vi.mock("@/lib/analytics", () => ({
  buildBusinessEventPayload: vi.fn(() => ({ event: "premium_file_download" })),
}));
vi.mock("@/lib/locale", () => ({ normalizeLocale: vi.fn(() => "en") }));
vi.mock("@/lib/return-to", () => ({ sanitizeReturnTo: vi.fn((_value, _locale, fallback) => fallback) }));

import { GET } from "./route";

const asset = {
  id: "asset-1",
  productId: "product-1",
  kind: "premium_download" as const,
  bucket: "premium-files",
  path: "products/product-1/premium_download/asset-1-bonus.pdf",
  filename: "bonus.pdf",
  contentType: "application/pdf",
  isPublic: false,
  isActive: true,
  demoPrivatePath: "bonus.pdf",
};

describe("premium download delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getAssetByIdForRequest.mockResolvedValue(asset);
  });

  it("marks guest denials as no-store", async () => {
    mocks.authorizePremiumDownloadForRequest.mockResolvedValue({
      ok: false,
      decision: { allowed: false, reason: "guest" },
    });

    const response = await GET(
      new Request("https://lamilialomi.com/api/downloads/asset-1?locale=en"),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("marks authorized redirects as private and no-store", async () => {
    mocks.authorizePremiumDownloadForRequest.mockResolvedValue({
      ok: true,
      url: "https://project.storage.supabase.co/object/sign/premium-files/file?token=short",
    });

    const response = await GET(
      new Request("https://lamilialomi.com/api/downloads/asset-1"),
      { params: Promise.resolve({ assetId: "asset-1" }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="bonus.pdf"');
  });
});
