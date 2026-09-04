import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminUserRowsForRequest: vi.fn(),
}));

vi.mock("@/lib/admin-users", () => ({
  getAdminUserRowsForRequest: mocks.getAdminUserRowsForRequest,
}));

import AdminUsersPage from "./page";

describe("AdminUsersPage", () => {
  it("keeps the admin route renderable when the server user reader is unavailable", async () => {
    mocks.getAdminUserRowsForRequest.mockRejectedValueOnce(
      new Error("Supabase auth user read failed: Invalid API key"),
    );

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await AdminUsersPage();

    expect(result.props).toMatchObject({ rows: [], loadError: true });
    expect(errorSpy).toHaveBeenCalledWith("Admin users data load failed.");
    errorSpy.mockRestore();
  });

  it("passes loaded users through unchanged", async () => {
    const rows = [
      {
        id: "user-1",
        email: "user@example.com",
        role: "user" as const,
        emailVerified: true,
        marketingConsent: false,
        unlockCount: 0,
        unlockedProducts: [],
      },
    ];
    mocks.getAdminUserRowsForRequest.mockResolvedValueOnce(rows);

    const result = await AdminUsersPage();

    expect(result.props).toMatchObject({ rows, loadError: false });
  });
});
