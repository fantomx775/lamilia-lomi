import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  getCanonicalAppUrl: () => new URL("https://canonical.lamilialomi.example"),
}));

const mocks = vi.hoisted(() => ({
  getLocalizedProductViewForRequest: vi.fn(),
  getUnlockIntent: vi.fn(),
  setUnlockIntent: vi.fn(),
  clearUnlockIntent: vi.fn(),
}));

vi.mock("@/lib/products-request", () => ({
  getLocalizedProductViewForRequest: mocks.getLocalizedProductViewForRequest,
}));

vi.mock("@/lib/unlock-intent", () => ({
  getUnlockIntent: mocks.getUnlockIntent,
  setUnlockIntent: mocks.setUnlockIntent,
  clearUnlockIntent: mocks.clearUnlockIntent,
}));

import { GET } from "./route";

describe("QR unlock origin", () => {
  beforeEach(() => {
    mocks.getLocalizedProductViewForRequest.mockResolvedValue({
      slug: "moon-garden-coloring-book",
    });
    mocks.getUnlockIntent.mockResolvedValue(null);
    mocks.setUnlockIntent.mockResolvedValue(undefined);
    mocks.clearUnlockIntent.mockResolvedValue(undefined);
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
});
