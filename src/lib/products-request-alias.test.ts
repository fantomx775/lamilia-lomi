import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getPublicContentSnapshot: vi.fn(),
  getPublicProductDetailSnapshotForRequest: vi.fn(),
  maybeSingle: vi.fn(),
  eq: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./config", () => ({ getBackendMode: () => "supabase" }));
vi.mock("./content-repository", () => ({
  getPublicContentSnapshot: mocks.getPublicContentSnapshot,
  getPublicProductDetailSnapshotForRequest: mocks.getPublicProductDetailSnapshotForRequest,
}));
vi.mock("./supabase/server", () => ({ createClient: async () => ({ from: () => ({ select: () => ({ eq: mocks.eq }) }) }) }));
import { getSeedContentSnapshot } from "./local-content";
import { getLocalizedProductDetailViewForRequest, getLocalizedProductViewForRequest, getProductBySlugForRequest } from "./products-request";

describe("historical printed product routes", () => {
  it("resolves old book slugs through published-only database aliases", async () => {
    const snapshot = getSeedContentSnapshot();
    mocks.getPublicContentSnapshot.mockResolvedValue(snapshot);
    mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
    mocks.maybeSingle.mockResolvedValue({ data: { product_id: snapshot.products[0].id }, error: null });
    const product = await getProductBySlugForRequest("previous-print-title");
    expect(product?.id).toBe(snapshot.products[0].id);
    expect(mocks.eq).toHaveBeenCalledWith("slug", "previous-print-title");
    const view = await getLocalizedProductViewForRequest("previous-print-title", "en");
    expect(view?.slug).toBe(snapshot.products[0].slug);
    mocks.getPublicProductDetailSnapshotForRequest.mockResolvedValueOnce(null).mockResolvedValueOnce(snapshot);
    const detail = await getLocalizedProductDetailViewForRequest("previous-print-title", "en");
    expect(detail?.slug).toBe(snapshot.products[0].slug);
    expect(mocks.getPublicProductDetailSnapshotForRequest).toHaveBeenLastCalledWith(snapshot.products[0].slug);
  });

  it("fails closed when historical alias lookup is unavailable", async () => {
    mocks.getPublicContentSnapshot.mockResolvedValue(getSeedContentSnapshot());
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    await expect(getProductBySlugForRequest("missing-book")).rejects.toThrow("Could not resolve the printed book link.");
  });
});
