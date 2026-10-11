import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getAdminContentSnapshot: vi.fn(),
  getBackendMode: vi.fn(),
  getContentSnapshot: vi.fn(),
  getDemoSession: vi.fn(),
  hasAdminAccess: vi.fn(),
  saveContentSnapshot: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ hasAdminAccess: mocks.hasAdminAccess }));
vi.mock("@/lib/config", () => ({
  getBackendMode: mocks.getBackendMode,
  getCanonicalAppUrl: () => new URL("https://lamilialomi.test"),
}));
vi.mock("@/lib/content-repository", () => ({ getAdminContentSnapshot: mocks.getAdminContentSnapshot }));
vi.mock("@/lib/content-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/content-store")>();
  return {
    ...actual,
    getContentSnapshot: mocks.getContentSnapshot,
    saveContentSnapshot: mocks.saveContentSnapshot,
  };
});
vi.mock("@/lib/session.server", () => ({ getDemoSession: mocks.getDemoSession }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { GET, POST } from "./route";
import { getSeedContentSnapshot } from "@/lib/content-store";

const productId = "11111111-1111-4111-8111-111111111111";
const routeParams = { params: Promise.resolve({ productId }) };

function postRequest(body: unknown, origin = "https://lamilialomi.test") {
  return new Request(`https://lamilialomi.test/api/admin/products/${productId}/premium-codes`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockSupabaseInsert(insert: ReturnType<typeof vi.fn>, hasProduct = true) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: hasProduct ? { id: productId } : null, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) => table === "products" ? { select } : { insert });
  mocks.createClient.mockResolvedValue({ from });
  return { from, insert, maybeSingle };
}

describe("admin premium code batch and export routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDemoSession.mockResolvedValue({ role: "admin" });
    mocks.hasAdminAccess.mockImplementation((session) => session?.role === "admin");
    mocks.getBackendMode.mockReturnValue("supabase");
  });

  it("requires an administrator and rejects cross-origin and out-of-range generation requests", async () => {
    mocks.getDemoSession.mockResolvedValue({ role: "customer" });
    expect((await POST(postRequest({ count: 1 }), routeParams)).status).toBe(401);

    mocks.getDemoSession.mockResolvedValue({ role: "admin" });
    expect((await POST(postRequest({ count: 1 }, "https://attacker.test"), routeParams)).status).toBe(403);
    expect((await POST(postRequest({ count: 251 }), routeParams)).status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("inserts a complete bounded batch through the authenticated client", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const { from } = mockSupabaseInsert(insert);

    const response = await POST(postRequest({ count: 3 }), routeParams);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.ok).toBe(true);
    expect(payload.codes).toHaveLength(3);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toHaveLength(3);
    expect(insert.mock.calls[0][0].every((code: { product_id: string; active: boolean }) => code.product_id === productId && code.active)).toBe(true);
    expect(from.mock.calls.map(([table]) => table)).toEqual(["products", "premium_codes"]);
  });

  it("retries a unique-key collision with a fresh batch and hides database errors", async () => {
    const insert = vi.fn()
      .mockResolvedValueOnce({ error: { code: "23505", message: "sensitive database detail" } })
      .mockResolvedValueOnce({ error: null });
    mockSupabaseInsert(insert);

    const response = await POST(postRequest({ count: 2 }), routeParams);
    const payload = await response.json();
    const firstBatch = insert.mock.calls[0][0].map((code: { code: string }) => code.code);
    const secondBatch = insert.mock.calls[1][0].map((code: { code: string }) => code.code);

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(secondBatch).not.toEqual(firstBatch);
    expect(JSON.stringify(payload)).not.toContain("sensitive database detail");
  });

  it("returns private, no-store CSV with English QR payloads and code states", async () => {
    const product = getSeedContentSnapshot().products[0];
    mocks.getAdminContentSnapshot.mockResolvedValue({
      ...getSeedContentSnapshot(),
      products: [{
        ...product,
        id: productId,
        slug: "printed-book",
        premiumCodes: [
          { id: "unused", productId, code: "LL-UNUSED", active: true },
          { id: "disabled", productId, code: "LL-DISABLED", active: false },
          { id: "redeemed", productId, code: "LL-REDEEMED", active: true, redeemedAt: "2026-10-10T12:00:00.000Z" },
        ],
      }],
    });

    const response = await GET(new Request(`https://lamilialomi.test/api/admin/products/${productId}/premium-codes`), routeParams);
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(csv).toContain(`https://lamilialomi.test/api/unlock/en/printed-book?productId=${productId}&code=LL-UNUSED`);
    expect(csv).toContain("\"unused\",\"yes\"");
    expect(csv).toContain("\"disabled\",\"no\"");
    expect(csv).toContain("\"redeemed\",\"yes\",\"2026-10-10T12:00:00.000Z\"");
    expect(csv.split("\r\n").find((row) => row.includes("LL-REDEEMED"))).toMatch(/,\"\"$/);
  });
});
