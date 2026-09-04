import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
  from: vi.fn(),
  getAdminContentSnapshot: vi.fn(),
  getBackendMode: vi.fn(),
  listUsers: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/config", () => ({
  getBackendMode: mocks.getBackendMode,
}));

vi.mock("@/lib/content-repository", () => ({
  getAdminContentSnapshot: mocks.getAdminContentSnapshot,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
}));

import { getAdminUserRowsForRequest } from "./admin-users";

describe("getAdminUserRowsForRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.createServiceRoleClient.mockReturnValue({
      auth: { admin: { listUsers: mocks.listUsers } },
      from: mocks.from,
    });
  });

  it("maps optional profile and unlock data without reading premium_codes", async () => {
    const adminId = "admin-id";
    const userId = "user-id";
    const tableData = {
      profiles: [{ id: adminId, role: "admin", marketing_consent: true }],
      user_product_unlocks: [
        { user_id: adminId, product_id: "product-id" },
        { user_id: userId, product_id: "missing-product-id" },
      ],
      product_translations: [
        { product_id: "product-id", locale: "en", title: "Moon Garden" },
        { product_id: "product-id", locale: "pl", title: "Ogród księżycowy" },
      ],
    } as const;

    mocks.listUsers.mockResolvedValue({
      data: {
        users: [
          { id: adminId, email: "admin@example.com", email_confirmed_at: "2026-09-04T00:00:00Z" },
          { id: userId, email: null, email_confirmed_at: null },
        ],
      },
      error: null,
    });
    mocks.from.mockImplementation((table: keyof typeof tableData) => ({
      select: vi.fn().mockResolvedValue({ data: tableData[table], error: null }),
    }));

    await expect(getAdminUserRowsForRequest()).resolves.toEqual([
      {
        id: adminId,
        email: "admin@example.com",
        role: "admin",
        emailVerified: true,
        marketingConsent: true,
        unlockCount: 1,
        unlockedProducts: ["Moon Garden"],
      },
      {
        id: userId,
        email: "",
        role: "user",
        emailVerified: false,
        marketingConsent: false,
        unlockCount: 1,
        unlockedProducts: [],
      },
    ]);

    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(
      expect.arrayContaining(["profiles", "user_product_unlocks", "product_translations"]),
    );
    expect(mocks.from.mock.calls.map(([table]) => table)).not.toContain("premium_codes");
    expect(mocks.getAdminContentSnapshot).not.toHaveBeenCalled();
  });
});
