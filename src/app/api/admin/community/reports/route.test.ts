import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/community/repository", () => ({ listCommunityReports: mocks.list, updateCommunityReport: mocks.update }));
import { GET, POST } from "./route";

const id = "22222222-2222-4222-8222-222222222222";
const context = { params: Promise.resolve({ id }) };
function post(body: unknown, origin = true) {
  return new Request(`https://lamilialomi.example/api/admin/community/reports/${id}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { host: "lamilialomi.example", "content-type": "application/json", ...(origin ? { origin: "https://lamilialomi.example" } : {}) },
  });
}

describe("admin community reports API", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ items: [], nextCursor: null, counts: { open: 0, reviewed: 0, resolved: 0, dismissed: 0 } }); mocks.update.mockResolvedValue(2); });
  it("validates filters and delegates bounded pages to the admin repository", async () => {
    expect((await GET(new Request("https://lamilialomi.example/api/admin/community/reports?status=open&other=1"))).status).toBe(400);
    expect((await GET(new Request("https://lamilialomi.example/api/admin/community/reports?status=open&limit=30"))).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({ status: "open", limit: 30, cursor: null });
  });
  it("requires same origin and rejects spoofed decision fields", async () => {
    expect((await POST(post({ action: "resolve", revision: 1 }, false), context)).status).toBe(403);
    expect((await POST(post({ action: "resolve", revision: 1, actorUserId: "spoof" }), context)).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("uses an allowlisted revisioned action", async () => {
    expect((await POST(post({ action: "resolve", revision: 1 }), context)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(id, 1, "resolve");
  });
});
