import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getAdminContentSnapshot: vi.fn(),
  getBackendMode: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/config", () => ({
  getBackendMode: mocks.getBackendMode,
}));

vi.mock("@/lib/content-repository", () => ({
  getAdminContentSnapshot: mocks.getAdminContentSnapshot,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { getAdminUserRowsForRequest } from "./admin-users";

describe("getAdminUserRowsForRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBackendMode.mockReturnValue("supabase");
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  it("maps the admin-only RPC response without requiring a service-role key", async () => {
    const adminId = "admin-id";
    const userId = "user-id";
    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: adminId,
          email: "admin@example.com",
          role: "admin",
          email_verified: true,
          marketing_consent: true,
          unlock_count: 1,
          unlocked_products: ["Moon Garden"],
        },
        {
          id: userId,
          email: null,
          role: "user",
          email_verified: false,
          marketing_consent: false,
          unlock_count: "1",
          unlocked_products: null,
        },
      ],
      error: null,
    });

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

    expect(mocks.rpc).toHaveBeenCalledWith("list_admin_users");
    expect(mocks.getAdminContentSnapshot).not.toHaveBeenCalled();
  });
});
