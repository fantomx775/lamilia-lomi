import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDemoSession: vi.fn(),
  hasAdminAccess: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  saveAboutPageSettingsForRequest: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ hasAdminAccess: mocks.hasAdminAccess }));
vi.mock("@/lib/session.server", () => ({ getDemoSession: mocks.getDemoSession }));
vi.mock("@/lib/supabase-content-admin", () => ({
  archiveProductForRequest: vi.fn(),
  deleteCategoryForRequest: vi.fn(),
  deleteProductForRequest: vi.fn(),
  deleteTagForRequest: vi.fn(),
  saveAboutPageSettingsForRequest: mocks.saveAboutPageSettingsForRequest,
  saveCategoryForRequest: vi.fn(),
  saveCatalogSettingsForRequest: vi.fn(),
  savePageForRequest: vi.fn(),
  savePagesForRequest: vi.fn(),
  saveProductForRequest: vi.fn(),
  saveTagForRequest: vi.fn(),
}));

import { saveAboutPageAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((location: string) => {
    throw Object.assign(new Error(`REDIRECT:${location}`), { location });
  });
});

describe("saveAboutPageAction", () => {
  it("rejects an unauthenticated write before reaching the settings mutation", async () => {
    mocks.getDemoSession.mockResolvedValue(null);
    mocks.hasAdminAccess.mockReturnValue(false);

    await expect(saveAboutPageAction(new FormData())).rejects.toMatchObject({
      location: "/en/login?error=invalid&returnTo=/admin",
    });
    expect(mocks.saveAboutPageSettingsForRequest).not.toHaveBeenCalled();
  });

  it("returns duplicate validation failures to the editor without saving", async () => {
    mocks.getDemoSession.mockResolvedValue({ role: "admin" });
    mocks.hasAdminAccess.mockReturnValue(true);
    mocks.saveAboutPageSettingsForRequest.mockResolvedValue({
      ok: false,
      errors: ["admin.validation.invalid_input"],
    });

    await expect(saveAboutPageAction(new FormData())).rejects.toMatchObject({
      location: "/admin/pages/about?error=admin.validation.invalid_input",
    });
    expect(mocks.saveAboutPageSettingsForRequest).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/en", "layout");
  });
});
