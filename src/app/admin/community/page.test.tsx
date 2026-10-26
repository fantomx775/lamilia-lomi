import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), products: vi.fn() }));
vi.mock("@/lib/community/admin-http", () => ({ getCommunityAdminAccess: mocks.access }));
vi.mock("@/lib/community/repository", () => ({ listCommunityModerationProductOptions: mocks.products }));
vi.mock("./community-moderation", () => ({ default: (props: { products: unknown[] }) => ({ type: "CommunityModeration", props }) }));

import AdminCommunityPage from "./page";

describe("AdminCommunityPage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("checks current admin access before querying the small product-option projection", async () => {
    const option = { id: "p1", slug: "book", title: "Book" };
    mocks.access.mockResolvedValueOnce({ actor: { userId: "admin", role: "admin", emailVerified: true } });
    mocks.products.mockResolvedValueOnce([option]);
    const result = await AdminCommunityPage();
    expect(mocks.access).toHaveBeenCalledOnce();
    expect(mocks.products).toHaveBeenCalledOnce();
    expect(result.props).toMatchObject({ products: [option] });
  });

  it("does not read product options for a denied request", async () => {
    mocks.access.mockResolvedValueOnce({ response: new Response("denied", { status: 403 }) });
    const result = await AdminCommunityPage();
    expect(mocks.products).not.toHaveBeenCalled();
    expect(result.props.role).toBe("alert");
  });
});
