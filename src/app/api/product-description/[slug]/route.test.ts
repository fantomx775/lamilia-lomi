import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("@/lib/products-request", () => ({ getLocalizedProductDetailViewForRequest: lookup }));

beforeEach(() => lookup.mockReset());
describe("public no-script product description", () => {
  it("returns complete extracted text as non-executable UTF-8, without a session or mutation", async () => {
    lookup.mockResolvedValue({title:"A book",shortDescription:"Short copy",longDescription:'<script>alert(1)</script>\n' + "Complete copy ".repeat(100)});
    const response = await GET(new Request("https://example.com"), {params:Promise.resolve({slug:"a-book"})});
    expect(lookup).toHaveBeenCalledWith("a-book", "en");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe('A book\n\nShort copy\n\n<script>alert(1)</script>\n' + "Complete copy ".repeat(100));
  });
  it("does not expose an unpublished or missing product", async () => {
    lookup.mockResolvedValue(null);
    const response = await GET(new Request("https://example.com"), {params:Promise.resolve({slug:"unpublished"})});
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Product not found.");
  });
});
