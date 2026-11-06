import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDemoSession: vi.fn(), getAdminContentSnapshot: vi.fn(), rpc: vi.fn(), getBackendMode: vi.fn(), getContentSnapshot: vi.fn(), saveContentSnapshot: vi.fn() }));
vi.mock("@/lib/session.server", () => ({ getDemoSession: mocks.getDemoSession }));
vi.mock("@/lib/auth", () => ({ hasAdminAccess: (session: { role?: string } | null) => session?.role === "admin" }));
vi.mock("@/lib/config", () => ({ getBackendMode: mocks.getBackendMode, getCanonicalAppUrl: () => new URL("https://book.test") }));
vi.mock("@/lib/content-repository", () => ({ getAdminContentSnapshot: mocks.getAdminContentSnapshot }));
vi.mock("@/lib/content-store", () => ({ getContentSnapshot: mocks.getContentSnapshot, saveContentSnapshot: mocks.saveContentSnapshot }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/shared-premium-qr", () => ({ renderSharedPremiumQrSvg: () => '<svg xmlns="http://www.w3.org/2000/svg"/>', renderSharedPremiumQrPdf: async () => new Uint8Array([37, 80, 68, 70]) }));
import { GET, POST } from "./route";

const productId = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ productId }) };
const sharedCode = { id: "shared", productId, code: "KDP-STABLE", active: true, codeType: "shared" };
function request(body: unknown, origin = "https://book.test") {
  return new Request(`https://book.test/api/admin/products/${productId}/shared-code`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}
function download(format?: string) {
  return new Request(`https://book.test/api/admin/products/${productId}/shared-code${format ? `?format=${format}` : ""}`);
}

describe("admin shared premium code API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDemoSession.mockResolvedValue({ role: "admin" });
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.getAdminContentSnapshot.mockResolvedValue({ products: [{ id: productId, status: "published", premiumCodes: [sharedCode] }] });
    mocks.rpc.mockResolvedValue({ data: { ...sharedCode, product_id: productId }, error: null });
  });

  it("requires admin for reads and mutations before accessing data", async () => {
    mocks.getDemoSession.mockResolvedValue({ role: "customer" });
    expect((await GET(download("svg"), context)).status).toBe(401);
    expect((await POST(request({ active: true }), context)).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.getAdminContentSnapshot).not.toHaveBeenCalled();
  });

  it("rejects cross-origin writes and invalid active values", async () => {
    expect((await POST(request({ active: true }, "https://attacker.test"), context)).status).toBe(403);
    expect((await POST(request({ active: "yes" }), context)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("calls the authenticated atomic RPC without accepting a replacement code", async () => {
    const response = await POST(request({ active: false, code: "UNWANTED-ROTATION" }), context);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("manage_shared_premium_code", { requested_product_id: productId, requested_active: false });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each(["svg", "pdf"])("returns private downloadable %s and omits the secret from filenames", async (format) => {
    const response = await GET(download(format), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(format === "svg" ? "image/svg+xml" : "application/pdf");
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="lamilialomi-kdp-${productId}.${format}"`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it.each(["draft", "archived", "inactive"])("blocks printing when %s", async (state) => {
    mocks.getAdminContentSnapshot.mockResolvedValue({ products: [{ id: productId, status: state === "inactive" ? "published" : state, premiumCodes: [{ ...sharedCode, active: state !== "inactive" }] }] });
    expect((await GET(download("svg"), context)).status).toBe(409);
  });

  it("keeps the local shared code stable over creation, disabling and re-enabling", async () => {
    mocks.getBackendMode.mockReturnValue("local");
    let snapshot = { products: [{ id: productId, premiumCodes: [] as typeof sharedCode[] }] };
    mocks.getContentSnapshot.mockImplementation(() => snapshot);
    mocks.saveContentSnapshot.mockImplementation((next) => { snapshot = next; });
    const created = await (await POST(request({ active: true }), context)).json();
    const disabled = await (await POST(request({ active: false }), context)).json();
    const enabled = await (await POST(request({ active: true }), context)).json();
    expect(created.code.codeType).toBe("shared");
    expect(enabled.code.code).toBe(created.code.code);
    expect(disabled.code.code).toBe(created.code.code);
    expect(disabled.code.active).toBe(false);
    expect(snapshot.products[0].premiumCodes).toHaveLength(1);
  });
});
