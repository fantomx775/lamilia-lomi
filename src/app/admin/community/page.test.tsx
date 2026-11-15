import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), products: vi.fn(), queue: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/community/admin-http", () => ({ getCommunityAdminAccess: mocks.access }));
vi.mock("@/lib/community/avatar-repository", () => ({ supportsCommunityAvatars: () => false }));
vi.mock("@/lib/community/repository", () => ({ listCommunityModerationProductOptions: mocks.products, listCommunityModerationQueue: mocks.queue, getCommunityModerationArtwork: mocks.detail }));
vi.mock("./community-moderation", () => ({ default: (props: { products: unknown[] }) => ({ type: "CommunityModeration", props }) }));

import AdminCommunityPage from "./page";

describe("AdminCommunityPage", () => {
  beforeEach(() => vi.clearAllMocks());
  it("checks current admin access before querying the small product-option projection", async () => {
    const option = { id: "p1", slug: "book", title: "Book" };
    mocks.access.mockResolvedValueOnce({ actor: { userId: "admin", role: "admin", emailVerified: true } });
    mocks.products.mockResolvedValueOnce([option]);
    mocks.queue.mockResolvedValueOnce({ items: [], nextCursor: null, counts: { pending: 0, approved: 0, rejected: 0, removed: 0 } });
    const result = await AdminCommunityPage();
    expect(mocks.access).toHaveBeenCalledOnce();
    const streamed = result.props.children[1].props.children;
    const loaded = await streamed.type(streamed.props);
    expect(mocks.products).toHaveBeenCalledOnce();
    expect(mocks.queue).toHaveBeenCalledWith({ status: "pending", creator: undefined, limit: 30 });
    expect(loaded.props).toMatchObject({ products: [option], initialQueue: { items: [] } });
  });

  it("preserves loaded product options when the independent queue read fails", async () => {
    const option = { id: "p1", slug: "book", title: "Book" };
    mocks.access.mockResolvedValueOnce({ actor: { userId: "admin", role: "admin", emailVerified: true } });
    mocks.products.mockResolvedValueOnce([option]);
    mocks.queue.mockRejectedValueOnce(new Error("Queue temporarily unavailable"));
    const result = await AdminCommunityPage();
    const streamed = result.props.children[1].props.children;
    const loaded = await streamed.type(streamed.props);
    expect(loaded.props.products).toEqual([option]);
    expect(loaded.props.initialError).toContain("Nie udało się wczytać kolejki");
    expect(loaded.props.initialQueue).toBeUndefined();
  });

  it("offers a server reload for failed product reads rather than an empty product filter", async () => {
    mocks.access.mockResolvedValueOnce({ actor: { userId: "admin", role: "admin", emailVerified: true } });
    mocks.products.mockRejectedValueOnce(new Error("Products temporarily unavailable"));
    mocks.queue.mockResolvedValueOnce({ items: [], nextCursor: null, counts: { pending: 0, approved: 0, rejected: 0, removed: 0 } });
    const result = await AdminCommunityPage();
    const streamed = result.props.children[1].props.children;
    const loaded = await streamed.type(streamed.props);
    expect(loaded.props.role).toBe("alert");
    const retry = loaded.props.children.find((child: { type?: string } | null) => child?.type === "a");
    expect(retry.props.href).toBe("/admin/community?status=pending");
  });

  it("does not read product options for a denied request", async () => {
    mocks.access.mockResolvedValueOnce({ response: new Response("denied", { status: 403 }) });
    const result = await AdminCommunityPage();
    expect(mocks.products).not.toHaveBeenCalled();
    expect(result.props.role).toBe("alert");
  });
});
